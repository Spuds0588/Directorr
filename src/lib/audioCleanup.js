/**
 * Voice capture and cleanup.
 *
 * This is the seam for audio: today it is Chrome's own capture tooling plus a
 * Web Audio chain; tomorrow it can be a model you have tested in another project
 * without either engine changing.
 *
 * Two layers, deliberately separate:
 *
 *   1. BROWSER capture constraints. `noiseSuppression` is Chrome's in-built
 *      suppressor, `echoCancellation` kills speaker bleed, `autoGainControl`
 *      evens out distance from the mic. Free, real-time, no dependency, and the
 *      single biggest quality win for on-device narration.
 *   2. A Web Audio graph on top: rumble filter, mud cut, and a leveling
 *      compressor, so a quiet take and a loud one land at the same place.
 *
 * An `engine` id selects which implementation builds the chain. Adding
 * `rnnoise-worklet` or a WASM model later means adding one entry to
 * CLEANUP_ENGINES and one branch in `createVoiceProcessor` — the template JSON
 * already records which engine produced a take, so old templates keep working.
 */

export const CLEANUP_ENGINES = [
  {
    id: 'webaudio',
    label: 'Browser built-ins (Web Audio)',
    blurb: "Chrome's own noise suppression, echo cancellation and auto gain, then a filter + compressor chain.",
    available: true,
  },
  {
    id: 'model',
    label: 'External cleanup model',
    blurb:
      'Reserved. A tested denoise/enhance model can replace the chain by adding an AudioWorklet here — templates record which engine made a take, so nothing else changes.',
    available: false,
  },
];

/**
 * `chain` entries are built in order between the source and the destination.
 * `browser` maps straight onto getUserMedia, so "raw" really is raw — which is
 * what makes the difference audible.
 */
export const CLEANUP_PRESETS = [
  {
    id: 'raw',
    label: 'Raw mic',
    blurb: 'No browser processing and no Web Audio chain. Use it to hear what the others are doing.',
    browser: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    chain: [],
  },
  {
    id: 'voice',
    label: 'Voice (recommended)',
    blurb: 'Browser noise suppression + auto gain, a 90 Hz rumble filter and a leveling compressor.',
    browser: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    chain: [
      { type: 'highpass', frequency: 90, q: 0.7 },
      { type: 'compressor', threshold: -24, knee: 24, ratio: 3, attack: 0.005, release: 0.25 },
      { type: 'gain', value: 1.4 },
    ],
  },
  {
    id: 'voice-strong',
    label: 'Voice, boomy room',
    blurb: 'Adds a low-mid cut and harder compression for close-mic or untreated rooms.',
    browser: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    chain: [
      { type: 'highpass', frequency: 110, q: 0.7 },
      { type: 'peaking', frequency: 250, gain: -5, q: 1.0 },
      { type: 'compressor', threshold: -28, knee: 20, ratio: 5, attack: 0.004, release: 0.2 },
      { type: 'gain', value: 1.8 },
    ],
  },
];

export const DEFAULT_CLEANUP = { engine: 'webaudio', preset: 'voice' };

export function presetById(id) {
  return CLEANUP_PRESETS.find((preset) => preset.id === id) || CLEANUP_PRESETS[1];
}

export function normalizeCleanup(cleanup = {}) {
  const preset = presetById(cleanup.preset);
  const engine = CLEANUP_ENGINES.find((item) => item.id === cleanup.engine && item.available);
  return { engine: engine?.id || DEFAULT_CLEANUP.engine, preset: preset.id };
}

/** getUserMedia audio constraints for a preset. Video is always off here. */
export function narrationConstraints(presetId) {
  return { ...presetById(presetId).browser, channelCount: 1 };
}

function buildNode(ctx, spec) {
  switch (spec.type) {
    case 'highpass':
    case 'peaking': {
      const filter = ctx.createBiquadFilter();
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.q ?? 1;
      if (spec.type === 'peaking') filter.gain.value = spec.gain ?? 0;
      return filter;
    }
    case 'compressor': {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = spec.threshold;
      compressor.knee.value = spec.knee;
      compressor.ratio.value = spec.ratio;
      compressor.attack.value = spec.attack;
      compressor.release.value = spec.release;
      return compressor;
    }
    case 'gain': {
      const gain = ctx.createGain();
      gain.gain.value = spec.value ?? 1;
      return gain;
    }
    default:
      throw new Error(`Unknown cleanup node "${spec.type}".`);
  }
}

/**
 * Insert a cleanup chain between a source and the rest of the graph.
 *
 *   source -> input -> [ chain... ] -> output
 *
 * `output` is what you record or monitor; `analyser` taps it so a level meter
 * shows the processed signal, not the raw one.
 */
export function createVoiceProcessor(audioContext, source, { engine = 'webaudio', preset = 'voice' } = {}) {
  if (!CLEANUP_ENGINES.find((item) => item.id === engine && item.available)) {
    throw new Error(`Cleanup engine "${engine}" is not implemented yet.`);
  }

  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;
  output.connect(analyser);

  let chainNodes = [];
  let currentPreset = null;

  function rebuild(presetId) {
    input.disconnect();
    chainNodes.forEach((node) => node.disconnect());
    chainNodes = [];

    let cursor = input;
    for (const spec of presetById(presetId).chain) {
      const node = buildNode(audioContext, spec);
      cursor.connect(node);
      cursor = node;
      chainNodes.push(node);
    }
    cursor.connect(output);
    currentPreset = presetById(presetId).id;
    console.log('[audioCleanup] chain rebuilt', {
      engine,
      preset: currentPreset,
      nodes: chainNodes.map((node) => node.constructor.name),
    });
  }

  source.connect(input);
  rebuild(preset);

  return {
    input,
    output,
    analyser,
    engine,
    get preset() {
      return currentPreset;
    },
    describe: () => ({ engine, preset: currentPreset, nodes: chainNodes.length }),
    setPreset: (presetId) => rebuild(presetId),
    dispose: () => {
      try {
        source.disconnect();
        input.disconnect();
        chainNodes.forEach((node) => node.disconnect());
        output.disconnect();
      } catch (error) {
        console.warn('[audioCleanup] dispose', error);
      }
      chainNodes = [];
    },
  };
}

/** RMS level of the processed signal, 0..1 — drives the input meter. */
export function readLevel(analyser) {
  if (!analyser) return 0;
  const buffer = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 3);
}

export function describeCleanup(cleanup) {
  const { engine, preset } = normalizeCleanup(cleanup);
  const definition = presetById(preset);
  return `${CLEANUP_ENGINES.find((item) => item.id === engine)?.label || engine} · ${definition.label}`;
}
