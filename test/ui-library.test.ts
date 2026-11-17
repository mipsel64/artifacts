import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, setRetention, shareArtifact, updateArtifact } from '../src/artifacts';
import type { ArtifactSummary } from '../src/types';
import { createTestUser, request } from './helpers';

afterEach(() => reset());

const asUser = (cookie: string): RequestInit => ({ headers: { Cookie: cookie } });

async function signedInAlice() {
  const { user, cookie } = await createTestUser('alice@example.com', '1');
  return { user, init: asUser(cookie) };
}

interface PageData {
  page: string;
  props: {
    items?: ArtifactSummary[];
    now?: string;
    id?: string;
    title?: string;
    content?: string;
  };
  shell: { width?: string };
}

function pageData(body: string): PageData {
  const match = body.match(/<script type="application\/json" id="page-data">(.*)<\/script>/);
  if (!match) throw new Error('page-data is missing');
  return JSON.parse(match[1]) as PageData;
}

describe('Astryx artifact library', () => {
  it('lists only the signed-in user artifacts with escaped titles, count and flags', async () => {
    const { user, init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const first = await createArtifact(env, user.id, { title: '<img src=x onerror=alert(1)>', type: 'html', content: 'a' });
    const second = await createArtifact(env, user.id, { title: 'Permanent one', type: 'svg', content: 'b' });
    await updateArtifact(env, user.id, second.id, { content: 'b2' });
    await setRetention(env, user.id, second.id, true);
    await shareArtifact(env, user.id, second.id);
    await createArtifact(env, bob.user.id, { title: 'Bobs secret', type: 'code', content: 'c' });

    const res = await request('/', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Artifacts · Artifacts</title>');
    expect(body).toContain(`href="/a/${first.id}"`);
    expect(body).toContain(`href="/a/${second.id}"`);
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).not.toContain('<img src=x');
    expect(body).not.toContain('Bobs secret');
    expect(body).toContain('Expires in 30 days');
    expect(body).toContain('Permanent');
    expect(body).toContain('Shared');
    expect(body).toContain('v<!-- -->2');
    const data = pageData(body);
    expect(data.page).toBe('library');
    expect(data.props.items).toHaveLength(2);
    expect(Date.parse(data.props.now ?? '')).not.toBeNaN();
    const heading = body.slice(body.indexOf('Artifacts</h1>'), body.indexOf('Artifacts</h1>') + 500);
    expect(heading).toContain('>2<');
  });

  it('uses one row link and truncates a long indexed title in one line', async () => {
    const { user, init } = await signedInAlice();
    const title = 'z'.repeat(150);
    const indexedTitle = `${'z'.repeat(99)}…`;
    const artifact = await createArtifact(env, user.id, { title, type: 'html', content: 'a' });
    const body = await (await request('/', init)).text();
    expect(body.match(new RegExp(`href="/a/${artifact.id}"`, 'g'))).toHaveLength(1);
    expect(body).toContain(indexedTitle);
    expect(pageData(body).props.items?.[0].title).toBe(indexedTitle);
  });

  it('labels an artifact with under a day left as expiring within a day', async () => {
    const { user, init } = await signedInAlice();
    await createArtifact(env, user.id, { title: 'Soon', type: 'html', content: 'a' }, new Date(Date.now() - 29.5 * 24 * 3600 * 1000));
    const body = await (await request('/', init)).text();
    expect(body).toContain('Expires within a day');
    expect(body).not.toContain('Expires today');
  });

  it('shows an empty state linking to New and Settings', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/', init)).text();
    expect(body).toContain('No artifacts yet');
    expect(body).toContain('href="/new"');
    expect(body).toContain('New artifact');
    expect(body).toContain('href="/settings"');
    expect(body).toContain('Connect an agent');
    expect(pageData(body).props.items).toEqual([]);
  });
});

describe('Astryx new artifact page', () => {
  it('renders controlled form fields and the type selector for a signed-in user', async () => {
    const { init } = await signedInAlice();
    const res = await request('/new', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>New artifact · Artifacts</title>');
    expect(body).toContain('data-form="new"');
    expect(body).toContain('name="title"');
    expect(body).toContain('name="type"');
    expect(body).toContain('name="content"');
    expect(body).toContain('>Title<');
    expect(body).toContain('>Type<');
    expect(body).toContain('>Content<');
    expect(body).toContain('Create');
    expect(body).toContain('href="/"');
    expect(body).toContain('Cancel');
    expect(body).not.toContain('name="language"');
    const data = pageData(body);
    expect(data.page).toBe('newArtifact');
    expect(data.shell.width).toBe('narrow');
  });

  it('redirects to / when signed out', async () => {
    const res = await request('/new', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '', 'https://artifacts.test').pathname).toBe('/');
  });
});

describe('Astryx edit artifact page', () => {
  it('pre-fills the title and latest content', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc "q"', type: 'html', content: '<p>one</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>latest & greatest</p>' });
    const res = await request(`/a/${meta.id}/edit`, init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Edit Doc "q" · Artifacts</title>');
    expect(body).toContain('value="Doc &quot;q&quot;"');
    expect(body).toContain('&lt;p&gt;latest &amp; greatest&lt;/p&gt;</textarea>');
    expect(body).not.toContain('&lt;p&gt;one&lt;/p&gt;');
    expect(body).toContain(`data-form="edit" data-id="${meta.id}"`);
    expect(body).toContain(`href="/a/${meta.id}"`);
    expect(body).toContain('Save');
    expect(body).toContain('Cancel');
    const data = pageData(body);
    expect(data.page).toBe('editArtifact');
    expect(data.props).toMatchObject({ id: meta.id, title: 'Doc "q"', content: '<p>latest & greatest</p>' });
    expect(data.shell.width).toBe('narrow');
  });

  it("404s for another user's artifact", async () => {
    const { init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const bobs = await createArtifact(env, bob.user.id, { title: 'Bobs', type: 'html', content: 'x' });
    expect((await request(`/a/${bobs.id}/edit`, init)).status).toBe(404);
  });

  it('redirects to / when signed out', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const res = await request(`/a/${meta.id}/edit`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '', 'https://artifacts.test').pathname).toBe('/');
  });
});
