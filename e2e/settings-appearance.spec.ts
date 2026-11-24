import { expect } from '@playwright/test';
import { test } from './fixtures';

test('live reading preview body uses the chosen reading font and text size', async ({ page }) => {
  await page.goto('/settings');
  const preview = page.getByRole('complementary', { name: 'Live reading preview' });
  const paragraph = preview.getByText(/^From the pass,/);
  const font = page.getByRole('combobox', { name: 'Reading font' });
  const size = page.getByRole('combobox', { name: 'Text size' });
  await expect(paragraph).toHaveCSS('font-family', /^ui-serif,/);
  await expect(paragraph).toHaveCSS('font-size', '16px');

  await font.selectOption('mono');
  await size.selectOption('20');
  await expect(paragraph).toHaveCSS('font-family', /^ui-monospace,/);
  await expect(paragraph).toHaveCSS('font-size', '20px');

  await page.reload();
  await expect(font).toHaveValue('mono');
  await expect(size).toHaveValue('20');
  await expect(paragraph).toHaveCSS('font-family', /^ui-monospace,/);
  await expect(paragraph).toHaveCSS('font-size', '20px');
});
