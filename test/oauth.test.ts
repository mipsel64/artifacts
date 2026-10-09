import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, reset, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifact, listArtifacts } from '../src/artifacts';
import { toBase64Url } from '../src/auth';
import main from '../src/index';
import authRoutes from '../src/routes/auth';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  return reset();
});

const MCP = `${ORIGIN}/mcp`;
const REDIRECT = 'https://client.example.com/cb';
const LOOPBACK_REDIRECT = 'http://localhost:8976/callback';
const XSS_NAME = '<img src=x onerror=alert(1)>';
const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN };

const sha256 = async (value: string) => toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

async function pkce() {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await sha256(verifier) };
}

async function registerClient(clientName = 'Test client', redirectUri = REDIRECT): Promise<string> {
  const res = await request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizePath(clientId: string, challenge: string, redirectUri = REDIRECT, state = 'xyz') {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'artifacts',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP,
  });
  return `/authorize?${query}`;
}

const bindingCookie = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

// Opens the consent page as a signed-in user; returns what the consent POST needs.
async function openConsent(cookie: string, path: string) {
  const res = await request(path, { headers: { Cookie: cookie }, redirect: 'manual' });
  const html = await res.text();
  return { res, html, handle: /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '', binding: bindingCookie(res) };
}

function postConsent(cookie: string, handle: string, decision: string) {
  return request('/authorize', {
    method: 'POST',
    headers: { ...FORM_HEADERS, Cookie: cookie },
    body: new URLSearchParams({ handle, decision }),
    redirect: 'manual',
  });
}

async function approve(cookie: string, clientId: string, verifier: string, challenge: string) {
  const { handle, binding } = await openConsent(cookie, authorizePath(clientId, challenge));
  const res = await postConsent(`${cookie}; ${binding}`, handle, 'approve');
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location')!);
  expect(location.origin + location.pathname).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('xyz');
  expect(location.searchParams.get('iss')).toBe(ORIGIN);
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code: location.searchParams.get('code')!,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
    resource: MCP,
  });
  expect(tokens.status).toBe(200);
  return (await tokens.json()) as { access_token: string; refresh_token: string; token_type: string };
}

const tokenRequest = (params: Record<string, string>) =>
  request('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

async function connect(cookie: string, clientName?: string) {
  const clientId = await registerClient(clientName);
  const { verifier, challenge } = await pkce();
  return { clientId, ...(await approve(cookie, clientId, verifier, challenge)) };
}

const mcpCall = (token: string | null, method: string, params?: unknown) =>
  request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...(token ? bearer(token) : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

async function toolValue(res: Response) {
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}

const callTool = (token: string, name: string, args: Record<string, unknown> = {}) =>
  mcpCall(token, 'tools/call', { name, arguments: args }).then(toolValue);

// Requests for another origin cannot use the `request` helper, which fixes ORIGIN.
const fetchFrom = (url: string) => main.fetch(new Request(url), env, createExecutionContext());

describe('discovery metadata', () => {
  it('publishes protected resource metadata for the request origin', async () => {
    for (const origin of [ORIGIN, 'https://other.example']) {
      const res = await fetchFrom(`${origin}/.well-known/oauth-protected-resource/mcp`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['artifacts'],
      });
    }
  });

  it('publishes authorization server metadata for the request origin', async () => {
    for (const origin of [ORIGIN, 'https://other.example']) {
      const body = (await (await fetchFrom(`${origin}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ['S256'],
      });
      expect(body.scopes_supported).toEqual(expect.arrayContaining(['artifacts']));
    }
  });

  it('challenges an unauthenticated POST /mcp with the resource metadata URL', async () => {
    const res = await mcpCall(null, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });
});

describe('GET /authorize sign-in redirect', () => {
  it('sends a signed-out browser to /auth/login with the authorize URL as next', async () => {
    const { challenge } = await pkce();
    const path = authorizePath(await registerClient(), challenge);
    const res = await request(path, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!, ORIGIN);
    expect(location.pathname).toBe('/auth/login');
    expect(location.searchParams.get('next')).toBe(path);
  });

  it('shows an error instead of a sign-in that would drop an over-long authorize request', async () => {
    const { challenge } = await pkce();
    const path = authorizePath(await registerClient(), challenge, REDIRECT, 's'.repeat(2100));
    const res = await request(path, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('too long');
  });

  it('ignores a Bearer token: only a browser session counts', async () => {
    const { token } = await createTestUser();
    const { challenge } = await pkce();
    const res = await request(authorizePath(await registerClient(), challenge), { headers: bearer(token), redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location')!, ORIGIN).pathname).toBe('/auth/login');
  });

  it('renders an error page, without redirecting, for an unknown client or an unregistered redirect URI', async () => {
    const { cookie } = await createTestUser();
    const { challenge } = await pkce();
    const clientId = await registerClient();
    for (const path of [
      authorizePath('no-such-client', challenge),
      authorizePath(clientId, challenge, 'https://evil.example/cb'),
    ]) {
      const res = await request(path, { headers: { Cookie: cookie }, redirect: 'manual' });
      expect(res.status).toBe(400);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toContain('Authorization failed');
    }
  });
});

describe('sign-in next round trip', () => {
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';

  // Real /auth/login, then the callback in-process so that the fetch spy sees the Worker's Google request.
  async function signInWithNext(next: string) {
    const login = await request(`/auth/login?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
    const location = new URL(login.headers.get('Location')!);
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: location.searchParams.get('nonce'),
      sub: '1',
      email: 'alice@example.com',
      email_verified: true,
    };
    const idToken = ['e30', toBase64Url(new TextEncoder().encode(JSON.stringify(claims))), 'sig'].join('.');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new Request(input).url !== TOKEN_URL) throw new Error('unexpected fetch');
      return Response.json({ id_token: idToken });
    });
    const state = location.searchParams.get('state');
    return authRoutes.fetch(
      new Request(`${ORIGIN}/auth/callback?code=c0de&state=${state}`, { headers: { Cookie: login.headers.getSetCookie()[0].split(';')[0] } }),
      env,
    );
  }

  it('returns to the original /authorize URL after signing in', async () => {
    const { challenge } = await pkce();
    const path = `${authorizePath(await registerClient(), challenge, REDIRECT, 'a.b.c')}&extra=1.2`;
    const res = await signInWithNext(path);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(path);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session='))).toBe(true);
  });

  it.each([
    '//evil.example/authorize?x=1',
    'https://evil.example/authorize?x=1',
    'https://artifacts.test/authorize?x=1',
    '/authorize',
    '/authorized?x=1',
    '/authorize/../settings?x=1',
    '/settings?next=/authorize?x=1',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('ignores the unsafe next %s', async (next) => {
    const res = await signInWithNext(next);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
  });
});

describe('consent page', () => {
  it('shows the escaped client name, the redirect host and a strict CSP that allows the redirect', async () => {
    const { cookie, user } = await createTestUser();
    const { challenge } = await pkce();
    const { res, html, handle, binding } = await openConsent(cookie, authorizePath(await registerClient(XSS_NAME), challenge));
    expect(res.status).toBe(200);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<strong>client.example.com</strong>');
    expect(html).toContain('not verified');
    expect(html).toContain(user.email);
    expect(html).not.toContain('on your computer');
    expect(handle).not.toBe('');
    expect(binding).toContain('__Host-oauth-');
    expect(html).toContain('name="decision" value="approve"');
    expect(html).toContain('name="decision" value="deny"');

    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://client.example.com;");
    expect(csp).toContain("script-src 'self';");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('warns about a local app and allows its redirect origin', async () => {
    const { cookie } = await createTestUser();
    const { challenge } = await pkce();
    const clientId = await registerClient('Local', LOOPBACK_REDIRECT);
    const { res, html } = await openConsent(cookie, authorizePath(clientId, challenge, LOOPBACK_REDIRECT));
    expect(html).toContain('on your computer');
    expect(html).toContain('<strong>localhost</strong>');
    expect(res.headers.get('Content-Security-Policy')).toContain("form-action 'self' http://localhost:8976;");
  });

  it('turns a denial into an access_denied redirect to the client', async () => {
    const { cookie } = await createTestUser();
    const { challenge } = await pkce();
    const { handle, binding } = await openConsent(cookie, authorizePath(await registerClient(), challenge));
    const res = await postConsent(`${cookie}; ${binding}`, handle, 'deny');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.has('code')).toBe(false);
  });

  it('refuses a consent POST without the binding cookie', async () => {
    const { cookie } = await createTestUser();
    const { challenge } = await pkce();
    const { handle } = await openConsent(cookie, authorizePath(await registerClient(), challenge));
    const res = await postConsent(cookie, handle, 'approve');
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('refuses a consent POST without a session, with a Bearer token or from another origin', async () => {
    const { cookie, token } = await createTestUser();
    const { challenge } = await pkce();
    const { handle, binding } = await openConsent(cookie, authorizePath(await registerClient(), challenge));
    const form = new URLSearchParams({ handle, decision: 'approve' });
    const post = (headers: Record<string, string>) =>
      request('/authorize', { method: 'POST', headers: { ...FORM_HEADERS, ...headers }, body: form, redirect: 'manual' });

    expect((await post({ Cookie: binding })).status).toBe(401);
    expect((await post({ Cookie: binding, ...bearer(token) })).status).toBe(403);
    expect((await post({ Cookie: `${cookie}; ${binding}`, Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('uses a consent handle only once', async () => {
    const { cookie } = await createTestUser();
    const { challenge } = await pkce();
    const { handle, binding } = await openConsent(cookie, authorizePath(await registerClient(), challenge));
    expect((await postConsent(`${cookie}; ${binding}`, handle, 'approve')).status).toBe(302);
    expect((await postConsent(`${cookie}; ${binding}`, handle, 'approve')).status).toBe(400);
  });
});

describe('OAuth access to /mcp', () => {
  it('runs DCR, consent, PKCE token exchange, tools and refresh as the signed-in user', async () => {
    const { cookie, user } = await createTestUser();
    const tokens = await connect(cookie);
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.refresh_token).toBeTruthy();

    const init = await mcpCall(tokens.access_token, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(init.status).toBe(200);

    const created = await callTool(tokens.access_token, 'create_artifact', { title: 'Via OAuth', type: 'markdown', content: '# hi' });
    expect(created.title).toBe('Via OAuth');
    expect((await listArtifacts(env, user.id)).map((a) => a.id)).toEqual([created.id]);
    expect((await callTool(tokens.access_token, 'list_artifacts')).items).toEqual([expect.objectContaining({ id: created.id })]);

    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.clientId, resource: MCP });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    expect(next.access_token).not.toBe(tokens.access_token);
    expect((await callTool(next.access_token, 'list_artifacts')).items).toHaveLength(1);
  });

  it('keeps users apart', async () => {
    const alice = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const aliceTokens = await connect(alice.cookie);
    await callTool(aliceTokens.access_token, 'create_artifact', { title: 'Mine', type: 'markdown', content: 'x' });
    const bobTokens = await connect(bob.cookie);
    expect((await callTool(bobTokens.access_token, 'list_artifacts')).items).toEqual([]);
  });

  it('still accepts art_ API tokens', async () => {
    const { token, user } = await createTestUser();
    const created = await callTool(token, 'create_artifact', { title: 'Via token', type: 'markdown', content: 'x' });
    expect((await listArtifacts(env, user.id)).map((a) => a.id)).toEqual([created.id]);
  });

  it('answers 403 when the OAuth user is no longer in ALLOWED_EMAILS', async () => {
    const { cookie } = await createTestUser();
    const { access_token } = await connect(cookie);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const call = (allowed: string) =>
      main.fetch(
        new Request(MCP, { method: 'POST', headers: { ...MCP_HEADERS, ...bearer(access_token) }, body }),
        { ...env, ALLOWED_EMAILS: allowed },
        createExecutionContext(),
      );
    expect((await call('alice@example.com')).status).toBe(200);
    const res = await call('bob@example.com');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });
});

describe('connected apps', () => {
  const grantIdFrom = (html: string) => /data-url="\/api\/grants\/([^"]+)"/.exec(html)?.[1] ?? '';
  const settings = (cookie: string) => request('/settings', { headers: { Cookie: cookie } }).then((res) => res.text());
  const revoke = (cookie: string, id: string) => request(`/api/grants/${id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } });

  it('lists the grant on the settings page and revokes it', async () => {
    const { cookie } = await createTestUser();
    expect(await settings(cookie)).toContain('No connected apps');
    const { access_token } = await connect(cookie, XSS_NAME);

    const html = await settings(cookie);
    expect(html).toContain('Connected apps');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    const id = grantIdFrom(html);
    expect(id).not.toBe('');
    expect((await mcpCall(access_token, 'tools/list')).status).toBe(200);

    expect((await revoke(cookie, id)).status).toBe(204);
    expect((await mcpCall(access_token, 'tools/list')).status).toBe(401);
    expect(await settings(cookie)).toContain('No connected apps');
  });

  it("does not revoke another user's grant", async () => {
    const alice = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const { access_token } = await connect(alice.cookie);
    const id = grantIdFrom(await settings(alice.cookie));

    expect((await revoke(bob.cookie, id)).status).toBe(404);
    expect((await mcpCall(access_token, 'tools/list')).status).toBe(200);
  });

  it('requires a session', async () => {
    const { token } = await createTestUser();
    expect((await request('/api/grants/x', { method: 'DELETE' })).status).toBe(401);
    expect((await request('/api/grants/x', { method: 'DELETE', headers: bearer(token) })).status).toBe(403);
  });
});

describe('scheduled', () => {
  it('sweeps expired artifacts and purges expired OAuth data', async () => {
    const purge = vi.spyOn(OAuthProvider.prototype, 'purgeExpiredData');
    await createArtifact(env, 'u1', { title: 'Old', type: 'markdown', content: 'x' }, new Date('2020-01-01T00:00:00.000Z'));
    const ctx = createExecutionContext();
    await main.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(purge).toHaveBeenCalledOnce();
    expect((await env.KV.list({ prefix: 'index:' })).keys).toEqual([]);
  });
});
