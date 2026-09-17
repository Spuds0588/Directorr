/**
 * Template schema helpers — the JSON contract from PRD section 2.3.
 * One config object is populated based on the `type` discriminator.
 */

export const DEFAULT_THEME = {
  font: 'Arial',
  fontSize: 44,
  textColor: '#FFFFFF',
  backgroundColor: '#1A1A2E',
};

export const DEFAULT_MIX = {
  musicVolume: 0.3,
  voiceVolume: 1.0,
  brollOriginalAudio: 0.0,
};

export const SCENE_TYPES = ['title-slide', 'camera', 'broll'];

/**
 * How the voice gets onto the video.
 *
 * `instructions` on a scene is the PROMPT: what the talent reads. It used to be
 * painted into the recording, which published stage direction to the audience;
 * it is now shown in a scrolling DOM teleprompter and never recorded.
 */
export const NARRATION_MODES = [
  {
    id: 'live-mic',
    label: 'Live mic during the take',
    blurb: 'The microphone is captured with the picture. One pass, nothing to assemble — the scrolling prompt keeps the talent on pace.',
    types: ['continuous', 'scene'],
  },
  {
    id: 'clip-narration',
    label: 'Narration clip by clip',
    blurb:
      'Record the picture silently, then read each clip on its own while that clip replays. Retake one line without redoing the take.',
    types: ['scene'],
  },
  {
    id: 'full-narration',
    label: 'One narration over the whole video',
    blurb:
      'Record the picture silently, then read the whole script while the finished timeline plays back in order.',
    types: ['scene'],
  },
];

export const DEFAULT_NARRATION = {
  mode: 'live-mic',
  // Which implementation processes the voice. Recorded per take so a future
  // model-based cleaner can coexist with takes made by the Web Audio chain.
  cleanup: { engine: 'webaudio', preset: 'voice' },
  // Music gain multiplier while narration plays. 1 = no ducking.
  musicDuck: 0.35,
};

export function narrationModeById(id) {
  return NARRATION_MODES.find((mode) => mode.id === id) || NARRATION_MODES[0];
}

/** Only the modes that make sense for a template type. */
export function narrationModesFor(type) {
  return NARRATION_MODES.filter((mode) => mode.types.includes(type));
}

/**
 * The prompt for one clip. `text` is audience-facing on a title slide, so it is
 * never a fallback here — the talent should not be told to read a caption aloud.
 */
export function scenePrompt(scene) {
  return String(scene?.instructions || '').trim();
}

/** Every clip's prompt, in timeline order — what the one-take narration reads. */
export function fullNarrationScript(scenes = []) {
  return scenes
    .map((scene) => scenePrompt(scene))
    .filter(Boolean)
    .join('\n\n');
}

export function buildNarrationConfig({ mode = DEFAULT_NARRATION.mode, cleanup = {}, musicDuck } = {}) {
  return {
    mode,
    cleanup: { ...DEFAULT_NARRATION.cleanup, ...cleanup },
    musicDuck: musicDuck === undefined || musicDuck === null ? DEFAULT_NARRATION.musicDuck : Number(musicDuck),
  };
}

/**
 * Provenance for every third-party asset a template actually uses.
 *
 * `assetCredits` is additive to the PRD 2.3 schema: engines ignore it, but the
 * licence obligation travels with the published template instead of living only
 * in the creator's memory (the old hotlink-and-hope approach). Deleting a source
 * asset from a template also removes its credit, because this is derived from
 * what the template references.
 */
export function buildAssetCredits(assets = []) {
  const seen = new Set();
  return assets
    .filter((asset) => asset && asset.url && !seen.has(asset.url) && seen.add(asset.url))
    .map((asset) => ({
      url: asset.url,
      name: asset.name || '',
      source: asset.source || 'unknown',
      credit: asset.attribution || '',
      license: asset.license || 'Unverified — the creator is responsible for the rights to this file',
      originalUrl: asset.originalUrl || '',
      rehosted: Boolean(asset.rehosted),
    }));
}

export function buildContinuousTemplate({
  title = 'Untitled',
  durationSeconds = 30,
  script = '',
  theme = {},
  bottomTrack = [],
  assetCredits = [],
  narration = {},
  showScriptInOutput = true,
} = {}) {
  return {
    id: 'uuid-1234',
    title,
    type: 'continuous',
    durationSeconds: Number(durationSeconds) || 30,
    continuousConfig: {
      script,
      theme: { ...DEFAULT_THEME, ...theme },
      bottomTrack,
      // When false the script becomes a talent-only prompt instead of a caption
      // band burned into the composite.
      showScriptInOutput: showScriptInOutput !== false,
    },
    narration: buildNarrationConfig(narration),
    ...(assetCredits.length ? { assetCredits } : {}),
  };
}

export function buildSceneTemplate({
  title = 'Untitled',
  scenes = [],
  backgroundMusicUrl = '',
  defaultMix = {},
  assetCredits = [],
  narration = {},
} = {}) {
  return {
    id: 'uuid-1234',
    title,
    type: 'scene',
    durationSeconds: scenes.reduce((total, s) => total + (Number(s.durationSeconds) || 0), 0),
    sceneConfig: {
      backgroundMusicUrl,
      defaultMix: { ...DEFAULT_MIX, ...defaultMix },
      scenes: scenes.map((scene, index) => ({
        id: scene.id || `scene-${index + 1}`,
        type: scene.type || 'camera',
        durationSeconds: Number(scene.durationSeconds) || 3,
        text: scene.text || '',
        instructions: scene.instructions || '',
        assetUrl: scene.assetUrl || '',
      })),
    },
    narration: buildNarrationConfig(narration),
    ...(assetCredits.length ? { assetCredits } : {}),
  };
}

export function validateTemplate(template) {
  const errors = [];
  if (!template) return ['Template is empty.'];
  if (!template.title) errors.push('Missing title.');
  if (template.type !== 'continuous' && template.type !== 'scene') {
    errors.push('type must be "continuous" or "scene".');
  }
  if (template.type === 'continuous' && !template.continuousConfig) {
    errors.push('continuous templates require continuousConfig.');
  }
  if (template.type === 'scene') {
    const scenes = template.sceneConfig?.scenes;
    if (!Array.isArray(scenes) || !scenes.length) errors.push('scene templates require at least one scene.');
    (scenes || []).forEach((scene, i) => {
      if (!(Number(scene.durationSeconds) > 0)) errors.push(`Scene ${i + 1} needs a positive duration.`);
      if (scene.type === 'broll' && !scene.assetUrl) errors.push(`Scene ${i + 1} is B-roll but has no asset selected.`);
    });
  }
  if (template.type === 'continuous') {
    (template.continuousConfig?.bottomTrack || []).forEach((item, i) => {
      if (!item.url) errors.push(`Bottom-track item ${i + 1} has no URL.`);
    });
  }
  if (template.narration) {
    const mode = narrationModeById(template.narration.mode);
    if (!mode.types.includes(template.type)) {
      errors.push(`Narration mode "${template.narration.mode}" is not available for ${template.type} templates.`);
    }
  }
  if (errors.length) console.warn('[templateSchema] validation errors', errors);
  return errors;
}
