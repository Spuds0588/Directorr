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

export function buildContinuousTemplate({
  title = 'Untitled',
  durationSeconds = 30,
  script = '',
  theme = {},
  bottomTrack = [],
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
    },
  };
}

export function buildSceneTemplate({
  title = 'Untitled',
  scenes = [],
  backgroundMusicUrl = '',
  defaultMix = {},
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
    });
  }
  if (errors.length) console.warn('[templateSchema] validation errors', errors);
  return errors;
}
