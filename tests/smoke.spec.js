import { test, expect } from '@playwright/test';

test.describe('app shell', () => {
  test('home renders and reports the local mock backend', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Directorr/);
    await expect(page.getByTestId('backend-badge')).toHaveText('Local mock');
    await expect(page.getByTestId('mock-notice')).toBeVisible();
    await expect(page.getByTestId('cta-create')).toBeVisible();
  });

  test('unknown magic link id shows the missing state', async ({ page }) => {
    await page.goto('/#/record/does-not-exist');
    await expect(page.getByTestId('record-missing')).toBeVisible();
  });
});
