import { readFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ArtifactView } from '../src/types';
import { installSession, test } from './fixtures';
import { origin, reader } from './settings';

const title = 'Fixture report';
const contents = '<h1>First version</h1>';
const commands = [
  'Copy', 'Download', 'Open in new tab', 'Rename…', 'Edit',
  'Export as Markdown', 'Export as HTML', 'Export as PDF', 'Make permanent', 'Delete',
];

async function createArtifact(request: APIRequestContext): Promise<ArtifactView> {
  const response = await request.post('/api/artifacts', {
    headers: { Origin: origin },
    data: { type: 'html', title, content: contents },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function savedArtifact(request: APIRequestContext, id: string): Promise<ArtifactView> {
  const response = await request.get(`/api/artifacts/${id}`);
  await expect(response).toBeOK();
  return response.json();
}

async function enterReader(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
}

test('the title menu is keyboard-driven and exports the selected version', async ({ page, context }) => {
  const artifact = await createArtifact(page.request);
  const updated = await page.request.patch(`/api/artifacts/${artifact.id}`, {
    headers: { Origin: origin },
    data: { content: '<h1>Second version</h1>' },
  });
  await expect(updated).toBeOK();
  expect(await updated.json()).toMatchObject({ version: 2 });
  await enterReader(page, `${artifact.url}?v=1`);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });

  const trigger = page.getByRole('button', { name: title, exact: true });
  const menu = page.getByRole('menu');
  const item = (name: string) => menu.getByRole('menuitem', { name, exact: true });
  await trigger.press('ArrowDown');
  await expect(menu.getByRole('menuitem')).toHaveText(commands);
  await expect(item('Copy')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item('Download')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(item('Copy')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(item('Copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(contents);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  for (const [command, extension] of [
    ['Download', '.html'], ['Export as Markdown', '.md'], ['Export as HTML', '.html'],
  ]) {
    await trigger.press('Enter');
    const [download] = await Promise.all([page.waitForEvent('download'), item(command).click()]);
    expect(download.suggestedFilename()).toBe(`fixture-report${extension}`);
    const result = await readFile(await download.path(), 'utf8');
    expect(result).toContain(contents);
    expect(result).not.toContain('Second version');
    await expect(menu).toBeHidden();
  }

  for (const [command, suffix] of [['Open in new tab', '?v=1'], ['Export as PDF', '?v=1&print=1']]) {
    await trigger.press('Enter');
    const [popup] = await Promise.all([context.waitForEvent('page'), item(command).click()]);
    await expect(popup).toHaveURL(`${artifact.renderUrl}${suffix}`);
    await expect(popup.getByRole('heading', { name: 'First version' })).toBeVisible();
    await popup.close();
    await expect(menu).toBeHidden();
  }

  await trigger.press('Enter');
  await item('Edit').click();
  await expect(page).toHaveURL(`${artifact.url}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit artifact' })).toBeVisible();
});

test('rename, retention and confirmed deletion persist over HTTP', async ({ page }) => {
  const artifact = await createArtifact(page.request);
  await enterReader(page, artifact.url);
  const menu = page.getByRole('menu');
  await page.getByRole('button', { name: title, exact: true }).press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Rename…', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rename artifact' });
  const renamed = 'Renamed fixture report';
  const input = dialog.getByRole('textbox', { name: 'Title' });
  await expect(input).toBeFocused();
  await input.fill(renamed);
  await input.press('Enter');
  await expect(dialog).toBeHidden();
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ title: renamed, version: 1 });

  const trigger = page.getByRole('button', { name: renamed, exact: true });
  await trigger.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeFocused();
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    menu.getByRole('menuitem', { name: 'Make permanent' }).press('Enter'),
  ]);
  expect((await savedArtifact(page.request, artifact.id)).expiresAt).toBeNull();
  await page.waitForLoadState();
  await trigger.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Set to expire' })).toBeVisible();
  const deleteItem = menu.getByRole('menuitem', { name: 'Delete', exact: true });
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('alertdialog', { name: 'Delete this artifact and all its versions?' });
  const cancel = confirm.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ title: renamed });

  await trigger.press('ArrowUp');
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cancel).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).press('Enter');
  await expect(page).toHaveURL(`${origin}/`);
  expect((await page.request.get(`/api/artifacts/${artifact.id}`)).status()).toBe(404);
});

test('new shares default to restricted; invalid input and cancel do not change access', async ({ page, request }) => {
  const artifact = await createArtifact(page.request);
  await enterReader(page, artifact.url);
  const trigger = page.getByRole('button', { name: /^Share(?:, shared)?$/ });
  const dialog = page.getByRole('dialog', { name: 'Share artifact' });
  const specific = dialog.getByRole('radio', { name: 'Specific people' });
  const anyone = dialog.getByRole('radio', { name: 'Anyone with the link' });
  const audience = dialog.getByRole('textbox', { name: 'Emails or @domains' });

  await trigger.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Space');
  await dialog.getByRole('tab', { name: 'Export' }).press('Enter');
  const exportPanel = dialog.getByRole('tabpanel', { name: 'Export' });
  await expect(exportPanel.getByRole('link', { name: /^Markdown\b/ })).toBeVisible();
  await expect(exportPanel.getByRole('link', { name: /^HTML\b/ })).toBeVisible();
  await expect(exportPanel.getByText('PDF', { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Link' }).press('Enter');
  await expect(dialog.getByText('Current access: Not shared')).toBeVisible();
  await expect(specific).toBeChecked();
  await expect(anyone).not.toBeChecked();

  const create = dialog.getByRole('button', { name: 'Create link' });
  await create.press('Enter');
  await expect(audience).toHaveAccessibleDescription(/add at least one email or @domain/i);
  await expect(audience).toBeFocused();
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ shareUrl: null, shareAudience: null });
  await audience.fill('not-an-address');
  await create.press('Enter');
  await expect(audience).toHaveAccessibleDescription(/not-an-address/);
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ shareUrl: null, shareAudience: null });

  await audience.fill(reader.email);
  await create.press('Enter');
  const save = dialog.getByRole('button', { name: 'Save access' });
  await expect(save).toBeVisible();
  const shared = await savedArtifact(page.request, artifact.id);
  const link = `${origin}/s/${shared.shareId}`;
  expect(shared).toMatchObject({ shareId: expect.any(String), shareUrl: link, shareAudience: [reader.email] });
  await expect(dialog.getByText('Current access: Specific people')).toBeVisible();
  expect((await request.get(link)).status()).toBe(403);

  await audience.fill('still-invalid');
  await save.press('Enter');
  await expect(audience).toHaveAccessibleDescription(/still-invalid/);
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ shareUrl: shared.shareUrl, shareAudience: [reader.email] });

  const stop = dialog.getByRole('button', { name: 'Stop sharing', exact: true });
  const confirm = dialog.getByRole('region', { name: 'Disable this link?' });
  const keep = confirm.getByRole('button', { name: 'Keep link' });
  await stop.press('Enter');
  await expect(keep).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(stop).toBeFocused();
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ shareUrl: shared.shareUrl, shareAudience: [reader.email] });

  await stop.press('Enter');
  await confirm.getByRole('button', { name: 'Stop sharing', exact: true }).press('Enter');
  await expect(create).toBeFocused();
  await expect(specific).toBeChecked();
  expect(await savedArtifact(page.request, artifact.id)).toMatchObject({ shareUrl: null, shareAudience: null });
  expect((await request.get(link)).status()).toBe(404);
});

test('a listed view-only reader has no owner menu or controls', async ({ page, context }) => {
  const artifact = await createArtifact(page.request);
  const response = await page.request.post(`/api/artifacts/${artifact.id}/share`, {
    headers: { Origin: origin },
    data: { audience: [reader.email] },
  });
  await expect(response).toBeOK();
  const shared: ArtifactView = await response.json();

  await context.clearCookies();
  await installSession(context, reader);
  await enterReader(page, shared.shareUrl!);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true }).or(page.getByRole('link', { name: 'Download', exact: true }))).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Share|Remix)/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^(Rename|Edit$|Make permanent$|Set to expire$|Delete$|Stop sharing$)/, includeHidden: true })).toHaveCount(0);
  expect((await page.request.get(`/api/artifacts/${artifact.id}`)).status()).toBe(401);
});
