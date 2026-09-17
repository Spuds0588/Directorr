import { test, expect } from '@playwright/test';

const TEMPLATES_KEY = 'directorr.templates.v1';

/** Read back the JSON the creator actually published (mock backend = localStorage). */
async function publishedTemplate(page, title) {
  return page.evaluate(
    ([key, wanted]) => {
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      const match = Object.values(all)
        .map((record) => record.json_data)
        .find((template) => template?.title === wanted);
      return match || null;
    },
    [TEMPLATES_KEY, title],
  );
}

const libraryItems = (page) => page.locator('[data-testid^="library-item-"]');

test.describe('B-roll picker — zero-key sources', () => {
  test('opens on the studio library with licence and motion metadata', async ({ page }) => {
    await page.goto('/#/create');

    await expect(page.getByTestId('asset-picker')).toBeVisible();
    await expect(page.getByTestId('library-grid')).toBeVisible({ timeout: 20_000 });
    await expect(libraryItems(page)).toHaveCount(9);

    const still = page.getByTestId('library-item-studio-blueprint-grid');
    const loop = page.getByTestId('library-item-studio-drift-gradient');
    await expect(still).toContainText('CC0');
    await expect(still).toContainText('1280×720');
    await expect(loop).toContainText('video · 4s');

    // The thumbnails are real rendered artwork, not broken images. They are
    // deliberately lazy-loaded, so scroll them into view first.
    await loop.scrollIntoViewIfNeeded();
    await expect.poll(() => loop.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  });

  test('filters the library and carries the asset into the published template JSON', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Library B-roll');
    await page.getByTestId('create-script').fill('A take with a studio library loop underneath.');
    await page.getByTestId('create-duration').fill('3');
    await page.getByTestId('library-grid').waitFor();

    await page.getByTestId('library-search').fill('motion');
    await expect(libraryItems(page)).toHaveCount(3);
    await page.getByTestId('library-search').fill('grid');
    await expect(libraryItems(page)).toHaveCount(2);

    await page.getByTestId('library-add-studio-grid-parallax').click();
    await expect(page.getByTestId('picker-notice')).toContainText('never expires');
    await expect(page.getByTestId('asset-list')).toContainText('Grid parallax');
    await expect(page.getByTestId('asset-list')).toContainText('studio library');
    // Re-adding the same file is prevented, because the store is the truth.
    await expect(page.getByTestId('library-add-studio-grid-parallax')).toBeDisabled();

    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();

    const template = await publishedTemplate(page, 'Library B-roll');
    expect(template.continuousConfig.bottomTrack).toHaveLength(1);
    expect(template.continuousConfig.bottomTrack[0].type).toBe('video');
    expect(template.continuousConfig.bottomTrack[0].url).toContain('studio-grid-parallax.webm');
    expect(template.assetCredits).toHaveLength(1);
    expect(template.assetCredits[0].source).toBe('studio');
    expect(template.assetCredits[0].license).toContain('CC0');
  });

  test('re-hosts a pasted URL as our own copy instead of hotlinking it', async ({ page, baseURL }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Rehost Test');
    await page.getByTestId('create-script').fill('A take over an imported loop.');
    await page.getByTestId('create-duration').fill('3');

    await page.getByTestId('asset-tab-url').click();
    await page.getByTestId('url-input').fill(`${baseURL}/library/studio-light-sweep.webm`);
    await page.getByTestId('url-submit').click();

    await expect(page.getByTestId('picker-notice')).toContainText('hotlinks are never drawn to the canvas');
    await expect(page.getByTestId('asset-list')).toContainText('re-hosted copy');

    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();

    const template = await publishedTemplate(page, 'Rehost Test');
    const url = template.continuousConfig.bottomTrack[0].url;
    // The recorded asset is our stored copy, never the remote link.
    expect(url).not.toContain('/library/');
    expect(url.startsWith('data:') || url.startsWith('blob:')).toBe(true);
    expect(template.assetCredits[0].rehosted).toBe(true);
    expect(template.assetCredits[0].originalUrl).toContain('/library/studio-light-sweep.webm');
  });

  test('refuses a link the host rejects, with a reason instead of a broken take', async ({ page, baseURL }) => {
    // Intercepted so the assertion does not depend on how a dev server treats
    // unknown paths (Vite answers with its HTML fallback, not a 404).
    await page.route('**/missing-clip.mp4', (route) => route.fulfill({ status: 404, body: 'not here' }));
    await page.goto('/#/create');
    await page.getByTestId('asset-tab-url').click();
    await page.getByTestId('url-input').fill(`${baseURL}/missing-clip.mp4`);
    await page.getByTestId('url-submit').click();

    await expect(page.getByTestId('picker-error')).toContainText('HTTP 404');
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
  });

  test('refuses a non-media link and a non-http scheme', async ({ page, baseURL }) => {
    await page.goto('/#/create');
    await page.getByTestId('asset-tab-url').click();

    // An unknown path on the dev server answers with HTML, which is not media.
    await page.getByTestId('url-input').fill(`${baseURL}/library/does-not-exist.webm`);
    await page.getByTestId('url-submit').click();
    await expect(page.getByTestId('picker-error')).toContainText('not media the canvas can composite');
    await expect(page.getByTestId('asset-list')).toHaveCount(0);

    await page.getByTestId('url-input').fill('ftp://example.com/clip.mp4');
    await page.getByTestId('url-submit').click();
    await expect(page.getByTestId('picker-error')).toContainText('Only http(s) links');
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
  });

  test('refuses an unsplash link because that licence forbids stored copies', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('asset-tab-url').click();
    await page.getByTestId('url-input').fill('https://images.unsplash.com/photo-1234567890');
    await page.getByTestId('url-submit').click();

    await expect(page.getByTestId('picker-error')).toContainText('forbids storing copies');
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
  });

  test('uploads still land in the ephemeral bucket', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('asset-tab-upload').click();
    await page.getByTestId('create-assets').setInputFiles({
      name: 'broll.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    await expect(page.getByTestId('picker-notice')).toContainText('auto-deleted after 7 days');
    await expect(page.getByTestId('asset-list')).toContainText('broll.png');
  });
});

test.describe('B-roll picker — provider adapters', () => {
  test('states the key requirement instead of failing silently', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('asset-tab-providers').click();

    await expect(page.getByTestId('stock-search-status')).toHaveText('Search endpoint: not configured');
    await expect(page.getByTestId('provider-pexels')).toBeVisible();
    await expect(page.getByTestId('provider-note-pexels')).toContainText('PEXELS_API_KEY');
    await expect(page.getByTestId('provider-note-pixabay')).toContainText('PIXABAY_API_KEY');
    await expect(page.getByTestId('provider-search-pexels')).toBeDisabled();
    await expect(page.getByTestId('provider-search-pixabay')).toBeDisabled();

    // Unsplash is listed but disabled, with the licence conflict explained.
    await expect(page.getByTestId('provider-unsplash')).toBeVisible();
    await expect(page.getByTestId('provider-note-unsplash')).toContainText('hotlinking');
    await expect(page.getByTestId('provider-search-unsplash')).toBeDisabled();
    // The zero-key tabs are always available.
    await expect(page.getByTestId('asset-tab-library')).toBeEnabled();
    await expect(page.getByTestId('asset-tab-url')).toBeEnabled();
  });
});

test.describe('B-roll picker — recorded end to end', () => {
  test('a studio loop records over the live take without tainting the canvas', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Library Recording');
    await page.getByTestId('create-script').fill('Reading over a generated studio loop.');
    await page.getByTestId('create-duration').fill('3');
    await page.getByTestId('library-grid').waitFor();
    await page.getByTestId('library-add-studio-drift-gradient').click();
    await expect(page.getByTestId('asset-list')).toContainText('Drifting gradient');

    await page.getByTestId('create-submit').click();
    await page.getByTestId('record-link').click();
    await expect(page.getByTestId('record-title')).toHaveText('Library Recording');

    await expect(page.getByTestId('record-start')).toBeEnabled({ timeout: 25_000 });
    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 45_000 });

    const bytes = Number(await page.getByTestId('output-size').getAttribute('data-bytes'));
    console.log('[test] library b-roll recording bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);

    // The decisive assertion: the recording canvas still allows pixel reads.
    // A cross-origin (hotlinked) asset would throw SecurityError here.
    const taint = await page.getByTestId('record-preview-canvas').evaluate((el) => {
      try {
        el.getContext('2d').getImageData(0, 0, 1, 1);
        return 'clean';
      } catch (error) {
        return `tainted: ${error.name}`;
      }
    });
    expect(taint).toBe('clean');
  });

  test('a B-roll scene compiles with a selected library asset', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('B-roll Scene');
    await page.getByTestId('mode-scene').click();
    await page.getByTestId('scene-editor-type-0').selectOption('broll');
    await page.getByTestId('scene-editor-duration-0').fill('1');
    await page.getByTestId('scene-editor-duration-1').fill('1');
    await page.getByTestId('library-grid').waitFor();
    await page.getByTestId('library-add-studio-light-sweep').click();
    await expect(page.getByTestId('asset-list')).toContainText('Light sweep');
    await page.getByTestId('scene-editor-asset-0').selectOption({ label: 'Light sweep' });

    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();

    const template = await publishedTemplate(page, 'B-roll Scene');
    expect(template.sceneConfig.scenes[0].type).toBe('broll');
    expect(template.sceneConfig.scenes[0].assetUrl).toContain('studio-light-sweep.webm');

    await page.getByTestId('record-link').click();
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 25_000 });
    }
    await page.getByTestId('scene-compile').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 60_000 });

    const bytes = Number(await page.getByTestId('output-size').getAttribute('data-bytes'));
    console.log('[test] b-roll scene compile bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);
  });

  test('a B-roll scene without an asset is blocked before publishing', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Empty B-roll');
    await page.getByTestId('mode-scene').click();
    await page.getByTestId('scene-editor-type-0').selectOption('broll');
    // Remove every asset so the scene has nothing to fill with.
    await page.getByTestId('create-submit').click();

    // With no assets at all there is no fallback, so validation must catch it.
    await expect(page.getByTestId('create-error')).toContainText('B-roll');
    await expect(page.getByTestId('magic-link-panel')).toHaveCount(0);
  });
});
