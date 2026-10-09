import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUser, readSession, toBase64Url, verifyApiToken } from '../src/auth';
import routes from '../src/routes/auth';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  return reset();
});

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieNamed = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));
const cleared = (res: Response) => expect(cookieNamed(res, 'oauth_state')).toMatch(/Max-Age=0|Expires=/);
const json = (body: unknown, status = 200) => Response.json(body, { status });
const sha256Base64Url = async (value: string) =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

const now = () => Math.floor(Date.now() / 1000);
const claims = (overrides: Record<string, unknown> = {}, nonce = 'n0nce') => ({
  iss: 'https://accounts.google.com',
  aud: 'test-client',
  exp: now() + 3600,
  nonce,
  sub: '1',
  email: 'alice@example.com',
  email_verified: true,
  name: 'Alice',
  picture: 'https://lh3.googleusercontent.com/a/alice',
  ...overrides,
});
const idToken = (payload: Record<string, unknown>) =>
  ['e30', toBase64Url(new TextEncoder().encode(JSON.stringify(payload))), 'sig'].join('.');

function mockToken(response: Response | (() => Promise<Response>)) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new Request(input).url;
    if (url !== TOKEN_URL) throw new Error(`unexpected fetch ${url}`);
    return typeof response === 'function' ? response() : response;
  });
}

// Starts a real login so the signed oauth_state cookie is valid; returns what the callback needs.
async function startLogin() {
  const res = await request('/auth/login', { redirect: 'manual' });
  const location = new URL(res.headers.get('Location')!);
  const setCookie = cookieNamed(res, 'oauth_state')!;
  return {
    res,
    location,
    setCookie,
    cookie: setCookie.split(';')[0],
    state: location.searchParams.get('state')!,
    nonce: location.searchParams.get('nonce')!,
  };
}

// Called in-process so that the fetch spy sees the Worker's outbound Google requests.
const callback = (query: string, cookie?: string) =>
  routes.fetch(new Request(`${ORIGIN}/auth/callback?${query}`, { headers: cookie ? { Cookie: cookie } : {} }), env);

async function signIn(overrides: Record<string, unknown> = {}) {
  const login = await startLogin();
  const fetchMock = mockToken(json({ id_token: idToken(claims(overrides, login.nonce)) }));
  const res = await callback(`code=c0de&state=${login.state}`, login.cookie);
  return { res, login, fetchMock };
}

describe('GET /auth/login', () => {
  it('redirects to Google with state, nonce and a PKCE challenge bound to the cookie', async () => {
    const { res, location, setCookie, state, nonce } = await startLogin();
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = location.searchParams;
    expect(params.get('client_id')).toBe('test-client');
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('prompt')).toBe('select_account');
    expect(state).toHaveLength(22);
    expect(nonce).toHaveLength(22);
    expect(state).not.toBe(nonce);

    const value = decodeURIComponent(setCookie.split(';')[0].slice('oauth_state='.length));
    const [cookieState, cookieNonce, verifier] = value.split('.');
    expect([cookieState, cookieNonce]).toEqual([state, nonce]);
    expect(verifier).toHaveLength(43);
    expect(params.get('code_challenge')).toBe(await sha256Base64Url(verifier));
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/auth', 'Max-Age=600']) {
      expect(setCookie).toContain(attribute);
    }
  });

  it('uses fresh values on every login', async () => {
    const a = await startLogin();
    const b = await startLogin();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.location.searchParams.get('code_challenge')).not.toBe(b.location.searchParams.get('code_challenge'));
  });

  it('is 500 when Google sign-in is not configured', async () => {
    const res = await routes.fetch(new Request(`${ORIGIN}/auth/login`), { ...env, GOOGLE_CLIENT_ID: '' } as Env);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Google sign-in is not configured');
    expect(cookieNamed(res, 'oauth_state')).toBeUndefined();
  });
});

describe('GET /auth/callback', () => {
  it('signs the user in', async () => {
    const { res, login, fetchMock } = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');

    const session = cookieNamed(res, 'session')!;
    expect(session).toContain('HttpOnly');
    expect(await readSession(env, session.split(';')[0])).toEqual({ id: 'google_1', email: 'alice@example.com' });
    expect(await getUser(env, 'google_1')).toMatchObject({
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: 'https://lh3.googleusercontent.com/a/alice',
    });
    cleared(res);
    expect(cookieNamed(res, 'oauth_state')).toContain('Path=/auth');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init?.body as string);
    const verifier = decodeURIComponent(login.cookie.slice('oauth_state='.length)).split('.')[2];
    expect(Object.fromEntries(body)).toEqual({
      code: 'c0de',
      client_id: 'test-client',
      client_secret: 'test-secret',
      redirect_uri: `${ORIGIN}/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    expect(await sha256Base64Url(verifier)).toBe(login.location.searchParams.get('code_challenge'));
  });

  it('accepts the accounts.google.com issuer and a profile without name or picture', async () => {
    const { res } = await signIn({ iss: 'accounts.google.com', name: undefined, picture: 42 });
    expect(res.status).toBe(302);
    expect(await getUser(env, 'google_1')).toMatchObject({ name: null, avatarUrl: null });
  });

  it('lowercases the email and matches the allowlist case-insensitively', async () => {
    const { res } = await signIn({ email: 'Alice@Example.com' });
    expect(res.status).toBe(302);
    expect(await readSession(env, cookieNamed(res, 'session')!.split(';')[0])).toEqual({
      id: 'google_1',
      email: 'alice@example.com',
    });
  });

  it('keeps one user record across sign-ins and an email change', async () => {
    await signIn();
    const created = (await getUser(env, 'google_1'))!;
    await signIn({ email: 'bob@example.com' });
    expect(await getUser(env, 'google_1')).toMatchObject({ email: 'bob@example.com', createdAt: created.createdAt });
  });

  it('is 400 when Google reports an error, without calling Google', async () => {
    const login = await startLogin();
    const fetchMock = mockToken(json({}));
    const res = await callback(`error=access_denied&state=${login.state}`, login.cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Google sign-in was cancelled');
    expect(cookieNamed(res, 'session')).toBeUndefined();
    cleared(res);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is 400 for a state mismatch, missing or tampered cookie, missing code or missing state, without calling Google', async () => {
    const login = await startLogin();
    const other = await startLogin();
    const value = login.cookie.slice('oauth_state='.length);
    const tampered = `oauth_state=${value.slice(0, 3)}${value[3] === 'A' ? 'B' : 'A'}${value.slice(4)}`;
    const unsigned = `oauth_state=${encodeURIComponent(decodeURIComponent(value).split('.').slice(0, 3).join('.'))}`;
    const fetchMock = mockToken(json({ id_token: idToken(claims({}, login.nonce)) }));
    const responses = [
      await callback('code=c0de&state=other', login.cookie),
      await callback(`code=c0de&state=${login.state}`),
      await callback(`code=c0de&state=${login.state}`, tampered),
      await callback(`code=c0de&state=${login.state}`, unsigned),
      await callback(`code=c0de&state=${other.state}`, login.cookie),
      await callback(`state=${login.state}`, login.cookie),
      await callback('code=c0de', login.cookie),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(cookieNamed(res, 'session')).toBeUndefined();
      cleared(res);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is 502 when the token request rejects, is not OK, is not JSON or has no id_token', async () => {
    const failures: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('network down')),
      async () => json({ error: 'invalid_grant' }, 400),
      async () => new Response('<html>oops</html>'),
      async () => json({ access_token: 'ya29.secret' }),
      async () => json({ id_token: '' }),
      async () => json({ id_token: 'not-a-jwt' }),
      async () => json({ id_token: ['e30', toBase64Url(new TextEncoder().encode('null')), 'sig'].join('.') }),
    ];
    for (const failure of failures) {
      const login = await startLogin();
      mockToken(failure);
      const res = await callback(`code=c0de&state=${login.state}`, login.cookie);
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('Google sign-in failed');
      expect(cookieNamed(res, 'session')).toBeUndefined();
      cleared(res);
      vi.restoreAllMocks();
    }
    expect(await getUser(env, 'google_1')).toBeNull();
  });

  it('is 502 for ID token claims that do not validate', async () => {
    const bad: Record<string, unknown>[] = [
      { iss: 'https://evil.test' },
      { iss: undefined },
      { aud: 'other-client' },
      { aud: ['test-client'] },
      { exp: now() - 1 },
      { exp: undefined },
      { exp: String(now() + 3600) },
      { nonce: 'wrong' },
      { nonce: undefined },
      { sub: '' },
      { sub: 1 },
      { email: '' },
      { email: undefined },
    ];
    for (const overrides of bad) {
      const { res } = await signIn(overrides);
      expect(res.status, JSON.stringify(overrides)).toBe(502);
      expect(await res.text()).toBe('Google sign-in failed');
      expect(cookieNamed(res, 'session')).toBeUndefined();
      vi.restoreAllMocks();
    }
    expect(await getUser(env, 'google_1')).toBeNull();
  });

  it('is 403 when the email is not verified', async () => {
    for (const email_verified of [false, undefined, 'true']) {
      const { res } = await signIn({ email_verified });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('Email address is not verified');
      expect(cookieNamed(res, 'session')).toBeUndefined();
      vi.restoreAllMocks();
    }
    expect(await getUser(env, 'google_1')).toBeNull();
  });

  it('is 403 without a session for an email that is not allowed', async () => {
    for (const email of ['carol@example.com', 'alice@example.com.evil.test', 'xalice@example.com']) {
      const { res } = await signIn({ sub: '3', email });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(`${email} is not allowed to sign in`);
      expect(cookieNamed(res, 'session')).toBeUndefined();
      cleared(res);
      vi.restoreAllMocks();
    }
    expect(await getUser(env, 'google_3')).toBeNull();
  });

  it('never returns Google tokens', async () => {
    mockToken(json({ id_token: 'x', access_token: 'ya29.secret' }));
    const login = await startLogin();
    const res = await callback(`code=c0de&state=${login.state}`, login.cookie);
    expect(JSON.stringify([...res.headers]) + (await res.text())).not.toContain('ya29.secret');
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookie and redirects', async () => {
    const { cookie } = await createTestUser();
    const res = await request('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN }, redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
    expect(cookieNamed(res, 'session')).toContain('Max-Age=0');
  });

  it('accepts a request without an Origin header', async () => {
    expect((await request('/auth/logout', { method: 'POST', redirect: 'manual' })).status).toBe(303);
  });

  it('is 403 for a foreign Origin', async () => {
    const res = await request('/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.test' } });
    expect(res.status).toBe(403);
    expect(cookieNamed(res, 'session')).toBeUndefined();
  });
});

describe('/api/tokens', () => {
  const post = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
    request('/api/tokens', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('creates a token that authenticates', async () => {
    const { cookie } = await createTestUser();
    const res = await post(cookie, { name: 'laptop' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { token: string; id: string; name: string; createdAt: string };
    expect(created).toEqual({ token: expect.stringMatching(/^art_/), id: expect.any(String), name: 'laptop', createdAt: expect.any(String) });
    expect(await verifyApiToken(env, created.token)).toEqual({ id: 'google_1', email: 'alice@example.com' });
  });

  it('lists tokens without secrets', async () => {
    const { cookie, token } = await createTestUser();
    const created = (await (await post(cookie, { name: 'laptop' })).json()) as { id: string; token: string };
    const res = await request('/api/tokens', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      items: [
        { id: expect.any(String), name: 'test', createdAt: expect.any(String) },
        { id: created.id, name: 'laptop', createdAt: expect.any(String) },
      ],
    });
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(token);
    expect(text).not.toContain('hash');
  });

  it('only lists the signed-in user tokens', async () => {
    await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const res = await request('/api/tokens', { headers: { Cookie: bob.cookie } });
    expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(1);
  });

  it('revokes a token with 204', async () => {
    const { cookie } = await createTestUser();
    const created = (await (await post(cookie, { name: 'laptop' })).json()) as { id: string; token: string };
    const res = await request(`/api/tokens/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(await verifyApiToken(env, created.token)).toBeNull();
  });

  it('is 404 for an unknown or another user token id', async () => {
    const alice = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const created = (await (await post(alice.cookie, { name: 'laptop' })).json()) as { id: string; token: string };
    const del = (cookie: string, id: string) =>
      request(`/api/tokens/${id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } });
    for (const res of [await del(bob.cookie, created.id), await del(alice.cookie, 'nope')]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
    expect(await verifyApiToken(env, created.token)).toEqual({ id: 'google_1', email: 'alice@example.com' });
  });

  it('rejects Bearer tokens with 403', async () => {
    const { token } = await createTestUser();
    expect((await request('/api/tokens', { headers: bearer(token) })).status).toBe(403);
    const res = await request('/api/tokens', {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('is 401 without credentials', async () => {
    expect((await request('/api/tokens')).status).toBe(401);
    expect((await request('/api/tokens', { method: 'POST', body: '{"name":"x"}' })).status).toBe(401);
    expect((await request('/api/tokens/x', { method: 'DELETE' })).status).toBe(401);
  });

  it('is 403 for cookie writes without a matching Origin', async () => {
    const { cookie } = await createTestUser();
    const body = JSON.stringify({ name: 'x' });
    expect((await request('/api/tokens', { method: 'POST', headers: { Cookie: cookie }, body })).status).toBe(403);
    expect((await request('/api/tokens/x', { method: 'DELETE', headers: { Cookie: cookie } })).status).toBe(403);
  });

  it('is 400 for invalid JSON and invalid names', async () => {
    const { cookie } = await createTestUser();
    for (const body of ['{oops', 'null', '[]', {}, { name: 5 }, { name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }]) {
      const res = await post(cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
    expect((await env.KV.list({ prefix: 'user-token:' })).keys).toHaveLength(1);
  });
});

describe('route scope', () => {
  it('does not add auth to paths it does not own', async () => {
    const res = await routes.fetch(new Request(`${ORIGIN}/api/artifacts`, { method: 'POST' }), env);
    expect(res.status).toBe(404);
  });
});
