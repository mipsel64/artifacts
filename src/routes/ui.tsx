import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ArtifactError, getArtifact, getContent, getSharedArtifact, listArtifacts, toView } from '../artifacts';
import { authenticate, getUser, listApiTokens } from '../auth';
import type { AppEnv } from '../types';
import { Layout, type Identity } from '../ui/layout';
import { ArtifactList, EditArtifact, Landing, NewArtifact, Settings, SharedViewer, Viewer } from '../ui/pages';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://lh3.googleusercontent.com data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const pageHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header('Content-Security-Policy', CSP);
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, no-store');
  await next();
};

async function identify(c: Context<AppEnv>): Promise<(Identity & { id: string }) | null> {
  const auth = await authenticate(c);
  if (!auth) return null;
  const profile = await getUser(c.env, auth.user.id);
  return { id: auth.user.id, email: auth.user.email, avatarUrl: profile?.avatarUrl ?? null };
}

function parseVersion(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new ArtifactError(400, 'v must be a positive integer');
  return Number(raw);
}

const routes = new Hono<AppEnv>();

routes.get('/', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) {
    return c.html(
      <Layout title="Welcome" me={null}>
        <Landing />
      </Layout>,
    );
  }
  const items = await listArtifacts(c.env, me.id);
  return c.html(
    <Layout title="Artifacts" me={me}>
      <ArtifactList items={items} now={new Date()} />
    </Layout>,
  );
});

routes.get('/new', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  return c.html(
    <Layout title="New artifact" me={me}>
      <NewArtifact />
    </Layout>,
  );
});

routes.get('/a/:id', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const meta = await getArtifact(c.env, me.id, c.req.param('id'));
  const version = parseVersion(c.req.query('v')) ?? meta.version;
  const content = await getContent(c.env, meta, version);
  return c.html(
    <Layout title={meta.title} me={me} fill>
      <Viewer meta={toView(meta, new URL(c.req.url).origin)} version={version} content={content} now={new Date()} />
    </Layout>,
  );
});

routes.get('/a/:id/edit', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const meta = await getArtifact(c.env, me.id, c.req.param('id'));
  const content = await getContent(c.env, meta);
  return c.html(
    <Layout title={`Edit ${meta.title}`} me={me}>
      <EditArtifact meta={toView(meta, new URL(c.req.url).origin)} content={content} />
    </Layout>,
  );
});

routes.get('/s/:shareId', pageHeaders, async (c) => {
  const shareId = c.req.param('shareId');
  const meta = await getSharedArtifact(c.env, shareId);
  const content = await getContent(c.env, meta);
  const me = await identify(c);
  return c.html(
    <Layout title={meta.title} me={me} fill>
      <SharedViewer shareId={shareId} meta={toView(meta, new URL(c.req.url).origin)} content={content} signedIn={me !== null} />
    </Layout>,
  );
});

routes.get('/settings', pageHeaders, async (c) => {
  const me = await identify(c);
  if (!me) return c.redirect('/');
  const tokens = await listApiTokens(c.env, me.id);
  return c.html(
    <Layout title="Settings" me={me}>
      <Settings tokens={tokens} origin={new URL(c.req.url).origin} />
    </Layout>,
  );
});

export default routes;
