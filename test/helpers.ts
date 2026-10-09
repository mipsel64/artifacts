import { env, exports } from 'cloudflare:workers';
import { createApiToken, createSessionCookie, upsertUser } from '../src/auth';
import type { User } from '../src/types';

export const ORIGIN = 'https://artifacts.test';

export function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(ORIGIN + path, init));
}

export async function createTestUser(
  login = 'alice',
  githubId = 1,
): Promise<{ user: User; token: string; cookie: string }> {
  const user = await upsertUser(env, { githubId, login, name: login, avatarUrl: null });
  const { token } = await createApiToken(env, user, 'test');
  const cookie = (await createSessionCookie(env, user)).split(';')[0];
  return { user, token, cookie };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
