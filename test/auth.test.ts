import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactError } from '../src/artifacts';
import {
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  createApiToken,
  createSessionCookie,
  getUser,
  isAllowed,
  listApiTokens,
  readSession,
  requireSession,
  requireUser,
  revokeApiToken,
  upsertUser,
  verifyApiToken,
} from '../src/auth';
import type { AppEnv } from '../src/types';
import { ORIGIN, bearer, createTestUser } from './helpers';

afterEach(() => reset());

const T0 = new Date('2026-01-01T00:00:00.000Z');
const alice = { id: 'gh_1', login: 'alice' };
const cookieValue = (setCookie: string) => setCookie.split(';')[0];

describe('isAllowed', () => {
  const withUsers = (ALLOWED_USERS: string) => ({ ...env, ALLOWED_USERS }) as Env;

  it('matches a trimmed, case-insensitive comma list', () => {
    const e = withUsers(' Alice , bob,');
    expect(isAllowed(e, 'alice')).toBe(true);
    expect(isAllowed(e, 'BOB')).toBe(true);
    expect(isAllowed(e, 'carol')).toBe(false);
  });

  it('allows everyone for * and nobody when empty', () => {
    expect(isAllowed(withUsers('*'), 'anyone')).toBe(true);
    expect(isAllowed(withUsers(''), 'alice')).toBe(false);
    expect(isAllowed(withUsers(' , '), 'alice')).toBe(false);
  });
});

describe('users', () => {
  it('upserts keeping createdAt and updating profile fields', async () => {
    const first = await upsertUser(env, { githubId: 7, login: 'alice', name: null, avatarUrl: null }, T0);
    expect(first).toEqual({ id: 'gh_7', login: 'alice', name: null, avatarUrl: null, createdAt: T0.toISOString() });
    const later = new Date(T0.getTime() + 1000);
    const second = await upsertUser(env, { githubId: 7, login: 'alice2', name: 'Alice', avatarUrl: 'u' }, later);
    expect(second).toEqual({ id: 'gh_7', login: 'alice2', name: 'Alice', avatarUrl: 'u', createdAt: T0.toISOString() });
    expect(await getUser(env, 'gh_7')).toEqual(second);
    expect(await getUser(env, 'gh_8')).toBeNull();
  });
});

describe('sessions', () => {
  it('creates a hardened cookie and reads it back', async () => {
    const setCookie = await createSessionCookie(env, alice, T0);
    expect(setCookie).toMatch(/^session=[\w-]+\.[\w-]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/);
    expect(SESSION_TTL_SECONDS).toBe(604800);
    expect(await readSession(env, `other=1; ${cookieValue(setCookie)}`, T0)).toEqual(alice);
  });

  it('rejects missing, malformed and tampered cookies', async () => {
    const value = cookieValue(await createSessionCookie(env, alice, T0));
    const [payload, signature] = value.slice('session='.length).split('.');
    const forged = btoa(JSON.stringify({ uid: 'gh_2', login: 'bob', exp: 9999999999 })).replace(/=+$/, '');
    expect(await readSession(env, undefined, T0)).toBeNull();
    expect(await readSession(env, 'other=1', T0)).toBeNull();
    expect(await readSession(env, 'session=', T0)).toBeNull();
    expect(await readSession(env, 'session=garbage', T0)).toBeNull();
    expect(await readSession(env, `session=${payload}`, T0)).toBeNull();
    expect(await readSession(env, `session=${payload}.${signature}.x`, T0)).toBeNull();
    expect(await readSession(env, `session=${payload}.!!!`, T0)).toBeNull();
    expect(await readSession(env, `session=${forged}.${signature}`, T0)).toBeNull();
    expect(await readSession(env, `session=${payload}.${signature.slice(0, -2)}AA`, T0)).toBeNull();
  });

  it('rejects an expired cookie', async () => {
    const value = cookieValue(await createSessionCookie(env, alice, T0));
    const justBefore = new Date(T0.getTime() + SESSION_TTL_SECONDS * 1000 - 1000);
    const atExpiry = new Date(T0.getTime() + SESSION_TTL_SECONDS * 1000);
    expect(await readSession(env, value, justBefore)).toEqual(alice);
    expect(await readSession(env, value, atExpiry)).toBeNull();
  });

  it('rejects a cookie signed with another secret', async () => {
    const other = { ...env, SESSION_SECRET: 'a-completely-different-secret-0123456789' } as Env;
    const value = cookieValue(await createSessionCookie(other, alice, T0));
    expect(await readSession(env, value, T0)).toBeNull();
    expect(await readSession(other, value, T0)).toEqual(alice);
  });

  it('builds a clearing cookie', () => {
    expect(clearSessionCookie()).toBe('session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  });
});

describe('API tokens', () => {
  it('creates, verifies, lists and revokes', async () => {
    const created = await createApiToken(env, alice, 'laptop', T0);
    expect(created.token).toMatch(/^art_[\w-]{43}$/);
    expect(created.id).toHaveLength(22);
    expect(created).toMatchObject({ name: 'laptop', createdAt: T0.toISOString() });
    expect(await verifyApiToken(env, created.token)).toEqual(alice);
    expect(await verifyApiToken(env, 'art_unknown')).toBeNull();

    const second = await createApiToken(env, alice, 'ci', new Date(T0.getTime() + 1000));
    await createApiToken(env, { id: 'gh_2', login: 'bob' }, 'bobs', T0);
    expect(await listApiTokens(env, alice.id)).toEqual([
      { id: created.id, name: 'laptop', createdAt: T0.toISOString() },
      { id: second.id, name: 'ci', createdAt: new Date(T0.getTime() + 1000).toISOString() },
    ]);

    await revokeApiToken(env, alice.id, created.id);
    expect(await verifyApiToken(env, created.token)).toBeNull();
    expect(await verifyApiToken(env, second.token)).toEqual(alice);
    expect((await listApiTokens(env, alice.id)).map((t) => t.id)).toEqual([second.id]);
  });

  it('validates the token name and trims it', async () => {
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      await expect(createApiToken(env, alice, name, T0)).rejects.toMatchObject({ status: 400 });
    }
    expect((await createApiToken(env, alice, `  ${'x'.repeat(100)}  `, T0)).name).toHaveLength(100);
    expect((await env.KV.list()).keys).toHaveLength(2);
  });

  it('is 404 when revoking another user token or an unknown id', async () => {
    const created = await createApiToken(env, alice, 'laptop', T0);
    for (const attempt of [revokeApiToken(env, 'gh_2', created.id), revokeApiToken(env, alice.id, 'nope')]) {
      await expect(attempt).rejects.toBeInstanceOf(ArtifactError);
      await expect(attempt).rejects.toMatchObject({ status: 404 });
    }
    expect(await verifyApiToken(env, created.token)).toEqual(alice);
  });

  it('stores only the SHA-256 hash of the token', async () => {
    const created = await createApiToken(env, alice, 'laptop', T0);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(created.token)));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    const kv = await env.KV.list();
    const names = kv.keys.map((k) => k.name).sort();
    expect(names).toEqual([`token:${hash}`, `user-token:${alice.id}:${created.id}`].sort());
    expect(JSON.stringify(kv.keys)).not.toContain(created.token);
    expect(await env.KV.get(`token:${hash}`, 'json')).toEqual({
      id: created.id,
      userId: alice.id,
      login: 'alice',
      name: 'laptop',
      createdAt: T0.toISOString(),
    });
    expect(kv.keys.find((k) => k.name.startsWith('user-token:'))?.metadata).toEqual({
      name: 'laptop',
      createdAt: T0.toISOString(),
      hash,
    });
    expect((await env.BUCKET.list()).objects).toEqual([]);
  });
});

describe('middleware', () => {
  const app = new Hono<AppEnv>();
  app.all('/user', requireUser, (c) => c.json({ user: c.var.user, method: c.var.authMethod }));
  app.all('/session', requireSession, (c) => c.json({ user: c.var.user, method: c.var.authMethod }));
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(ORIGIN + path, init), env);

  it('accepts a bearer token', async () => {
    const { token } = await createTestUser();
    const res = await call('/user', { headers: bearer(token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: alice, method: 'token' });
  });

  it('accepts a session cookie', async () => {
    const { cookie } = await createTestUser();
    const res = await call('/user', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: alice, method: 'session' });
  });

  it('is 401 JSON without credentials', async () => {
    const res = await call('/user');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it('is 401 for a bad bearer token even with a valid cookie', async () => {
    const { cookie } = await createTestUser();
    expect((await call('/user', { headers: bearer('art_bad') })).status).toBe(401);
    expect((await call('/user', { headers: { ...bearer('art_bad'), Cookie: cookie } })).status).toBe(401);
    expect((await call('/user', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
  });

  it('re-checks the allowlist for tokens and cookies', async () => {
    const carol = await createTestUser('carol', 3);
    expect((await call('/user', { headers: bearer(carol.token) })).status).toBe(401);
    expect((await call('/user', { headers: { Cookie: carol.cookie } })).status).toBe(401);
    const open = { ...env, ALLOWED_USERS: '*' } as Env;
    const res = await app.fetch(new Request(ORIGIN + '/user', { headers: bearer(carol.token) }), open);
    expect(res.status).toBe(200);
  });

  it('rejects an expired cookie', async () => {
    const { user } = await createTestUser();
    const old = cookieValue(await createSessionCookie(env, user, new Date(Date.now() - 8 * 24 * 3600 * 1000)));
    expect((await call('/user', { headers: { Cookie: old } })).status).toBe(401);
  });

  it('enforces CSRF origin checks on cookie-authenticated writes only', async () => {
    const { cookie, token } = await createTestUser();
    const post = (headers: Record<string, string>) => call('/user', { method: 'POST', headers });
    expect((await post({ Cookie: cookie })).status).toBe(403);
    expect((await post({ Cookie: cookie, Origin: 'https://evil.test' })).status).toBe(403);
    expect((await post({ Cookie: cookie, Origin: ORIGIN })).status).toBe(200);
    expect((await call('/user', { method: 'DELETE', headers: { Cookie: cookie } })).status).toBe(403);
    expect((await call('/user', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await call('/user', { method: 'HEAD', headers: { Cookie: cookie } })).status).toBe(200);
    expect((await call('/user', { method: 'OPTIONS', headers: { Cookie: cookie } })).status).toBe(200);
    expect((await post(bearer(token))).status).toBe(200);
  });

  it('requireSession accepts cookies and rejects bearer tokens with 403', async () => {
    const { cookie, token } = await createTestUser();
    expect((await call('/session', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await call('/session', { headers: bearer(token) })).status).toBe(403);
    expect((await call('/session', { headers: { ...bearer(token), Cookie: cookie } })).status).toBe(403);
    expect((await call('/session', { headers: bearer('art_bad') })).status).toBe(401);
    expect((await call('/session')).status).toBe(401);
    expect((await call('/session', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(403);
    expect((await call('/session', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })).status).toBe(200);
  });
});
