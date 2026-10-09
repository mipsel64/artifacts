import { Hono } from 'hono';
import { ArtifactError, getArtifact, getContent, getSharedArtifact, listArtifacts, toView } from '../artifacts';
import { listApiTokens } from '../auth';
import { listGrants, oauthHelpers } from './oauth';
import type { AppEnv } from '../types';
import { pageHeaders } from '../ui/headers';
import { identify } from '../ui/identify';
import { Layout } from '../ui/layout';
import { ArtifactList, EditArtifact, Landing, NewArtifact, Settings, SharedViewer, Viewer } from '../ui/pages';

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
    <Layout title="New artifact" me={me} width="narrow">
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
    <Layout title={`Edit ${meta.title}`} me={me} width="narrow">
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
  const oauth = oauthHelpers(c);
  const apps = await Promise.all(
    (await listGrants(oauth, me.id)).map(async (grant) => ({
      id: grant.id,
      name: (await oauth.lookupClient(grant.clientId))?.clientName ?? grant.clientId,
      createdAt: new Date(grant.createdAt * 1000).toISOString(),
    })),
  );
  return c.html(
    <Layout title="Settings" me={me} settingsActive width="medium">
      <Settings tokens={tokens} apps={apps} origin={new URL(c.req.url).origin} />
    </Layout>,
  );
});

export default routes;
