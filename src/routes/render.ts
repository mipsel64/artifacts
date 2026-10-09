import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { ArtifactError, fileName, getArtifact, getContent, getSharedArtifact } from '../artifacts';
import { requireUser } from '../auth';
import { renderDocument } from '../render';
import type { AppEnv } from '../types';

const HTML = 'text/html; charset=utf-8';
const SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';

const sandboxHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header('Content-Security-Policy', SANDBOX);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'private, no-store');
  await next();
};

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new ArtifactError(400, 'v must be a positive integer');
  return Number(value);
}

const routes = new Hono<AppEnv>();

routes.use('/render/:id', sandboxHeaders);
routes.use('/s/:shareId/render', sandboxHeaders);
routes.use('/s/:shareId/raw', sandboxHeaders);

routes.get('/render/:id', requireUser, async (c) => {
  const version = parseVersion(c.req.query('v'));
  const meta = await getArtifact(c.env, c.var.user.id, c.req.param('id'));
  return c.body(renderDocument(meta, await getContent(c.env, meta, version)), 200, { 'Content-Type': HTML });
});

routes.get('/s/:shareId/render', async (c) => {
  const meta = await getSharedArtifact(c.env, c.req.param('shareId'));
  return c.body(renderDocument(meta, await getContent(c.env, meta)), 200, { 'Content-Type': HTML });
});

routes.get('/s/:shareId/raw', async (c) => {
  const meta = await getSharedArtifact(c.env, c.req.param('shareId'));
  if (c.req.query('download') === '1') c.header('Content-Disposition', `attachment; filename="${fileName(meta)}"`);
  return c.body(await getContent(c.env, meta), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

export default routes;
