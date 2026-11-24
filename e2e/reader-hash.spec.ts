import { expect } from '@playwright/test';
import type { ArtifactView } from '../src/types';
import { test } from './fixtures';
import { origin } from './settings';

test('artifact sections own fragment navigation even when an ID also exists in the reader', async ({ page }) => {
  const response = await page.request.post('/api/artifacts', {
    headers: { Origin: origin },
    data: {
      type: 'html',
      title: 'Reader fragment collision',
      content: '<h1>Overview</h1><h2 id="panel-details">Document details</h2>',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const artifact: ArtifactView = await response.json();
  await page.goto(artifact.url);

  const detailsTab = page.getByRole('tab', { name: 'Details' });
  await detailsTab.click();
  await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Preview' }).click();

  const section = page.frameLocator('[data-artifact-preview]').getByRole('heading', { name: 'Document details' });
  await expect(section).toBeVisible();
  await page.goto(`${artifact.url}#panel-details`);
  await expect.poll(() => section.evaluate(element => element.ownerDocument.location?.hash)).toBe('#panel-details');

  await page.getByRole('link', { name: 'Skip to content' }).press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(`${artifact.url}#panel-details`);
  await expect.poll(() => section.evaluate(element => element.ownerDocument.location?.hash)).toBe('#panel-details');
});
