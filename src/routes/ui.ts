import { Hono } from 'hono';
import { ArtifactError, canViewShare, getArtifact, getContent, getSharedArtifact, isPossiblyTruncatedTitle, listArtifacts } from '../artifacts';
import { listApiTokens, readSession, requireSession } from '../auth';
import { listGrants, oauthHelpers } from './oauth';
import { LIBRARY_TITLE_BATCH_SIZE, type AppEnv, type LibraryTitleBatch } from '../types';
import { pageHeaders } from '../ui/headers';
import { identify } from '../ui/identify';
import { renderPage } from '../ui/app/document';

function parseVersion(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new ArtifactError(400, 'v must be a positive integer');
  return Number(raw);
}

const routes = new Hono<AppEnv>();

routes.get('/', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) {
    return renderPage(c, 'landing', {}, { title: 'Welcome', shell: { me: null } });
  }
  const now = new Date();
  const items = await listArtifacts(c.env, me.id, now);
  const fullTitleIds = items.filter(({ title }) => isPossiblyTruncatedTitle(title)).map(({ id }) => id);
  return renderPage(c, 'library', { items, fullTitleIds, now: now.toISOString() }, {
    title: 'Artifacts',
    shell: { me },
  });
});

routes.get('/library/titles', pageHeaders, requireSession, async (c) => {
  const rawIds = c.req.query('ids') ?? '';
  // Generated artifact IDs are unpadded base64url; reject an overlong query before splitting it.
  if (!rawIds || rawIds.length > LIBRARY_TITLE_BATCH_SIZE * 23 - 1) {
    throw new ArtifactError(400, 'Invalid artifact ID batch');
  }
  const ids = rawIds.split(',');
  if (ids.length > LIBRARY_TITLE_BATCH_SIZE || !ids.every((id) => /^[A-Za-z0-9_-]{22}$/.test(id))) {
    throw new ArtifactError(400, 'Invalid artifact ID batch');
  }
  const now = new Date();
  const records = await Promise.all([...new Set(ids)].map(async (id) => {
    try {
      const { title } = await getArtifact(c.env, c.var.user.id, id, now);
      return { id, title };
    } catch (error) {
      if (error instanceof ArtifactError && error.status === 404) return null;
      throw error;
    }
  }));
  const titles: LibraryTitleBatch = records.filter((record) => record !== null);
  return c.json(titles);
});

routes.get('/new', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  return renderPage(c, 'newArtifact', {}, {
    title: 'New artifact',
    shell: { me, width: 'narrow' },
  });
});

routes.get('/a/:id', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const meta = await getArtifact(c.env, me.id, c.req.param('id'));
  const version = parseVersion(c.req.query('v')) ?? meta.version;
  if (!meta.versions.some((info) => info.version === version)) throw new ArtifactError(404, 'Version not found');
  const origin = new URL(c.req.url).origin;
  return renderPage(c, 'viewer', {
    meta: {
      id: meta.id,
      title: meta.title,
      type: meta.type,
      language: meta.language,
      version: meta.version,
      versions: meta.versions.map((info) => ({ version: info.version, createdAt: info.createdAt })),
      expiresAt: meta.expiresAt,
      shareUrl: meta.shareId ? `${origin}/s/${meta.shareId}` : null,
      shareAudience: meta.shareAudience,
    },
    version,
    now: new Date().toISOString(),
  }, {
    title: meta.title,
    shell: { me, width: 'fill' },
  });
});

routes.get('/a/:id/edit', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const meta = await getArtifact(c.env, me.id, c.req.param('id'));
  const content = await getContent(c.env, meta);
  return renderPage(c, 'editArtifact', { id: meta.id, title: meta.title, content }, {
    title: `Edit ${meta.title}`,
    shell: { me, width: 'narrow' },
  });
});

routes.get('/s/:shareId', pageHeaders, async (c) => {
  const shareId = c.req.param('shareId');
  const meta = await getSharedArtifact(c.env, shareId);
  const viewer = await readSession(c.env, c.req.header('Cookie'));
  const me = await identify(c);
  if (!canViewShare(meta, viewer)) {
    return renderPage(c, 'restricted', { shareId, viewerEmail: viewer?.email ?? null }, {
      title: 'Restricted link',
      status: 403,
      shell: { me, viewerEmail: viewer?.email ?? null, signIn: false, width: 'narrow' },
    });
  }
  return renderPage(c, 'shared', {
    shareId,
    title: meta.title,
    type: meta.type,
    language: meta.language,
    signedIn: me !== null,
  }, {
    title: meta.title,
    shell: { me, viewerEmail: me ? null : viewer?.email ?? null, width: 'fill' },
  });
});

routes.get('/settings', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const tokens = await listApiTokens(c.env, me.id);
  const oauth = oauthHelpers(c);
  const apps = await Promise.all(
    (await listGrants(oauth, me.id)).map(async (grant) => ({
      id: grant.id,
      name: (await oauth.lookupClient(grant.clientId))?.clientName ?? grant.clientId,
      createdAt: new Date(grant.createdAt * 1000).toISOString(),
    })),
  );
  return renderPage(c, 'settings', { tokens, apps, origin: new URL(c.req.url).origin }, {
    title: 'Settings',
    shell: { me },
  });
});

export default routes;
