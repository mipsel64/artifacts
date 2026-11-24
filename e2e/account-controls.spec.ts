import { expect } from '@playwright/test';
import { test } from './fixtures';

const name = 'owner';

test('the account dropdown owns Settings and the brand returns to the library', async ({ page }) => {
  await page.goto('/new');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Library', exact: true })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'New artifact' })).toHaveAttribute('aria-current', 'page');
  const trigger = header.getByRole('button', { name, exact: true });
  await trigger.press('Enter');
  const account = page.getByRole('dialog', { name: /account/i });
  const settings = account.getByRole('link', { name: 'Settings', exact: true });
  await expect(settings).toHaveAttribute('href', '/settings');
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await settings.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await trigger.click();
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const brand = header.getByRole('link', { name: /artifacts/i, exact: false });
  await brand.click();
  await expect(page.getByRole('heading', { name: 'Artifact library' })).toBeVisible();
  await expect(brand).toHaveAttribute('aria-current', 'page');
});

test('one appearance is selected and a keyboard choice survives reload', async ({ page, context }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name, exact: true });
  await trigger.press('Enter');
  const group = page.getByRole('radiogroup', { name: 'Appearance' });
  const radio = (label: string) => group.getByRole('radio', { name: label, exact: true });
  await expect(radio('System')).toBeChecked();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(radio('System')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(radio('Light')).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(radio('Dark')).toBeChecked();
  await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  await expect(radio('Dark')).toBeChecked();
  await radio('System').click();
  await expect(radio('System')).toBeChecked();
  expect((await context.cookies()).some(({ name }) => name === 'theme')).toBe(false);
});

test('the first Escape on an appearance option closes Account', async ({ page }) => {
  await page.goto('/new');
  const trigger = page.getByRole('button', { name, exact: true });
  await trigger.press('Enter');
  const account = page.getByRole('dialog', { name: /account/i });
  await expect(account.getByRole('link', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(account.getByRole('radio', { name: 'System' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Tab leaves Account in both directions', async ({ page }) => {
  await page.goto('/new');
  const trigger = page.getByRole('button', { name, exact: true });
  await trigger.press('Enter');
  const account = page.getByRole('dialog', { name: /account/i });
  const settings = account.getByRole('link', { name: 'Settings' });
  await expect(settings).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await page.goto('/new');
  await trigger.press('Enter');
  await expect(settings).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(account.getByRole('radio', { name: 'System' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: /^Title\b/ })).toBeFocused();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('Account still opens Settings', async ({ page }) => {
    await page.goto('/new');
    await page.getByRole('button', { name, exact: true }).click();
    const account = page.getByRole('dialog', { name: /account/i });
    await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await account.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe('phone account dropdown', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test('keeps all three appearance buttons together and accepts touch', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name, exact: true }).tap();
    const group = page.getByRole('radiogroup', { name: 'Appearance' });
    const lights = group.getByRole('radio', { name: 'Light', exact: true });
    await lights.tap();
    await expect(lights).toBeChecked();
    const rects = await group.getByRole('radio').evaluateAll(radios => radios.map(radio => {
      const { top, left, right } = radio.getBoundingClientRect();
      return { top, left, right };
    }));
    expect(rects).toHaveLength(3);
    expect(rects.every(rect => rect.top === rects[0].top && rect.left >= 0 && rect.right <= 320)).toBe(true);
    expect(rects[1].left).toBeGreaterThan(rects[0].left);
    expect(rects[2].left).toBeGreaterThan(rects[1].left);
  });
});
