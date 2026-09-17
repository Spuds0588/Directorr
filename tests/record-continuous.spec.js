import { test, expect } from '@playwright/test';
import { seedTemplate, continuousTemplate, outputSize } from './helpers.js';

test.describe('template filling — continuous (Mode A)', () => {
  test('records a one-take video and auto-stops at the strict duration', async ({ page }) => {
    await seedTemplate(page, continuousTemplate());
    await page.goto('/#/record/test-continuous-1');

    await expect(page.getByTestId('record-title')).toHaveText('Test Continuous');
    await expect(page.getByTestId('record-mode')).toHaveText('Continuous');

    // Camera + fake device takes a beat to become ready.
    await expect(page.getByTestId('record-start')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('record-start').click();

    await expect(page.getByTestId('record-status')).toContainText('Recording', { timeout: 10_000 });

    // 3s strict timeline -> output appears without any manual stop.
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('output-video')).toBeVisible();

    const bytes = await outputSize(page);
    expect(bytes).toBeGreaterThan(1000);
    console.log('[test] continuous output bytes:', bytes);
  });

  test('renders the teleprompter onto the canvas', async ({ page }) => {
    await seedTemplate(page, continuousTemplate());
    await page.goto('/#/record/test-continuous-1');
    const canvas = page.getByTestId('record-preview-canvas');
    await expect(canvas).toBeVisible();

    // Give the rAF loop a moment, then assert the canvas is actually painted.
    await page.waitForTimeout(1200);
    const painted = await canvas.evaluate((el) => {
      const ctx = el.getContext('2d');
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let nonBackground = 0;
      for (let i = 0; i < data.length; i += 4 * 97) {
        if (data[i] + data[i + 1] + data[i + 2] > 40) nonBackground += 1;
      }
      return nonBackground;
    });
    expect(painted).toBeGreaterThan(0);
  });
});
