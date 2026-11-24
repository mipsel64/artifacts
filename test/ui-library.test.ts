import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifact, setRetention, shareArtifact, updateArtifact } from '../src/artifacts';
import { LIBRARY_TITLE_BATCH_SIZE, type ArtifactSummary, type LibraryTitleBatch } from '../src/types';
import { filterLibrary } from '../src/ui/app/pages/library-filter';
import { loadLibraryTitles } from '../src/ui/app/pages/library-titles';
import { bearer, createTestUser, request } from './helpers';

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
    fullTitleIds?: string[];
    version?: number;
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
    const first = await createArtifact(env, user.id, { title: '<img src=x onerror=alert(1)>', type: 'html', content: 'rendered only in the preview' }, new Date(Date.now() - 60_000));
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
    expect(data.props.items?.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(Date.parse(data.props.now ?? '')).not.toBeNaN();
    expect(body).toContain('Artifact library</h1>');
    expect(body).toContain('Search by title or type');
    expect(body).toContain('type="search"');
    expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('Expiring soon');
    expect(body).toContain('Newest first');
    expect(body).toContain('role="status"');
    expect(body).not.toContain('rendered only in the preview');
    // The direct-reader fallback is usable before hydration; it doesn't fetch any render documents.
    expect(body).not.toContain('<iframe');
    expect(body).not.toContain(`/r/${second.id}`);
  });

  it('uses one row link and truncates a long indexed title in one line', async () => {
    const { user, init } = await signedInAlice();
    const title = `${'z'.repeat(120)} hidden suffix`;
    const indexedTitle = `${'z'.repeat(99)}…`;
    const artifact = await createArtifact(env, user.id, { title, type: 'html', content: 'a' });
    const body = await (await request('/', init)).text();
    expect(body.match(new RegExp(`href="/a/${artifact.id}"`, 'g'))).toHaveLength(1);
    expect(body).toContain(indexedTitle);
    const data = pageData(body);
    expect(data.props.items?.[0].title).toBe(indexedTitle);
    expect(data.props.fullTitleIds).toEqual([artifact.id]);
    expect(body).not.toContain('hidden suffix');

    const response = await request(`/library/titles?ids=${artifact.id}`, init);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const titles = await response.json() as LibraryTitleBatch;
    expect(titles).toEqual([{ id: artifact.id, title }]);
    const items = data.props.items ?? [];
    const resolved = new Map(titles.map(({ id, title }) => [id, title]));
    expect(filterLibrary(items, 'hidden SUFFIX', 'all', Date.now(), resolved)).toEqual(items);
  });

  it('keeps preview and reader requests on the captured collection version after an update', async () => {
    const { user, init } = await signedInAlice();
    const { id } = await createArtifact(env, user.id, { title: 'Pinned preview', type: 'html', content: '<p>Original revision</p>' });
    const snapshot = pageData(await (await request('/', init)).text()).props.items?.[0];
    expect(snapshot?.version).toBe(1);
    await updateArtifact(env, user.id, id, { content: '<p>Replacement revision</p>' });

    const render = await request(`/r/${id}?v=${snapshot?.version}`, init);
    expect(render.status).toBe(200);
    const content = await render.text();
    expect(content).toContain('Original revision');
    expect(content).not.toContain('Replacement revision');
    const reader = await request(`/a/${id}?v=${snapshot?.version}`, init);
    expect(reader.status).toBe(200);
    expect(pageData(await reader.text()).props.version).toBe(1);
  });

  it('resolves unique owned, live artifacts only and rejects malformed or oversized batches', async () => {
    const { user, cookie, token } = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const own = await createArtifact(env, user.id, { title: 'My title', type: 'html', content: 'a' });
    const foreign = await createArtifact(env, bob.user.id, { title: 'Secret title', type: 'html', content: 'b' });
    const expired = await createArtifact(env, user.id, { title: 'Expired title', type: 'html', content: 'c' }, new Date(Date.now() - 31 * 24 * 3600 * 1000));
    const missing = '0'.repeat(22);
    const path = `/library/titles?ids=${[own.id, foreign.id, expired.id, missing, own.id].join(',')}`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { headers: bearer(token) })).status).toBe(403);
    const init = asUser(cookie);
    expect(await (await request(path, init)).json()).toEqual([{ id: own.id, title: own.title }]);
    expect((await request('/library/titles?ids=invalid', init)).status).toBe(400);
    const oversized = Array.from({ length: LIBRARY_TITLE_BATCH_SIZE + 1 }, () => own.id).join(',');
    expect((await request(`/library/titles?ids=${oversized}`, init)).status).toBe(400);
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

describe('Library filtering', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const artifact = (id: string, override: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
    id,
    title: id,
    type: 'markdown',
    version: 1,
    updatedAt: new Date(now).toISOString(),
    expiresAt: null,
    shared: false,
    ...override,
  });
  const items = [
    artifact('Quarterly Report'),
    artifact('Dashboard', { type: 'react', shared: true, expiresAt: new Date(now + windowMs).toISOString() }),
    artifact('Release notes', { shared: true, expiresAt: new Date(now + windowMs + 1).toISOString() }),
    artifact('Spare notes', { expiresAt: new Date(now + 1).toISOString() }),
    artifact('Due now', { expiresAt: new Date(now).toISOString() }),
    artifact('Overdue', { expiresAt: new Date(now - 1).toISOString() }),
  ];

  it('matches case-insensitive titles and types, preserving the incoming order', () => {
    expect(filterLibrary(items, '  quarterly REPORT  ', 'all', now)).toEqual([items[0]]);
    expect(filterLibrary(items, 'ReAct', 'all', now)).toEqual([items[1]]);
    expect(filterLibrary(items, 'notes', 'all', now)).toEqual([items[2], items[3]]);
  });

  it('intersects search and sharing filters, and returns nothing on a miss', () => {
    expect(filterLibrary(items, '', 'shared', now)).toEqual([items[1], items[2]]);
    expect(filterLibrary(items, 'markdown', 'shared', now)).toEqual([items[2]]);
    expect(filterLibrary(items, 'Quarterly Report', 'shared', now)).toEqual([]);
    expect(filterLibrary(items, '', 'all', now)).toEqual(items);
  });

  it('includes future expiries through exactly seven days, not permanent or elapsed records', () => {
    expect(filterLibrary(items, '', 'expiring', now)).toEqual([items[1], items[3]]);
    expect(filterLibrary(items, 'markdown', 'expiring', now)).toEqual([items[3]]);
  });
});

it('starts at most two title batches and stops scheduling them when aborted', async () => {
  const ids = Array.from({ length: LIBRARY_TITLE_BATCH_SIZE * 3 + 1 }, (_, i) => String(i));
  const controller = new AbortController();
  const requests: Array<{ ids: string[]; finish: (response: Response) => void }> = [];
  const committed: Array<readonly [string, string | null]> = [];
  vi.stubGlobal('fetch', (url: string, { signal }: { signal: AbortSignal }) => {
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    const batch = new URL(url, 'http://example.test').searchParams.get('ids')!.split(',');
    requests.push({ ids: batch, finish: resolve });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    return promise;
  });
  const loading = loadLibraryTitles(ids, controller.signal, (batch) => { committed.push(...batch); });
  try {
    const settled = loading.catch((error: unknown) => error);
    expect(requests.map((request) => request.ids)).toEqual([
      ids.slice(0, LIBRARY_TITLE_BATCH_SIZE),
      ids.slice(LIBRARY_TITLE_BATCH_SIZE, LIBRARY_TITLE_BATCH_SIZE * 2),
    ]);
    requests[0].finish(Response.json([{ id: ids[0], title: 'First full title' }]));
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(committed).toHaveLength(LIBRARY_TITLE_BATCH_SIZE);
    expect(committed.slice(0, 2)).toEqual([[ids[0], 'First full title'], [ids[1], null]]);
    const rejected = expect(settled).resolves.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(requests).toHaveLength(3);
    expect(committed).toHaveLength(LIBRARY_TITLE_BATCH_SIZE);
  } finally {
    controller.abort();
    vi.unstubAllGlobals();
  }
});

it.each([401, 403])('stops scheduling title batches after HTTP %i without losing valid results', async (status) => {
  const ids = Array.from({ length: LIBRARY_TITLE_BATCH_SIZE * 4 }, (_, i) => String(i));
  const committed = new Map<string, string | null>();
  const denied = Promise.withResolvers<Response>();
  const inFlight = Promise.withResolvers<Response>();
  const fetchBatch = vi.fn()
    .mockResolvedValueOnce(Response.json([{ id: ids[0], title: 'Completed title' }]))
    .mockReturnValueOnce(denied.promise)
    .mockReturnValueOnce(inFlight.promise)
    .mockResolvedValue(Response.json([]));
  vi.stubGlobal('fetch', fetchBatch);
  try {
    const loading = loadLibraryTitles(ids, new AbortController().signal, (batch) => {
      for (const [id, title] of batch) committed.set(id, title);
    });
    const rejected = expect(loading).rejects.toThrow('Could not load full artifact titles');
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(3));
    denied.resolve(new Response(null, { status }));
    inFlight.resolve(Response.json([{ id: ids[2 * LIBRARY_TITLE_BATCH_SIZE], title: 'In-flight title' }]));
    await rejected;
    expect(fetchBatch).toHaveBeenCalledTimes(3);
    expect(committed.get(ids[0])).toBe('Completed title');
    expect(committed.get(ids[2 * LIBRARY_TITLE_BATCH_SIZE])).toBe('In-flight title');
    expect(committed.has(ids[LIBRARY_TITLE_BATCH_SIZE])).toBe(false);
    expect(committed.has(ids[3 * LIBRARY_TITLE_BATCH_SIZE])).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
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
