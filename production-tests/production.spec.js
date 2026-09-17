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

  test('ships the zero-key studio library and the B-roll picker', async ({ page }) => {
    await page.goto('./#/create');
    await page.getByTestId('library-grid').waitFor({ timeout: 30_000 });

    await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(9);
    const loop = page.getByTestId('library-item-studio-drift-gradient');
    await expect(loop).toContainText('video · 4s');
    // The generated artwork must actually be served from the project sub-path.
    // Thumbnails are lazy-loaded, so bring this one into view first.
    await loop.scrollIntoViewIfNeeded();
    await expect.poll(() => loop.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.getByTestId('asset-tab-providers').click();
    await expect(page.getByTestId('stock-search-status')).toHaveText('Search endpoint: not configured');
    await expect(page.getByTestId('provider-search-pexels')).toBeDisabled();
  });

  test('prompts the talent and takes narration from the deployed build', async ({ page }) => {
    await page.goto('./#/create');
    await page.getByTestId('create-title').fill('Prod Narration');
    await page.getByTestId('mode-scene').click();
    await page.getByTestId('narration-mode').selectOption('clip-narration');
    await page.getByTestId('scene-editor-say-0').fill('Open with the headline.');
    await page.getByTestId('scene-editor-say-1').fill('Close with the ask.');
    await page.getByTestId('scene-editor-duration-0').fill('1');
    await page.getByTestId('scene-editor-duration-1').fill('1');
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
    await page.getByTestId('record-link').click();

    // The clip's prompt is on screen, in the DOM, before anything is recorded.
    await expect(page.getByTestId('teleprompter-text')).toContainText('Open with the headline.');
    await expect(page.getByTestId('narration-mode-label')).toContainText('clip by clip');
    await expect(page.getByTestId('scene-narrate-0')).toBeDisabled();

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 40_000 });
    }

    // Picture alone is not finished work in clip-narration mode.
    await expect(page.getByTestId('scene-compile')).toBeDisabled();
    await page.getByTestId('scene-narrate-0').click();
    await expect(page.getByTestId('scene-narrate-0')).toHaveText('Re-narrate', { timeout: 40_000 });
  });

  test('re-hosts a pasted URL instead of hotlinking it', async ({ page }) => {
    await page.goto('./#/create');
    await page.getByTestId('create-title').fill('Prod Rehost');
    await page.getByTestId('create-script').fill('Imported loop recorded from the deployed build.');
    await page.getByTestId('create-duration').fill('3');

    await page.getByTestId('asset-tab-url').click();
    await page.getByTestId('url-input').fill(new URL('library/studio-light-sweep.webm', page.url()).href);
    await page.getByTestId('url-submit').click();

    await expect(page.getByTestId('asset-list')).toContainText('re-hosted copy', { timeout: 30_000 });
    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
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
