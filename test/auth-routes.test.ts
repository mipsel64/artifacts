import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUser, readSession, verifyApiToken } from '../src/auth';
import routes from '../src/routes/auth';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  return reset();
});

const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieNamed = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));
const json = (body: unknown, status = 200) => Response.json(body, { status });

function mockGitHub(token: Response, user?: Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new Request(input).url;
    if (url === 'https://github.com/login/oauth/access_token') return token;
    if (url === 'https://api.github.com/user' && user) return user;
    throw new Error(`unexpected fetch ${url}`);
  });
}

const githubUser = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://avatars.test/a.png' };

// Called in-process so that the fetch spy sees the Worker's outbound GitHub requests.
const callback = (state = 'abc', cookie: string | null = 'oauth_state=abc', query = `code=c0de&state=${state}`) =>
  routes.fetch(new Request(`${ORIGIN}/auth/callback?${query}`, { headers: cookie ? { Cookie: cookie } : {} }), env);

describe('GET /auth/login', () => {
  it('redirects to GitHub with a state that matches the cookie', async () => {
    const res = await request('/auth/login', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('test-client');
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    const state = location.searchParams.get('state')!;
    expect(state).toHaveLength(22);
    const cookie = cookieNamed(res, 'oauth_state')!;
    expect(cookie.split(';')[0]).toBe(`oauth_state=${state}`);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/auth', 'Max-Age=600']) {
      expect(cookie).toContain(attribute);
    }
  });

  it('is 500 when GitHub OAuth is not configured', async () => {
    const res = await routes.fetch(new Request(`${ORIGIN}/auth/login`), { ...env, GITHUB_CLIENT_ID: '' } as Env);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('GitHub OAuth is not configured');
  });
});

describe('GET /auth/callback', () => {
  it('signs the user in', async () => {
    const fetchMock = mockGitHub(json({ access_token: 'gho_secret' }), json(githubUser));
    const res = await callback();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');

    const session = cookieNamed(res, 'session')!;
    expect(session).toContain('HttpOnly');
    expect(await readSession(env, session.split(';')[0])).toEqual({ id: 'gh_1', login: 'alice' });
    expect(await getUser(env, 'gh_1')).toMatchObject({ login: 'alice', name: 'Alice', avatarUrl: githubUser.avatar_url });
    expect(cookieNamed(res, 'oauth_state')).toMatch(/Max-Age=0|Expires=/);
    expect(cookieNamed(res, 'oauth_state')).toContain('Path=/auth');
    expect(JSON.stringify([...res.headers])).not.toContain('gho_secret');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenReq, userReq] = fetchMock.mock.calls;
    expect(tokenReq[0]).toBe('https://github.com/login/oauth/access_token');
    expect(tokenReq[1]?.method).toBe('POST');
    expect(new Headers(tokenReq[1]?.headers).get('Accept')).toBe('application/json');
    expect(JSON.parse(tokenReq[1]?.body as string)).toEqual({
      client_id: 'test-client',
      client_secret: 'test-secret',
      code: 'c0de',
      redirect_uri: `${ORIGIN}/auth/callback`,
    });
    expect(userReq[0]).toBe('https://api.github.com/user');
    const headers = new Headers(userReq[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer gho_secret');
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('User-Agent')).toBe('artifacts');
  });

  it('is 400 for a state mismatch, missing cookie, missing code or missing state, without calling GitHub', async () => {
    const fetchMock = mockGitHub(json({ access_token: 't' }), json(githubUser));
    const responses = [
      await callback('other'),
      await callback('abc', null),
      await callback('abc', 'oauth_state=abc', 'state=abc'),
      await callback('abc', 'oauth_state=abc', 'code=c0de'),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(cookieNamed(res, 'session')).toBeUndefined();
      expect(cookieNamed(res, 'oauth_state')).toMatch(/Max-Age=0|Expires=/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is 502 when the token exchange fails', async () => {
    for (const token of [json({ error: 'bad_verification_code' }), json({}, 500)]) {
      mockGitHub(token);
      const res = await callback();
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('GitHub sign-in failed');
      expect(cookieNamed(res, 'session')).toBeUndefined();
      expect(cookieNamed(res, 'oauth_state')).toBeDefined();
      vi.restoreAllMocks();
    }
  });

  it('is 502 when the user lookup fails', async () => {
    mockGitHub(json({ access_token: 't' }), json({ message: 'Bad credentials' }, 401));
    const res = await callback();
    expect(res.status).toBe(502);
    expect(cookieNamed(res, 'session')).toBeUndefined();
    expect(await getUser(env, 'gh_1')).toBeNull();
  });

  it('is 502 with the state cookie cleared when the token exchange request rejects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    const res = await callback();
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('GitHub sign-in failed');
    expect(cookieNamed(res, 'session')).toBeUndefined();
    expect(cookieNamed(res, 'oauth_state')).toMatch(/Max-Age=0|Expires=/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is 502 with the state cookie cleared when the user request rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new Request(input).url === 'https://github.com/login/oauth/access_token') return json({ access_token: 't' });
      throw new TypeError('network down');
    });
    const res = await callback();
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('GitHub sign-in failed');
    expect(cookieNamed(res, 'session')).toBeUndefined();
    expect(cookieNamed(res, 'oauth_state')).toMatch(/Max-Age=0|Expires=/);
    expect(await getUser(env, 'gh_1')).toBeNull();
  });

  it('is 403 without a session for a login that is not allowed', async () => {
    mockGitHub(json({ access_token: 't' }), json({ ...githubUser, id: 3, login: 'carol' }));
    const res = await callback();
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('carol is not allowed to sign in');
    expect(cookieNamed(res, 'session')).toBeUndefined();
    expect(cookieNamed(res, 'oauth_state')).toBeDefined();
    expect(await getUser(env, 'gh_3')).toBeNull();
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
    expect(await verifyApiToken(env, created.token)).toEqual({ id: 'gh_1', login: 'alice' });
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
    await createTestUser('alice', 1);
    const bob = await createTestUser('bob', 2);
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
    const alice = await createTestUser('alice', 1);
    const bob = await createTestUser('bob', 2);
    const created = (await (await post(alice.cookie, { name: 'laptop' })).json()) as { id: string; token: string };
    const del = (cookie: string, id: string) =>
      request(`/api/tokens/${id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } });
    for (const res of [await del(bob.cookie, created.id), await del(alice.cookie, 'nope')]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
    expect(await verifyApiToken(env, created.token)).toEqual({ id: 'gh_1', login: 'alice' });
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
