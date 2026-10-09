import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ArtifactError,
  createArtifact,
  deleteArtifact,
  fileName,
  fileSlug,
  getArtifact,
  getContent,
  listArtifacts,
  setRetention,
  shareArtifact,
  toView,
  unshareArtifact,
  updateArtifact,
} from '../artifacts';
import { requireUser } from '../auth';
import { renderDocument } from '../render';
import type { AppEnv, ArtifactType } from '../types';

const routes = new Hono<AppEnv>();

routes.use('/api/artifacts/*', requireUser);

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ArtifactError(400, 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

routes.get('/api/artifacts', async (c) => c.json({ items: await listArtifacts(c.env, c.var.user.id) }));

routes.post('/api/artifacts', async (c) => {
  const body = await readBody(c);
  const meta = await createArtifact(c.env, c.var.user.id, {
    title: body.title as string,
    type: body.type as ArtifactType,
    content: body.content as string,
    language: body.language as string | null | undefined,
  });
  return c.json(toView(meta, origin(c)), 201);
});

routes.get('/api/artifacts/:id', async (c) =>
  c.json(toView(await getArtifact(c.env, c.var.user.id, c.req.param('id')), origin(c))),
);

routes.get('/api/artifacts/:id/content', async (c) => {
  const versionParam = c.req.query('version');
  if (versionParam !== undefined && !/^[1-9]\d*$/.test(versionParam)) {
    throw new ArtifactError(400, 'version must be a positive integer');
  }
  const meta = await getArtifact(c.env, c.var.user.id, c.req.param('id'));
  const content = await getContent(c.env, meta, versionParam === undefined ? undefined : Number(versionParam));
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
  if (c.req.query('download') === '1') headers['Content-Disposition'] = `attachment; filename="${fileName(meta)}"`;
  return c.body(content, 200, headers);
});

// Fenced-block tag for the Markdown export; `markdown` exports as-is, `code` uses its language.
const MD_FENCES: Record<Exclude<ArtifactType, 'markdown' | 'code'>, string> = {
  html: 'html',
  react: 'jsx',
  svg: 'svg',
  mermaid: 'mermaid',
};

function asMarkdown(meta: { title: string; type: ArtifactType; language: string | null }, content: string): string {
  const heading = `# ${meta.title}\n\n`;
  if (meta.type === 'markdown') return heading + content;
  const tag = meta.type === 'code' ? (meta.language ?? '') : MD_FENCES[meta.type];
  // The fence must outlast every backtick run in the content or the block breaks open.
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return heading + fence + tag + '\n' + content + '\n' + fence + '\n';
}

routes.get('/api/artifacts/:id/export', async (c) => {
  const format = c.req.query('format');
  if (format !== 'md' && format !== 'html') throw new ArtifactError(400, 'format must be md or html');
  const versionParam = c.req.query('version');
  if (versionParam !== undefined && !/^[1-9]\d*$/.test(versionParam)) {
    throw new ArtifactError(400, 'version must be a positive integer');
  }
  const meta = await getArtifact(c.env, c.var.user.id, c.req.param('id'));
  const content = await getContent(c.env, meta, versionParam === undefined ? undefined : Number(versionParam));
  const body = format === 'md' ? asMarkdown(meta, content) : renderDocument(meta, content);
  return c.body(body, 200, {
    'Content-Type': format === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${fileSlug(meta)}.${format}"`,
  });
});

routes.patch('/api/artifacts/:id', async (c) => {
  const body = await readBody(c);
  const meta = await updateArtifact(c.env, c.var.user.id, c.req.param('id'), {
    title: body.title as string | undefined,
    content: body.content as string | undefined,
    oldStr: body.old_str as string | undefined,
    newStr: body.new_str as string | undefined,
  });
  return c.json(toView(meta, origin(c)));
});

routes.delete('/api/artifacts/:id', async (c) => {
  await deleteArtifact(c.env, c.var.user.id, c.req.param('id'));
  return c.body(null, 204);
});

routes.put('/api/artifacts/:id/retention', async (c) => {
  const { permanent } = await readBody(c);
  if (typeof permanent !== 'boolean') throw new ArtifactError(400, 'permanent must be a boolean');
  return c.json(toView(await setRetention(c.env, c.var.user.id, c.req.param('id'), permanent), origin(c)));
});

routes.post('/api/artifacts/:id/share', async (c) =>
  c.json(toView(await shareArtifact(c.env, c.var.user.id, c.req.param('id')), origin(c))),
);

routes.delete('/api/artifacts/:id/share', async (c) =>
  c.json(toView(await unshareArtifact(c.env, c.var.user.id, c.req.param('id')), origin(c))),
);

export default routes;
