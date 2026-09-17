export const TEMPLATES_KEY = 'directorr.templates.v1';

/**
 * Seed a template into the mock backend before the page boots.
 * Runs on every navigation in the test's browser context.
 */
export function seedTemplate(page, template) {
  const record = { id: template.id, createdAt: new Date().toISOString(), json_data: template };
  return page.addInitScript(
    ([key, rec]) => {
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing[rec.id] = rec;
      localStorage.setItem(key, JSON.stringify(existing));
    },
    [TEMPLATES_KEY, record],
  );
}

export function continuousTemplate(overrides = {}) {
  return {
    id: 'test-continuous-1',
    title: 'Test Continuous',
    type: 'continuous',
    durationSeconds: 3,
    continuousConfig: {
      script: 'Welcome to the automated test script. Keep reading until the take stops.',
      theme: { font: 'Arial', fontSize: 44, textColor: '#FFFFFF', backgroundColor: '#1A1A2E' },
      bottomTrack: [],
    },
    ...overrides,
  };
}

export function sceneTemplate(overrides = {}) {
  return {
    id: 'test-scene-1',
    title: 'Test Scene',
    type: 'scene',
    durationSeconds: 4.5,
    sceneConfig: {
      backgroundMusicUrl: '',
      defaultMix: { musicVolume: 0.3, voiceVolume: 1.0, brollOriginalAudio: 0.0 },
      scenes: [
        { id: 'scene-1', type: 'title-slide', durationSeconds: 1.5, text: 'Welcome!' },
        { id: 'scene-2', type: 'camera', durationSeconds: 1.5, instructions: 'Introduce yourself.' },
        { id: 'scene-3', type: 'title-slide', durationSeconds: 1.5, text: 'Thanks!' },
      ],
    },
    ...overrides,
  };
}

/**
 * A scene template with clip prompts and a narration mode, for the audio-only
 * narration paths. Defaults to two short clips so a full take stays quick.
 */
export function narrationSceneTemplate({ narration, scenes, ...overrides } = {}) {
  const base = sceneTemplate(overrides);
  return {
    ...base,
    id: 'test-narration-1',
    title: 'Narration Test',
    sceneConfig: {
      ...base.sceneConfig,
      scenes:
        scenes ||
        [
          { id: 'clip-1', type: 'camera', durationSeconds: 1.2, instructions: 'Introduce yourself in one short line.' },
          { id: 'clip-2', type: 'title-slide', durationSeconds: 1.2, text: 'Thanks!', instructions: 'Close it out.' },
        ],
    },
    narration: {
      mode: 'clip-narration',
      cleanup: { engine: 'webaudio', preset: 'voice' },
      musicDuck: 0.35,
      ...narration,
    },
  };
}

/**
 * Record every string the page ever draws with `fillText`, so a test can assert
 * what the audience actually gets compared with what the talent only reads.
 */
export function spyOnCanvasText(page) {
  return page.addInitScript(() => {
    window.__drawnText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(text, ...rest) {
      window.__drawnText.push(String(text));
      return original.call(this, text, ...rest);
    };
  });
}

export const drawnCanvasText = (page) => page.evaluate(() => window.__drawnText || []);

/** A tiny valid PNG for exercising the asset upload path. */
export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export async function outputSize(page) {
  const raw = await page.getByTestId('output-size').getAttribute('data-bytes');
  return Number(raw);
}
