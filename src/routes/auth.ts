import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { ArtifactError, randomId } from '../artifacts';
import {
  VIEWER_SESSION_TTL_SECONDS,
  clearSessionCookie,
  createApiToken,
  createSessionCookie,
  fromBase64Url,
  isAllowed,
  listApiTokens,
  requireSession,
  revokeApiToken,
  toBase64Url,
  upsertUser,
} from '../auth';
import type { AppEnv } from '../types';

const STATE_COOKIE = '__Host-oauth_state';
const SIGN_IN_FAILED = 'Google sign-in failed';
export const MAX_NEXT_LENGTH = 2000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SHARE_PATH_PATTERN = /^\/s\/[A-Za-z0-9_-]{1,64}$/;
const RENDER_PATH_PATTERN = /^\/r\/[A-Za-z0-9_-]{1,64}$/;

// Only local authorize, owner render or share paths: the sign-in redirect must never leave the app (no open redirect).
function safeNext(raw: string | undefined | null, origin: string): string | null {
  if (!raw || raw.length > MAX_NEXT_LENGTH) return null;
  if (SHARE_PATH_PATTERN.test(raw) || RENDER_PATH_PATTERN.test(raw)) return raw;
  if (!raw.startsWith('/authorize?')) return null;
  const url = new URL(raw, origin);
  return url.origin === origin && url.pathname === '/authorize' ? url.pathname + url.search : null;
}

const routes = new Hono<AppEnv>();

routes.get('/auth/login', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text('Google sign-in is not configured', 500);
  const state = randomId();
  const nonce = randomId();
  const verifier = randomId(32);
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const next = safeNext(c.req.query('next'), new URL(c.req.url).origin);
  // `next` goes last because it can contain dots.
  await setSignedCookie(c, STATE_COOKIE, [state, nonce, verifier, ...(next ? [next] : [])].join('.'), c.env.SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

routes.get('/auth/callback', async (c) => {
  const saved = await getSignedCookie(c, c.env.SESSION_SECRET, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  if (c.req.query('error') !== undefined) return c.text('Google sign-in was cancelled', 400);
  const code = c.req.query('code');
  const state = c.req.query('state');
  const [expectedState, nonce, verifier, ...nextParts] = saved ? saved.split('.') : [];
  if (!code || !state || !verifier || state !== expectedState) return c.text('Invalid OAuth callback', 400);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  }).catch(() => null);
  const idToken = tokenResponse?.ok
    ? ((await tokenResponse.json().catch(() => null)) as { id_token?: unknown } | null)?.id_token
    : undefined;
  if (typeof idToken !== 'string' || !idToken) return c.text(SIGN_IN_FAILED, 502);

  // The signature is not verified: the token comes straight from Google's token endpoint over TLS, authenticated with our
  // client secret (OpenID Connect Core 3.1.3.7).
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(idToken.split('.')[1])));
  } catch {
    return c.text(SIGN_IN_FAILED, 502);
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return c.text(SIGN_IN_FAILED, 502);
  const { iss, aud, exp, sub, email, email_verified, name, picture } = claims;
  if (
    typeof iss !== 'string' || !GOOGLE_ISSUERS.includes(iss) ||
    aud !== c.env.GOOGLE_CLIENT_ID ||
    typeof exp !== 'number' || exp <= Date.now() / 1000 ||
    claims.nonce !== nonce ||
    typeof sub !== 'string' || !sub ||
    typeof email !== 'string' || !email
  ) {
    return c.text(SIGN_IN_FAILED, 502);
  }
  if (email_verified !== true) return c.text('Email address is not verified', 403);
  if (!/^[\x21-\x7e]+$/.test(email)) return c.text(`${email} is not allowed to sign in`, 403);
  const origin = new URL(c.req.url).origin;
  const next = safeNext(nextParts.join('.'), origin);
  const hostedDomain = typeof claims.hd === 'string' && claims.hd ? claims.hd.toLowerCase() : null;
  if (!isAllowed(c.env, email)) {
    if (!next || !SHARE_PATH_PATTERN.test(next)) return c.text(`${email} is not allowed to sign in`, 403);
    const viewer = { id: `google_${sub}`, email: email.toLowerCase(), hostedDomain };
    c.header('Set-Cookie', await createSessionCookie(c.env, viewer, undefined, VIEWER_SESSION_TTL_SECONDS), { append: true });
    return c.redirect(next, 302);
  }
  const user = await upsertUser(c.env, {
    sub,
    email,
    name: typeof name === 'string' ? name : null,
    avatarUrl: typeof picture === 'string' ? picture : null,
  });
  c.header('Set-Cookie', await createSessionCookie(c.env, { ...user, hostedDomain }), { append: true });
  return c.redirect(next ?? '/', 302);
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
