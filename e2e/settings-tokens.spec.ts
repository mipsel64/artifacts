import { randomUUID } from 'node:crypto';
import { expect, type Request, type Response } from '@playwright/test';
import { test } from './fixtures';

test('shows a new token once when creation completes in another settings section', async ({ page }) => {
  const release = Promise.withResolvers<void>();
  await page.route('**/api/tokens', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    await release.promise;
    await route.fulfill({ response });
  });

  await page.goto('/settings#tokens');
  const settingsNav = page.getByRole('navigation', { name: 'Settings sections' });
  const appearance = settingsNav.getByRole('link', { name: 'Appearance' });
  const tokens = settingsNav.getByRole('link', { name: 'API tokens' });
  const tokenName = `Delayed token ${randomUUID()}`;
  const nameField = page.getByRole('textbox', { name: 'Token name' });
  const secretField = page.getByRole('textbox', { name: 'New token' });
  const isTokenCreation = (request: Request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/tokens';

  await nameField.fill(tokenName);
  const submitted = page.waitForRequest(isTokenCreation);
  let created: Promise<Response>;
  try {
    await page.getByRole('button', { name: 'Create token' }).click();
    await submitted;
    await appearance.click();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    created = page.waitForResponse((response) => isTokenCreation(response.request()));
  } finally {
    release.resolve();
  }

  expect((await created).status()).toBe(201);
  await expect(page.getByText(tokenName, { exact: true })).toBeAttached();
  await expect(secretField).toHaveCount(0);
  await tokens.click();
  await expect(secretField).toBeVisible();
  await expect(secretField).toHaveValue(/^art_/);
  await expect(secretField).toBeFocused();

  await appearance.click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await tokens.click();
  await expect(page.getByText(tokenName, { exact: true })).toBeVisible();
  await expect(secretField).toHaveCount(0);
});
