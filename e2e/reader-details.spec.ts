import { expect } from '@playwright/test';
import type { ArtifactView } from '../src/types';
import { test } from './fixtures';
import { origin } from './settings';

test.use({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });

test('a touch reader can see the full title of a shared artifact in Details', async ({ context, page }) => {
  const title = 'Shared report: ' + 'LongUnbrokenArtifactTitle'.repeat(7);
  const created = await page.request.post('/api/artifacts', {
    headers: { Origin: origin },
    data: { type: 'html', title, content: '<p>Shared report</p>' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const artifact: ArtifactView = await created.json();
  const published = await page.request.post(`/api/artifacts/${artifact.id}/share`, {
    headers: { Origin: origin },
    data: { audience: null },
  });
  await expect(published).toBeOK();
  const shared: ArtifactView = await published.json();
  expect(shared.shareUrl).toBeTruthy();

  await context.clearCookies();
  await page.goto(shared.shareUrl!);
  await page.getByRole('tab', { name: 'Details' }).tap();
  const details = page.getByRole('tabpanel', { name: 'Details' });
  const fullTitle = details.getByText(title, { exact: true });
  await expect(fullTitle).toBeVisible();
  await expect(fullTitle).toHaveCSS('overflow-wrap', 'anywhere');
  expect(await details.evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true);
});
