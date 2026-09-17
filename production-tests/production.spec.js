import { test, expect } from '@playwright/test';

/**
 * End-to-end verification of the deployed artifact. The live site currently
 * runs on the mock backend (no Supabase variables configured), so a template
 * created here persists in this browser context and can be recorded from
 * immediately — exactly the real Magic Link flow.
 */
test.describe('production — GitHub Pages', () => {
  test('serves the app shell', async ({ page }) => {
    await page.goto('./');
    await expect(page).toHaveTitle(/Directorr/);
    await expect(page.getByTestId('backend-badge')).toBeVisible();
    await expect(page.getByTestId('cta-create')).toBeVisible();
  });

  test('creates a template and records a continuous take end to end', async ({ page }) => {
    await page.goto('./#/create');
    await page.getByTestId('create-title').fill('Production Smoke');
    await page.getByTestId('create-script').fill('This take was recorded from the deployed build.');
    await page.getByTestId('create-duration').fill('3');
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
    const link = await page.getByTestId('magic-link').innerText();
    expect(link).toContain('/Directorr/#/record/');

    await page.getByTestId('record-link').click();
    await expect(page.getByTestId('record-title')).toHaveText('Production Smoke');

    await expect(page.getByTestId('record-start')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 45_000 });

    const bytes = Number(await page.getByTestId('output-size').getAttribute('data-bytes'));
    console.log('[prod] recorded bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);
  });

  test('serves a scene template end to end', async ({ page }) => {
    await page.goto('./#/create');
    await page.getByTestId('create-title').fill('Prod Scene');
    await page.getByTestId('mode-scene').click();
    await page.getByTestId('scene-editor-duration-0').fill('1');
    await page.getByTestId('scene-editor-duration-1').fill('1');
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
    await page.getByTestId('record-link').click();
    await expect(page.getByTestId('record-mode')).toHaveText('Scene by scene');

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 30_000 });
    }

    await page.getByTestId('scene-compile').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 60_000 });
    const bytes = Number(await page.getByTestId('output-size').getAttribute('data-bytes'));
    console.log('[prod] compiled bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);
  });
});
