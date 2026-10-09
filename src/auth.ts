import type { Context, MiddlewareHandler } from 'hono';
import { ArtifactError, randomId } from './artifacts';
import type { AppEnv, SessionUser, User } from './types';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

const MAX_TOKEN_NAME_LENGTH = 100;
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';
const encoder = new TextEncoder();

export const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

const hmacKey = (env: Env, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isAllowed(env: Env, email: string): boolean {
  const allowed = env.ALLOWED_EMAILS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

const userKey = (userId: string) => `user:${userId}`;
const tokenKey = (hash: string) => `token:${hash}`;
const userTokenKey = (userId: string, tokenId: string) => `user-token:${userId}:${tokenId}`;

export async function upsertUser(
  env: Env,
  user: { sub: string; email: string; name: string | null; avatarUrl: string | null },
  now: Date = new Date(),
): Promise<User> {
  const id = `google_${user.sub}`;
  const existing = await getUser(env, id);
  const saved: User = {
    id,
    email: user.email.toLowerCase(),
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  await env.KV.put(userKey(id), JSON.stringify(saved));
  return saved;
}

export function getUser(env: Env, userId: string): Promise<User | null> {
  return env.KV.get<User>(userKey(userId), 'json');
}

export async function createSessionCookie(env: Env, user: SessionUser, now: Date = new Date()): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ uid: user.id, email: user.email, exp })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env, 'sign'), encoder.encode(payload)));
  return `${SESSION_COOKIE}=${payload}.${toBase64Url(signature)}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

export async function readSession(
  env: Env,
  cookieHeader: string | undefined,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const parts = value?.split('.');
  if (!parts || parts.length !== 2) return null;
  try {
    const [payload, signature] = parts;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env, 'verify'),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof data.uid !== 'string' || typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { id: data.uid, email: data.email };
  } catch {
    return null;
  }
}

export async function createApiToken(
  env: Env,
  user: SessionUser,
  name: string,
  now: Date = new Date(),
): Promise<{ token: string; id: string; name: string; createdAt: string }> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length < 1 || trimmed.length > MAX_TOKEN_NAME_LENGTH) {
    throw new ArtifactError(400, `name must be 1..${MAX_TOKEN_NAME_LENGTH} characters`);
  }
  name = trimmed;
  const token = `art_${randomId(32)}`;
  const id = randomId();
  const createdAt = now.toISOString();
  const hash = await sha256Hex(token);
  await env.KV.put(userTokenKey(user.id, id), '', { metadata: { name, createdAt, hash } });
  await env.KV.put(tokenKey(hash), JSON.stringify({ id, userId: user.id, email: user.email, name, createdAt }));
  return { token, id, name, createdAt };
}

export async function listApiTokens(
  env: Env,
  userId: string,
): Promise<{ id: string; name: string; createdAt: string }[]> {
  const prefix = userTokenKey(userId, '');
  const items: { id: string; name: string; createdAt: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.KV.list<{ name: string; createdAt: string }>({ prefix, cursor });
    for (const key of page.keys) {
      if (key.metadata) items.push({ id: key.name.slice(prefix.length), name: key.metadata.name, createdAt: key.metadata.createdAt });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function revokeApiToken(env: Env, userId: string, tokenId: string): Promise<void> {
  const { value, metadata } = await env.KV.getWithMetadata<{ hash: string }>(userTokenKey(userId, tokenId));
  if (value === null || !metadata) throw new ArtifactError(404, 'Token not found');
  await env.KV.delete(tokenKey(metadata.hash));
  await env.KV.delete(userTokenKey(userId, tokenId));
}

export async function verifyApiToken(env: Env, token: string): Promise<SessionUser | null> {
  const record = await env.KV.get<{ userId: string; email: string }>(tokenKey(await sha256Hex(token)), 'json');
  return record ? { id: record.userId, email: record.email } : null;
}

type Authenticated = { user: SessionUser; method: 'session' | 'token' };

export async function authenticate(c: Context<AppEnv>): Promise<Authenticated | null> {
  const header = c.req.header('Authorization');
  let result: Authenticated | null = null;
  if (header !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const user = match ? await verifyApiToken(c.env, match[1]) : null;
    result = user && { user, method: 'token' };
  } else {
    const user = await readSession(c.env, c.req.header('Cookie'));
    result = user && { user, method: 'session' };
  }
  return result && isAllowed(c.env, result.user.email) ? result : null;
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await authenticate(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (auth.method === 'session' && !SAFE_METHODS.includes(c.req.method) && c.req.header('Origin') !== new URL(c.req.url).origin) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  c.set('user', auth.user);
  c.set('authMethod', auth.method);
  await next();
};

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('Authorization') !== undefined && (await authenticate(c))?.method === 'token') {
    return c.json({ error: 'API tokens are not accepted here' }, 403);
  }
  return requireUser(c, next);
};
