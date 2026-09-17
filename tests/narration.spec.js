import { test, expect } from '@playwright/test';
import {
  continuousTemplate,
  drawnCanvasText,
  narrationSceneTemplate,
  outputSize,
  seedTemplate,
  spyOnCanvasText,
} from './helpers.js';

const TEMPLATES_KEY = 'directorr.templates.v1';

/** Enough words to guarantee the prompt scrolls inside a 190px viewport. */
const LONG_LINE =
  'and then keep going with a much longer line so the prompt has somewhere to travel while the strict clip timer runs down to zero before the next clip begins and everything keeps scrolling steadily down the screen.';

async function publishedTemplate(page, title) {
  return page.evaluate(
    ([key, wanted]) => {
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      return (
        Object.values(all)
          .map((record) => record.json_data)
          .find((template) => template?.title === wanted) || null
      );
    },
    [TEMPLATES_KEY, title],
  );
}

/** Sample the visible preview canvas so a test can tell painted from blank. */
function paintedPixels(page, testId = 'scene-preview-canvas') {
  return page.getByTestId(testId).evaluate((el) => {
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4 * 397) {
      if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
    }
    return lit;
  });
}

test.describe('narration — creator side', () => {
  test('only offers the narration modes a template type can actually run', async ({ page }) => {
    await page.goto('/#/create');

    // Mode A has no replay path, so it can only narrate live with the picture.
    await expect(page.getByTestId('narration-mode').locator('option')).toHaveCount(1);
    await expect(page.getByTestId('narration-mode')).toHaveValue('live-mic');

    await page.getByTestId('mode-scene').click();
    await expect(page.getByTestId('narration-mode').locator('option')).toHaveCount(3);

    // The cleanup engine is a swappable seam; the model engine is declared but
    // not selectable until something implements it.
    await expect(page.getByTestId('narration-engine')).toHaveValue('webaudio');
    await expect(page.getByTestId('narration-engine').locator('option[disabled]')).toHaveCount(1);
    await expect(page.getByTestId('narration-preset-blurb')).toContainText('noise suppression');
  });

  test('flags a prompt the talent could not read in its clip', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('mode-scene').click();

    await page.getByTestId('scene-editor-duration-1').fill('2');
    await page.getByTestId('scene-editor-say-1').fill(
      'This is a deliberately long prompt that no human being could possibly read aloud inside a two second clip.',
    );
    await expect(page.getByTestId('scene-editor-pace-1')).toHaveClass(/pace-fast/);
    await expect(page.getByTestId('scene-editor-pace-1')).toContainText('wpm');

    // A pace that fits is reported calmly instead of warning.
    await page.getByTestId('scene-editor-duration-1').fill('20');
    await expect(page.getByTestId('scene-editor-pace-1')).toHaveClass(/pace-fits|pace-room/);

    // Mode A gets the same feedback for its one-take script.
    await page.getByTestId('mode-continuous').click();
    await page.getByTestId('create-script').fill('Short and readable.');
    await page.getByTestId('create-duration').fill('10');
    await expect(page.getByTestId('create-script-pace')).toHaveClass(/pace-room|pace-fits/);
  });

  test('blocks clip-by-clip narration when a clip has nothing to say', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Silent clips');
    await page.getByTestId('mode-scene').click();
    await page.getByTestId('narration-mode').selectOption('clip-narration');
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('create-error')).toContainText('needs a prompt on every clip');
    await expect(page.getByTestId('magic-link-panel')).toHaveCount(0);

    // Filling the gap unblocks it.
    await page.getByTestId('scene-editor-say-0').fill('Say the first thing.');
    await page.getByTestId('scene-editor-say-1').fill('Say the second thing.');
    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();
  });

  test('publishes the narration config, including whether the script ships', async ({ page }) => {
    await page.goto('/#/create');
    await page.getByTestId('create-title').fill('Voice Config');
    await page.getByTestId('create-script').fill('Read this on camera.');
    await page.getByTestId('create-duration').fill('3');
    await page.getByTestId('narration-preset').selectOption('voice-strong');
    await page.getByTestId('create-script-in-output').uncheck();
    await expect(page.getByTestId('create-script-in-output-note')).toContainText('nothing the talent reads is recorded');

    await page.getByTestId('create-submit').click();
    await expect(page.getByTestId('magic-link-panel')).toBeVisible();

    const template = await publishedTemplate(page, 'Voice Config');
    expect(template.narration).toEqual({
      mode: 'live-mic',
      cleanup: { engine: 'webaudio', preset: 'voice-strong' },
      musicDuck: 0.35,
    });
    expect(template.continuousConfig.showScriptInOutput).toBe(false);
  });
});

test.describe('narration — the prompt is talent-only', () => {
  test('shows a scrolling prompt that never reaches the canvas', async ({ page }) => {
    await spyOnCanvasText(page);
    await seedTemplate(
      page,
      narrationSceneTemplate({
        narration: { mode: 'live-mic' },
        scenes: [
          {
            id: 'clip-1',
            type: 'camera',
            durationSeconds: 2,
            // Long enough to overflow the prompt viewport, so scrolling is real.
            instructions: `SECRETSTAGEDIRECTION ${LONG_LINE}`,
          },
          {
            id: 'clip-2',
            type: 'title-slide',
            durationSeconds: 1.5,
            text: 'AUDIENCETITLE',
            instructions: `CLOSINGPROMPT ${LONG_LINE}`,
          },
        ],
      }),
    );
    await page.goto('/#/record/test-narration-1');

    // The talent reads their line before they even press record.
    await expect(page.getByTestId('teleprompter-text')).toContainText('SECRETSTAGEDIRECTION');
    await expect(page.getByTestId('teleprompter-pace')).toContainText('wpm');

    await page.getByTestId('scene-record-0').click();
    await expect(page.getByTestId('scene-hud')).toBeVisible();
    await expect(page.getByTestId('scene-countdown')).toContainText('left');

    // It actually scrolls while the clip is being recorded.
    const first = await page.getByTestId('teleprompter-text').evaluate((el) => el.style.transform);
    await page.waitForTimeout(600);
    const second = await page.getByTestId('teleprompter-text').evaluate((el) => el.style.transform);
    expect(first).not.toBe(second);

    await expect(page.getByTestId('scene-status-0')).toHaveText('Recorded', { timeout: 25_000 });

    // The next clip's prompt is already waiting.
    await expect(page.getByTestId('teleprompter-text')).toContainText('CLOSINGPROMPT');
    await page.getByTestId('scene-record-1').click();
    await expect(page.getByTestId('scene-status-1')).toHaveText('Recorded', { timeout: 25_000 });

    const drawn = await drawnCanvasText(page);
    const drew = (needle) => drawn.some((line) => line.includes(needle));
    // Audience text is composited...
    expect(drew('AUDIENCETITLE')).toBe(true);
    // ...stage direction is not, and never was in this pass.
    expect(drew('SECRETSTAGEDIRECTION')).toBe(false);
    expect(drew('CLOSINGPROMPT')).toBe(false);
  });

  test('lets the talent see their own frame while a clip records', async ({ page }) => {
    await seedTemplate(page, narrationSceneTemplate({ narration: { mode: 'live-mic' } }));
    await page.goto('/#/record/test-narration-1');

    await expect(page.getByTestId('scene-preview-canvas')).toBeVisible();
    await page.getByTestId('scene-record-0').click();
    await page.waitForTimeout(700);

    // The visible canvas mirrors the recording canvas, so the talent is not
    // staring at a blank box while the strict timer runs.
    expect(await paintedPixels(page)).toBeGreaterThan(0);
  });
});

test.describe('narration — audio-only takes', () => {
  test('records narration clip by clip, then compiles the mix', async ({ page }) => {
    await seedTemplate(page, narrationSceneTemplate());
    await page.goto('/#/record/test-narration-1');

    await expect(page.getByTestId('narration-mode-label')).toContainText('clip by clip');
    await expect(page.getByTestId('scene-narration-status-0')).toHaveText('Narration pending');

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 25_000 });
    }

    // Picture alone is not finished work here: the voice is a separate take.
    await expect(page.getByTestId('scene-compile')).toBeDisabled();
    await expect(page.getByTestId('narration-status')).toContainText('0/2 clips narrated');

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-narrate-${i}`).click();
      // The button flipping to "Re-narrate" is the unambiguous signal that the
      // take finished — the status line also reads "Narration pending" before.
      await expect(page.getByTestId(`scene-narrate-${i}`)).toHaveText('Re-narrate', { timeout: 30_000 });
      await expect(page.getByTestId(`scene-narration-status-${i}`)).toHaveText(/Narration \d/);
    }

    await expect(page.getByTestId('scene-compile')).toBeEnabled();
    await expect(page.getByTestId('narration-status')).toContainText('Every clip has narration');
    await expect(page.getByTestId('duck-note')).toContainText('ducked to 35%');

    await page.getByTestId('scene-compile').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 60_000 });
    const bytes = await outputSize(page);
    console.log('[test] clip-narration compile bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);
  });

  test('records one narration across the whole timeline', async ({ page }) => {
    await seedTemplate(
      page,
      narrationSceneTemplate({ narration: { mode: 'full-narration' }, scenes: [
        { id: 'clip-1', type: 'camera', durationSeconds: 1, instructions: 'First line.' },
        { id: 'clip-2', type: 'title-slide', durationSeconds: 1, text: 'Bye', instructions: 'Second line.' },
      ] }),
    );
    await page.goto('/#/record/test-narration-1');

    await expect(page.getByTestId('narration-mode-label')).toContainText('One narration');
    await expect(page.getByTestId('narration-full-status')).toHaveText('Not recorded yet');
    await expect(page.getByTestId('narration-full')).toBeDisabled();

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`scene-record-${i}`).click();
      await expect(page.getByTestId(`scene-status-${i}`)).toHaveText('Recorded', { timeout: 25_000 });
    }

    await expect(page.getByTestId('scene-compile')).toBeDisabled();
    await expect(page.getByTestId('narration-full')).toBeEnabled();
    await page.getByTestId('narration-full').click();

    // The prompt holds the whole script in timeline order while the edit plays.
    await expect(page.getByTestId('teleprompter-text')).toContainText('First line.');
    await expect(page.getByTestId('teleprompter-label')).toContainText('whole script');
    await expect(page.getByTestId('narration-full-status')).toContainText('captured', { timeout: 40_000 });

    await expect(page.getByTestId('scene-compile')).toBeEnabled();
    await page.getByTestId('scene-compile').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 60_000 });
    const bytes = await outputSize(page);
    console.log('[test] full-narration compile bytes:', bytes);
    expect(bytes).toBeGreaterThan(1000);
  });

  test('mode A can keep the script out of the published video', async ({ page }) => {
    await spyOnCanvasText(page);
    await seedTemplate(
      page,
      continuousTemplate({
        id: 'test-prompt-only',
        title: 'Prompt Only',
        durationSeconds: 3,
        continuousConfig: {
          script: `NARRATEDLINE ${LONG_LINE}`,
          theme: { font: 'Arial', fontSize: 44, textColor: '#FFFFFF', backgroundColor: '#1A1A2E' },
          bottomTrack: [],
          showScriptInOutput: false,
        },
        narration: { mode: 'live-mic', cleanup: { engine: 'webaudio', preset: 'voice' }, musicDuck: 0.35 },
      }),
    );
    await page.goto('/#/record/test-prompt-only');

    await expect(page.getByTestId('teleprompter')).toBeVisible();
    await expect(page.getByTestId('teleprompter-text')).toContainText('NARRATEDLINE');
    await expect(page.getByTestId('script-band-note')).toHaveCount(0);

    await expect(page.getByTestId('record-start')).toBeEnabled({ timeout: 25_000 });
    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('record-status')).toContainText('Recording');

    const first = await page.getByTestId('teleprompter-text').evaluate((el) => el.style.transform);
    await page.waitForTimeout(600);
    const second = await page.getByTestId('teleprompter-text').evaluate((el) => el.style.transform);
    expect(first).not.toBe(second);

    // The cleaned microphone is live and metered while the take runs.
    await expect(page.getByTestId('mic-meter')).toBeVisible();

    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 40_000 });
    expect(await outputSize(page)).toBeGreaterThan(1000);
    const drawn = await drawnCanvasText(page);
    expect(drawn.some((line) => line.includes('NARRATEDLINE'))).toBe(false);
  });

  test('mode A burns the script in as a caption band by default', async ({ page }) => {
    await spyOnCanvasText(page);
    await seedTemplate(page, { ...continuousTemplate(), durationSeconds: 3 });
    await page.goto('/#/record/test-continuous-1');

    await expect(page.getByTestId('teleprompter')).toHaveCount(0);
    await expect(page.getByTestId('script-band-note')).toContainText('part of the composite');

    await expect(page.getByTestId('record-start')).toBeEnabled({ timeout: 25_000 });
    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('output-panel')).toBeVisible({ timeout: 40_000 });

    expect((await drawnCanvasText(page)).join(' ')).toContain('Welcome');
  });
});
