import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, shareArtifact, unshareArtifact, updateArtifact } from '../src/artifacts';
import type { ArtifactType } from '../src/types';
import { createTestUser, ORIGIN, request } from './helpers';

afterEach(() => reset());

const asUser = (cookie: string): RequestInit => ({ headers: { Cookie: cookie } });

async function signedInAlice() {
  const { user, cookie } = await createTestUser('alice@example.com', '1');
  return { user, cookie, init: asUser(cookie) };
}

interface PageData {
  page: string;
  props: unknown;
}

interface ViewerProps {
  version: number;
  now: string;
  meta: {
    id: string;
    title: string;
    type: ArtifactType;
    language: string | null;
    version: number;
    versions: { version: number; createdAt: string }[];
    expiresAt: string | null;
    shareUrl: string | null;
    shareAudience: string[] | null;
  };
}

interface SharedProps {
  shareId: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  signedIn: boolean;
}

function pageData(body: string): PageData {
  const match = body.match(/<script type="application\/json" id="page-data">([^<]+)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '') as PageData;
}

function viewerProps(body: string): ViewerProps {
  const data = pageData(body);
  expect(data.page).toBe('viewer');
  return data.props as ViewerProps;
}

function sharedProps(body: string): SharedProps {
  const data = pageData(body);
  expect(data.page).toBe('shared');
  return data.props as SharedProps;
}

function expectPreview(body: string, src: string) {
  const iframe = body.match(/<iframe\b[^>]*>/)?.[0];
  expect(iframe).toBeDefined();
  expect(iframe).toContain(`src="${src}"`);
  expect(iframe).toContain('data-artifact-preview');
  expect(iframe).toContain('sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"');
  expect(iframe).toContain('allow="fullscreen"');
  expect(iframe).toContain('title="Artifact preview"');
}

describe('Astryx viewer', () => {
  it('renders the selected version, readable view tabs and version metadata without content', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc <b>', type: 'html', content: '<p>one</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>two</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>three</p>' });

    const res = await request(`/a/${meta.id}?v=2`, init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Doc &lt;b&gt; · Artifacts</title>');
    expectPreview(body, `/r/${meta.id}?v=2`);
    expect(body).toContain('aria-label="Artifact view"');
    expect(body).toContain('aria-controls="panel-preview"');
    expect(body).toContain('aria-controls="panel-code"');
    expect(body).toContain('aria-controls="panel-details"');
    expect(body).toContain('aria-label="Preview"');
    expect(body).toContain('aria-label="Source"');
    expect(body).toContain('id="panel-code"');
    expect(body).toContain('aria-label="Details"');
    expect(body).toContain('Artifact details');
    expect(body).toContain('v2 of 3');
    expect(body).toContain('Not shared');
    expect(body).toContain('aria-label="v2 of 3, switch version"');
    expect(body).toContain('Doc &lt;b&gt;');
    expect(body).not.toContain('&lt;p&gt;one&lt;/p&gt;');
    expect(body).not.toContain('&lt;p&gt;two&lt;/p&gt;');
    expect(body).not.toContain('&lt;p&gt;three&lt;/p&gt;');

    const props = viewerProps(body);
    expect(props.version).toBe(2);
    expect(props.meta.id).toBe(meta.id);
    expect(props.meta.version).toBe(3);
    expect(props.meta.versions.map((version) => version.version)).toEqual([1, 2, 3]);
    expect(props.meta.versions.every((version) => typeof version.createdAt === 'string')).toBe(true);
    expect(props.meta.shareUrl).toBeNull();
    expect(props.meta.shareAudience).toBeNull();
    expect(props).not.toHaveProperty('content');
    expect(props.meta).not.toHaveProperty('content');
    expect(new Date(props.now).toISOString()).toBe(props.now);
  });

  it('shows plain v1 for one version and defaults to the latest preview', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'first' });
    const single = await (await request(`/a/${meta.id}`, init)).text();
    expect(single).toContain('v1');
    expect(single).not.toContain('switch version');

    await updateArtifact(env, user.id, meta.id, { content: 'latest-content-marker' });
    const latest = await (await request(`/a/${meta.id}`, init)).text();
    expectPreview(latest, `/r/${meta.id}?v=2`);
    expect(latest).toContain('aria-label="v2 of 2, switch version"');
    expect(latest).not.toContain('>first<');
    expect(latest).not.toContain('latest-content-marker');
  });

  it('loads a selected old preview without embedding old or current content', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'code', content: 'first-version', language: 'python' });
    await updateArtifact(env, user.id, meta.id, { content: 'second-version' });
    const body = await (await request(`/a/${meta.id}?v=1`, init)).text();
    expectPreview(body, `/r/${meta.id}?v=1`);
    expect(body).not.toContain('first-version');
    expect(body).not.toContain('second-version');
    expect(viewerProps(body).meta.language).toBe('python');
  });

  it('describes sharing as latest-version access when reading a historical version', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Versioned share', type: 'html', content: '<p>Original</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>Updated</p>' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);

    const old = await (await request(`/a/${meta.id}?v=1`, init)).text();
    expectPreview(old, `/r/${meta.id}?v=1`);
    expect(old).toContain('<dt>Latest version share link</dt>');
    expect(old).toContain('Latest version share link: Anyone with the link');
    expect(viewerProps(old).meta.shareUrl).toBe(`${ORIGIN}/s/${shareId}`);
    expect(await (await request(`/s/${shareId}/raw`)).text()).toBe('<p>Updated</p>');
  });

  it('keeps public and restricted share state in page props', async () => {
    const { user, cookie, init } = await signedInAlice();
    const publicArtifact = await createArtifact(env, user.id, { title: 'Public', type: 'html', content: 'public-content' });
    const shared = await shareArtifact(env, user.id, publicArtifact.id);
    const publicBody = await (await request(`/a/${publicArtifact.id}`, init)).text();
    expect(viewerProps(publicBody).meta.shareUrl).toBe(`${ORIGIN}/s/${shared.shareId}`);
    expect(viewerProps(publicBody).meta.shareAudience).toBeNull();
    expect(publicBody).toContain('Share, shared');
    expect(publicBody).not.toContain('public-content');

    const restrictedArtifact = await createArtifact(env, user.id, { title: 'Restricted', type: 'code', content: 'restricted-content' });
    const response = await request(`/api/artifacts/${restrictedArtifact.id}/share`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: ['Carol@Acme.dev', '@acme.dev'] }),
    });
    expect(response.status).toBe(200);
    const restrictedBody = await (await request(`/a/${restrictedArtifact.id}`, init)).text();
    expect(viewerProps(restrictedBody).meta.shareAudience).toEqual(['carol@acme.dev', '@acme.dev']);
    expect(restrictedBody).not.toContain('restricted-content');
  });

  it('preserves the effective restricted link after an invalid audience update', async () => {
    const { user, cookie, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Restricted', type: 'markdown', content: '# Private' });
    const { shareId } = await shareArtifact(env, user.id, meta.id, { audience: ['reader@example.com'] });
    const response = await request(`/api/artifacts/${meta.id}/share`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: ['not-an-email'] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('audience entries must be emails') });
    const body = await (await request(`/a/${meta.id}`, init)).text();
    expect(viewerProps(body).meta).toMatchObject({
      shareUrl: `${ORIGIN}/s/${shareId}`,
      shareAudience: ['reader@example.com'],
    });
    expect(body).toContain('Specific people');
    expect(body).toContain('reader@example.com');
    expect((await request(`/s/${shareId}`)).status).toBe(403);
  });

  it('redirects signed-out users and preserves version and ownership errors', async () => {
    const { user, init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const bobs = await createArtifact(env, bob.user.id, { title: 'Bobs', type: 'html', content: 'x' });
    const mine = await createArtifact(env, user.id, { title: 'Mine', type: 'html', content: 'x' });

    const signedOut = await request(`/a/${mine.id}`, { redirect: 'manual' });
    expect(signedOut.status).toBe(302);
    expect(new URL(signedOut.headers.get('location') ?? '', ORIGIN).pathname).toBe('/');
    expect((await request(`/a/${bobs.id}`, init)).status).toBe(404);
    for (const version of ['0', '-1', 'abc', '1.5', '']) {
      expect((await request(`/a/${mine.id}?v=${version}`, init)).status).toBe(400);
    }
    expect((await request(`/a/${mine.id}?v=9`, init)).status).toBe(404);
  });
});

describe('Astryx shared viewer', () => {
  it('works signed out with read-only actions and without Remix or content', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Shared <b>', type: 'html', content: '<h1>private markup</h1>' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    const res = await request(`/s/${shareId}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Shared &lt;b&gt; · Artifacts</title>');
    expectPreview(body, `/s/${shareId}/render`);
    expect(body).toContain('Shared &lt;b&gt;');
    expect(body).toContain('Read-only');
    expect(body).toContain(`href="/s/${shareId}/raw?download=1"`);
    expect(body).toContain('Copy');
    expect(body).toContain('aria-label="Source"');
    expect(body).toContain('aria-label="Details"');
    expect(body).not.toContain('Share artifact');
    expect(body).toContain('href="/auth/login"');
    expect(body).not.toContain('Remix');
    expect(body).not.toContain(meta.id);
    expect(body).not.toContain('private markup');

    const props = sharedProps(body);
    expect(props).toEqual({ shareId, title: 'Shared <b>', type: 'html', language: null, signedIn: false });
    expect(props).not.toHaveProperty('content');
  });

  it('offers Remix with the shared attributes when signed in', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Snippet', type: 'code', content: 'print(1)', language: 'python' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    const body = await (await request(`/s/${shareId}`, init)).text();
    expect(body).toContain('Remix');
    expect(body).not.toContain('print(1)');
    expect(sharedProps(body)).toEqual({ shareId, title: 'Snippet', type: 'code', language: 'python', signedIn: true });
  });

  it('returns 404 for revoked and unknown shares', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    await unshareArtifact(env, user.id, meta.id);
    expect((await request(`/s/${shareId}`)).status).toBe(404);
    expect((await request('/s/unknown')).status).toBe(404);
  });
});
