import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { ArtifactError, canViewShare, fileName, getArtifact, getContent, getSharedArtifact } from '../artifacts';
import { authenticate, readSession } from '../auth';
import { renderStoredDocument } from '../render';
import type { AppEnv } from '../types';

const HTML = 'text/html; charset=utf-8';
const SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';

const sandboxHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header('Content-Security-Policy', SANDBOX);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  // no-transform stops Cloudflare injecting its analytics and bot scripts, which fail inside the opaque-origin sandbox.
  c.header('Cache-Control', 'private, no-store, no-transform');
  await next();
};

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new ArtifactError(400, 'v must be a positive integer');
  return Number(value);
}

const routes = new Hono<AppEnv>();

const requireRenderUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await authenticate(c);
  if (!auth) {
    if (c.req.header('Sec-Fetch-Dest') === 'document') {
      const renderPath = `/r/${c.req.param('id')}`;
      return c.redirect(`/auth/login?next=${encodeURIComponent(renderPath)}`, 302);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', auth.user);
  c.set('authMethod', auth.method);
  await next();
};

routes.use('/r/:id', sandboxHeaders);
routes.use('/s/:shareId/render', sandboxHeaders);
routes.use('/s/:shareId/raw', sandboxHeaders);

routes.get('/r/:id', requireRenderUser, async (c) => {
  const version = parseVersion(c.req.query('v'));
  const meta = await getArtifact(c.env, c.var.user.id, c.req.param('id'));
  const print = c.req.query('print') === '1';
  return c.body(await renderStoredDocument(c.env, meta, await getContent(c.env, meta, version), print, version), 200, { 'Content-Type': HTML });
});

routes.get('/s/:shareId/render', async (c) => {
  const meta = await getSharedArtifact(c.env, c.req.param('shareId'));
  const viewer = await readSession(c.env, c.req.header('Cookie'));
  if (!canViewShare(meta, viewer)) throw new ArtifactError(403, 'Sign in with an account that has access to this link');
  const print = c.req.query('print') === '1';
  return c.body(await renderStoredDocument(c.env, meta, await getContent(c.env, meta), print), 200, { 'Content-Type': HTML });
});

routes.get('/s/:shareId/raw', async (c) => {
  const meta = await getSharedArtifact(c.env, c.req.param('shareId'));
  const viewer = await readSession(c.env, c.req.header('Cookie'));
  if (!canViewShare(meta, viewer)) throw new ArtifactError(403, 'Sign in with an account that has access to this link');
  const content = await getContent(c.env, meta);
  if (c.req.query('download') === '1') c.header('Content-Disposition', `attachment; filename="${fileName(meta, content)}"`);
  return c.body(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

export default routes;
