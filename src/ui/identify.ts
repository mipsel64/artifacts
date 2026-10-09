import type { Context } from 'hono';
import { authenticate, getUser } from '../auth';
import type { AppEnv } from '../types';
import type { Identity } from './layout';

export async function identify(c: Context<AppEnv>): Promise<(Identity & { id: string }) | null> {
  const auth = await authenticate(c);
  if (!auth) return null;
  const profile = await getUser(c.env, auth.user.id);
  return { id: auth.user.id, email: auth.user.email, name: profile?.name ?? null, avatarUrl: profile?.avatarUrl ?? null };
}
