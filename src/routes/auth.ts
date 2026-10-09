import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ArtifactError, randomId } from '../artifacts';
import {
  clearSessionCookie,
  createApiToken,
  createSessionCookie,
  isAllowed,
  listApiTokens,
  requireSession,
  revokeApiToken,
  upsertUser,
} from '../auth';
import type { AppEnv } from '../types';

const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_PATH = '/auth';
const SIGN_IN_FAILED = 'GitHub sign-in failed';

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

const routes = new Hono<AppEnv>();

routes.get('/auth/login', (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.text('GitHub OAuth is not configured', 500);
  const state = randomId();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    scope: 'read:user',
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
});

routes.get('/auth/callback', async (c) => {
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, httpOnly: true, secure: true, sameSite: 'Lax' });
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state || !expected || state !== expected) return c.text('Invalid OAuth callback', 400);

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    }),
  }).catch(() => null);
  const accessToken = tokenResponse?.ok
    ? ((await tokenResponse.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token
    : undefined;
  if (typeof accessToken !== 'string' || !accessToken) return c.text(SIGN_IN_FAILED, 502);

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'artifacts',
    },
  }).catch(() => null);
  const profile = userResponse?.ok ? ((await userResponse.json().catch(() => null)) as GitHubUser | null) : null;
  if (!profile || typeof profile.id !== 'number' || typeof profile.login !== 'string') {
    return c.text(SIGN_IN_FAILED, 502);
  }

  if (!isAllowed(c.env, profile.login)) return c.text(`${profile.login} is not allowed to sign in`, 403);
  const user = await upsertUser(c.env, {
    githubId: profile.id,
    login: profile.login,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url ?? null,
  });
  c.header('Set-Cookie', await createSessionCookie(c.env, user), { append: true });
  return c.redirect('/', 302);
});

routes.post('/auth/logout', (c) => {
  const origin = c.req.header('Origin');
  if (origin !== undefined && origin !== new URL(c.req.url).origin) return c.text('Forbidden', 403);
  c.header('Set-Cookie', clearSessionCookie());
  return c.redirect('/', 303);
});

routes.get('/api/tokens', requireSession, async (c) => c.json({ items: await listApiTokens(c.env, c.var.user.id) }));

routes.post('/api/tokens', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.name !== 'string') throw new ArtifactError(400, 'name must be a string');
  return c.json(await createApiToken(c.env, c.var.user, body.name), 201);
});

routes.delete('/api/tokens/:id', requireSession, async (c) => {
  await revokeApiToken(c.env, c.var.user.id, c.req.param('id'));
  return c.body(null, 204);
});

export default routes;
