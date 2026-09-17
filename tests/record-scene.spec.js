import { test, expect } from '@playwright/test';
import { seedTemplate, sceneTemplate, outputSize } from './helpers.js';

test.describe('template filling — scene by scene (Mode B)', () => {
  test('records every scene, previews the stitch, then compiles one file', async ({ page }) => {
    await seedTemplate(page, sceneTemplate());
    await page.goto('/#/record/test-scene-1');

    await expect(page.getByTestId('record-title')).toHaveText('Test Scene');
    await expect(page.getByTestId('record-mode')).toHaveText('Scene by scene');

    // Record each of the three scenes with its strict timer.
    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 25_000 });
    }

    await expect(page.getByTestId('scene-compile')).toBeEnabled();
    await page.getByTestId('scene-compile').click();

    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 45_000 });
    const bytes = await outputSize(page);
    expect(bytes).toBeGreaterThan(1000);
    console.log('[test] compiled scene output bytes:', bytes);
  });

  test('preview plays the stitched timeline without producing an output', async ({ page }) => {
    await seedTemplate(page, sceneTemplate());
    await page.goto('/#/record/test-scene-1');

    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 25_000 });
    }

    await page.getByTestId('scene-preview').click();
    await expect(page.getByTestId('scene-phase')).toContainText('Previewing', { timeout: 10_000 });
    // Preview must not create a downloadable output.
    await expect(page.getByTestId('output-panel')).toHaveCount(0);
    await expect(page.getByTestId('scene-phase')).toHaveText('Ready.', { timeout: 30_000 });
  });

  test('compile and audio-mix controls are locked until every scene is recorded', async ({ page }) => {
    await seedTemplate(page, sceneTemplate());
    await page.goto('/#/record/test-scene-1');

    await expect(page.getByTestId('scene-compile')).toBeDisabled();
    await expect(page.getByTestId('scene-preview')).toBeDisabled();
    await expect(page.getByTestId('mix-voice')).toBeVisible();
    await expect(page.getByTestId('mix-music')).toBeVisible();
  });
});
