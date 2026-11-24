import { expect, type APIRequestContext } from '@playwright/test';
import { LIBRARY_TITLE_BATCH_SIZE, type ArtifactView, type LibraryTitleBatch } from '../src/types';
import { test } from './fixtures';
import { origin } from './settings';

async function createArtifact(request: APIRequestContext, title: string, content = '<p>Library fixture</p>'): Promise<ArtifactView> {
  const response = await request.post('/api/artifacts', {
    headers: { Origin: origin },
    data: { title, content, type: 'html' },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test.describe('landscape phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('searches in place without mounting or requesting a preview', async ({ page }) => {
    const artifact = await createArtifact(page.request, 'Landscape phone artifact');
    const renderRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/r/')) renderRequests.push(request.url());
    });
    await page.clock.install();
    await page.goto('/');

    const search = page.getByRole('searchbox', { name: 'Search by title or type' });
    await search.fill('No fixture by this title');
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await search.fill('landscape phone artifact');
    const row = page.getByRole('link', { name: /Landscape phone artifact/ });
    await expect(row).toHaveAttribute('href', `/a/${artifact.id}`);
    await expect(page.getByRole('listitem').filter({ has: row })).toContainText(/Expires in \d+ days/);
    await page.clock.runFor(500);
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(renderRequests).toEqual([]);

    await row.click();
    await expect(page).toHaveURL(artifact.url);
  });
});

test('opens the selected row with the keyboard and preserves the quick-look version across an external update', async ({ page }) => {
  const title = 'Library pinned revision';
  const artifact = await createArtifact(page.request, title, '<h1>Captured revision</h1>');
  const others = await Promise.all(Array.from({ length: 12 }, (_, i) => createArtifact(page.request, `Library row ${i + 1}`)));
  const renderRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/r/')) renderRequests.push(url.pathname + url.search);
  });
  await page.clock.install();
  await page.goto('/');

  const row = page.getByRole('button', { name: `Select ${title}`, exact: true });
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await page.clock.runFor(500);
  expect(renderRequests).toEqual([]);
  const update = await page.request.patch(`/api/artifacts/${artifact.id}`, {
    headers: { Origin: origin },
    data: { content: '<h1>Latest revision</h1>' },
  });
  expect(update.status(), await update.text()).toBe(200);
  expect(await update.json()).toMatchObject({ version: 2 });

  await row.scrollIntoViewIfNeeded();
  await row.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const quickLook = page.getByRole('complementary', { name: 'Quick look' });
  const preview = quickLook.getByRole('button', { name: 'Preview', exact: true });
  await expect(preview).toBeInViewport();
  await expect.poll(async () => {
    const header = await page.locator('.workspace-bar').boundingBox();
    const panel = await quickLook.boundingBox();
    return !!header && !!panel && panel.y >= header.y + header.height;
  }).toBe(true);
  await expect(quickLook.locator('iframe')).toHaveCount(0);
  expect(renderRequests).toEqual([]);
  await expect(quickLook.getByText('v1', { exact: true })).toBeVisible();
  await expect(quickLook.getByRole('link', { name: 'Open artifact' })).toHaveAttribute('href', `/a/${artifact.id}?v=1`);
  await preview.press('Enter');
  await expect(quickLook.locator('iframe')).toHaveAttribute('src', `/r/${artifact.id}?v=1`);
  await expect(quickLook.frameLocator('iframe').locator('h1')).toHaveText('Captured revision');

  expect(renderRequests).toEqual([`/r/${artifact.id}?v=1`]);
  const search = page.getByRole('searchbox', { name: 'Search by title or type' });
  await search.fill(others[0].title);
  await expect(quickLook.getByRole('heading', { name: others[0].title })).toBeVisible();
  await expect(quickLook.locator('iframe')).toHaveCount(0);
  await search.fill(title);
  await expect(quickLook.getByRole('heading', { name: title })).toBeVisible();
  await expect(quickLook.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(quickLook.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(quickLook.getByRole('heading', { name: title })).toBeVisible();
  await page.clock.runFor(500);
  await expect(quickLook.locator('iframe')).toHaveCount(0);
  expect(renderRequests).toEqual([`/r/${artifact.id}?v=1`]);
  await row.press('Enter');
  await expect(row).toBeFocused();
  await page.keyboard.press('Tab');
  const open = page.getByRole('link', { name: `Open ${title}`, exact: true });
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${artifact.url}?v=1`);
  await expect(page.frameLocator('[data-artifact-preview]').locator('h1')).toHaveText('Captured revision');
});

test('finds an indexed long title by its suffix without resolving full titles on initial load', async ({ page }) => {
  const prefix = 'n'.repeat(120);
  const title = `${prefix} distinctive suffix`;
  const artifact = await createArtifact(page.request, title);
  const titleRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/library/titles') titleRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: `Select ${prefix.slice(0, 99)}…`, exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Quick look' }).locator('iframe')).toHaveCount(0);
  expect(titleRequests).toEqual([]);

  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/library/titles' && (url.searchParams.get('ids') ?? '').split(',').includes(artifact.id);
  });
  await page.getByRole('searchbox', { name: 'Search by title or type' }).fill('DISTINCTIVE SUFFIX');
  expect((await resolved).ok()).toBe(true);
  await expect(page.getByRole('button', { name: `Select ${title}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: `Open ${title}`, exact: true })).toHaveAttribute('href', `/a/${artifact.id}?v=1`);
});

test('keeps resolved results through a failure and resumes unresolved batches after clearing search', async ({ page }) => {
  const created = await Promise.all(Array.from({ length: LIBRARY_TITLE_BATCH_SIZE + 1 }, (_, i) =>
    createArtifact(page.request, `Library recovery ${i + 1} ${'x'.repeat(105)} recovery suffix`),
  ));
  const byId = new Map(created.map((item) => [item.id, item]));
  const batches: string[][] = [];
  const stalled = Promise.withResolvers<void>();
  let omittedId = '';
  await page.route(/\/library\/titles\?ids=/, async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')!.split(',');
    batches.push(ids);
    if (batches.length === 1) omittedId = ids.find((id) => byId.has(id))!;
    if (batches.length === 2) {
      await route.fulfill({ status: 503, json: { error: 'Temporary title lookup failure' } });
      return;
    }
    if (batches.length === 3) {
      await stalled.promise;
      // Don't publish a response after the search that requested it was cleared.
      await route.abort().catch(() => {});
      return;
    }
    const response = await route.fetch();
    const titles: LibraryTitleBatch = await response.json();
    await route.fulfill({ json: titles.filter(({ id }) => id !== omittedId) });
  });
  await page.goto('/');

  const search = page.getByRole('searchbox', { name: 'Search by title or type' });
  const count = page.getByRole('status').filter({ hasText: /\d+ of \d+ artifacts/ });
  const initialTotal = Number((await count.textContent())?.match(/of (\d+)/)?.[1]);
  expect(initialTotal).toBeGreaterThanOrEqual(created.length);
  await search.fill('recovery suffix');
  await expect(page.getByRole('alert')).toContainText('Some full titles could not be searched.');
  expect(batches).toHaveLength(2);
  expect(batches[0]).toHaveLength(LIBRARY_TITLE_BATCH_SIZE);
  const available = batches[0].flatMap((id) => {
    const item = byId.get(id);
    return item && id !== omittedId ? [item] : [];
  });
  await expect(count).toHaveText(`${available.length} of ${initialTotal - 1} artifacts`);
  const retained = available[available.length - 1];
  const retainedRow = page.getByRole('button', { name: `Select ${retained.title}`, exact: true });
  await retainedRow.click();
  await expect(retainedRow).toHaveAttribute('aria-pressed', 'true');

  try {
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => batches.length).toBe(3);
    expect(batches[2]).toEqual(batches[1]);
    await expect(count).toHaveText(`Searching full titles… ${available.length} of ${initialTotal - 1} artifacts`);
    await search.fill('');
    await expect(count).toHaveText(`${initialTotal - 1} of ${initialTotal - 1} artifacts`);
    await expect(retainedRow).toHaveAttribute('aria-pressed', 'true');
    await search.fill('recovery suffix');
    await expect(count).toHaveText(`${created.length - 1} of ${initialTotal - 1} artifacts`);
    expect(batches).toHaveLength(4);
    expect(batches[3]).toEqual(batches[1]);
  } finally {
    stalled.resolve();
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(retainedRow).toHaveAttribute('aria-pressed', 'true');

  await search.fill('');
  await expect(count).toHaveText(`${initialTotal - 1} of ${initialTotal - 1} artifacts`);
  const omitted = byId.get(omittedId)!;
  await expect(page.getByRole('button', { name: `Select ${omitted.title.slice(0, 99)}…`, exact: true })).toHaveCount(0);
});

test('refreshes the expiry window from elapsed time, independent of the device clock', async ({ page }) => {
  const title = 'Library retention clock';
  await createArtifact(page.request, title);
  const day = 24 * 60 * 60 * 1000;
  await page.clock.install();
  await page.goto('/');

  const row = page.getByRole('button', { name: `Select ${title}`, exact: true });
  const expiring = page.getByRole('button', { name: 'Expiring soon', exact: true });
  await expect(row).toBeVisible();
  await expiring.click();
  await expect(row).toHaveCount(0);
  const all = page.getByRole('button', { name: 'All', exact: true });
  await page.clock.setSystemTime(Date.now() + 45 * day);
  await all.click();
  await expect(row).toBeVisible();
  await expiring.click();
  await expect(row).toHaveCount(0);

  await page.clock.fastForward(24.5 * day);
  await expiring.click();
  await expect(row).toBeVisible();
  await expect(page.getByRole('listitem').filter({ has: row })).toContainText('Expires in 6 days');

  await page.clock.fastForward(6 * day);
  await expiring.click();
  await expect(row).toHaveCount(0);
  await all.click();
  await expect(row).toHaveCount(0);
});

test('counts time spent waiting for hydration when checking retention', async ({ page }) => {
  const title = 'Expires before hydration';
  await createArtifact(page.request, title);
  await page.clock.install();
  const client = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  await page.route('**/static/build/client.js', async route => {
    requested.resolve();
    await client.promise;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  try {
    await requested.promise;
    await page.clock.fastForward(31 * 24 * 60 * 60 * 1000);
  } finally {
    client.resolve();
  }
  const row = page.getByRole('button', { name: `Select ${title}`, exact: true });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(row).toHaveCount(0);
});
