import { test, expect } from '@playwright/test';
import { ONE_PIXEL_PNG } from './helpers.js';

test.describe('template creation', () => {
  test('creates a continuous template and hands off a working Magic Link', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Weekly Sales Update');
    await page.getByTestId('create-script').fill('Hello team, here is this week in sixty seconds.');
    await page.getByTestId('create-duration').fill('3');
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
    const link = await page.getByTestId('magic-link').innerText();
    expect(link).toContain('#/record/');

    await page.getByTestId('record-link').click();
    await expect(page.getByTestId('record-title')).toHaveText('Weekly Sales Update');
    await expect(page.getByTestId('record-mode')).toHaveText('Continuous');
    await expect(page.getByTestId('record-preview-canvas')).toBeVisible();
  });

  test('creates a scene template with edited scenes and a Magic Link', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Onboarding Storyboard');
    await page.getByTestId('mode-scene').click();

    await page.getByTestId('scene-editor-duration-0').fill('1');
    await page.getByTestId('scene-editor-duration-1').fill('1.5');
    await page.getByTestId('scene-editor-add').click();
    await page.getByTestId('scene-editor-type-2').selectOption('title-slide');
    await page.getByTestId('scene-editor-duration-2').fill('1');
    await page.getByTestId('scene-editor-text-2').fill('Thanks for watching');

    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();

    await page.getByTestId('record-link').click();
    await expect(page.getByTestId('record-title')).toHaveText('Onboarding Storyboard');
    await expect(page.getByTestId('record-mode')).toHaveText('Scene by scene');
    await expect(page.getByTestId('scene-list')).toBeVisible();
    await expect(page.getByTestId('scene-status-0')).toHaveText('Pending');
  });

  test('accepts an ephemeral asset upload with a 7-day warning', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Asset Test');
    // Uploads live behind the picker's Upload tab; the studio library is the
    // default tab because it needs no keys.
    await page.getByTestId('asset-tab-upload').click();
    await page.getByTestId('create-assets').setInputFiles({
      name: 'broll.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });

    await expect(page.getByTestId('asset-list')).toContainText('broll.png');
    await expect(page.getByTestId('picker-notice')).toContainText('auto-deleted after 7 days');
  });

  test('blocks publishing without a title', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('create-error')).toBeVisible();
    await expect(page.getByTestId('magic-link-panel')).toHaveCount(0);
  });
});
