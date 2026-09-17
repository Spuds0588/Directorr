import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCamera, attachStream } from '../../hooks/useCamera.js';
import { useNarration } from '../../hooks/useNarration.js';
import { useAppStore } from '../../store/useAppStore.js';
import {
  drawCover,
  pickRecorderMimeType,
  buildFileName,
  waitForMedia,
  createVideoElement,
  createAudioElement,
} from '../../lib/mediaUtils.js';
import { DEFAULT_NARRATION, fullNarrationScript, narrationModeById, scenePrompt } from '../../lib/templateSchema.js';
import { readLevel } from '../../lib/audioCleanup.js';
import { useLiveMic } from '../../hooks/useLiveMic.js';
import Teleprompter from '../Teleprompter.jsx';

const CANVAS_W = 720;
const CANVAS_H = 1280;
const FPS = 30;

/**
 * Render one scene's OUTPUT frame at time `t` (seconds since the scene began).
 *
 * Only what the audience should see goes on this canvas: the composite, the
 * on-screen title text, the timed B-roll. Prompts, timers and per-clip
 * instructions are DOM (see Teleprompter.jsx) — burning stage direction into the
 * published video was the old behaviour, and it was wrong.
 */
function drawSceneFrame(ctx, scene, t, { cameraVideo, asset }) {
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (scene.type === 'camera') {
    if (cameraVideo && cameraVideo.readyState >= 2) {
      drawCover(ctx, cameraVideo, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  } else if (scene.type === 'broll') {
    if (asset) {
      drawCover(ctx, asset, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#2c2c3d';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  } else {
    // title-slide (and any unknown type)
    ctx.globalAlpha = Math.min(1, t / 0.6);
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 64px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = String(scene.text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > CANVAS_W - 120 && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    const startY = CANVAS_H / 2 - ((lines.length - 1) * 76) / 2;
    lines.forEach((row, i) => ctx.fillText(row, CANVAS_W / 2, startY + i * 76));
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
}

/**
 * Engine B — Scene-by-scene mode (PRD 2.2).
 *
 * 1. Each scene is recorded for exactly its `durationSeconds` -> Blob URL.
 * 2. Audio is mixed with a Web Audio graph (voice / music / B-roll / narration).
 * 3. "Preview" replays the stitched timeline on the visible canvas.
 * 4. "Compile" forks the exact same loop onto a hidden 1:1 canvas piped to
 *    MediaRecorder, producing a single file with the mixed audio.
 *
 * Voice can arrive two ways (`template.narration.mode`): live during the take, or
 * as dedicated audio-only takes recorded clip-by-clip or across the whole video.
 */
export default function SceneEngine({ template }) {
  const config = template.sceneConfig || {};
  const scenes = useMemo(() => config.scenes || [], [config.scenes]);
  const defaultMix = config.defaultMix || {};
  const narrationConfig = useMemo(
    () => ({ ...DEFAULT_NARRATION, ...(template.narration || {}) }),
    [template.narration],
  );
  const narrationMode = narrationModeById(narrationConfig.mode);
  const captureLiveMic = narrationMode.id === 'live-mic';
  const clipNarration = narrationMode.id === 'clip-narration';
  const fullNarration = narrationMode.id === 'full-narration';
  const totalDuration = scenes.reduce((total, scene) => total + (Number(scene.durationSeconds) || 0), 0);

  const { stream, error: cameraError } = useCamera({ video: true, audio: captureLiveMic });
  const setOutput = useAppStore((s) => s.setOutput);
  const clearOutput = useAppStore((s) => s.clearOutput);

  const liveMic = useLiveMic({ cleanup: narrationConfig.cleanup, stream, enabled: captureLiveMic });
  const narration = useNarration({ cleanup: narrationConfig.cleanup });

  const cameraVideoRef = useRef(null);
  const sceneCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const compileCanvasRef = useRef(null);
  const sceneRecorderRef = useRef(null);
  const sceneRafRef = useRef(null);
  const timelineRafRef = useRef(null);
  const mediaCacheRef = useRef(new Map());
  const narrationCacheRef = useRef(new Map());
  const bgmRef = useRef(null);
  const audioGraphRef = useRef(null);
  const mixRef = useRef({ ...defaultMix });
  const elapsedRef = useRef(0);
  const micLevelRef = useRef(0);

  const [recorded, setRecorded] = useState({}); // sceneId -> { blob, url, durationSeconds, hasAudio }
  const [narrationClips, setNarrationClips] = useState({}); // sceneId -> clip
  const [fullNarrationClip, setFullNarrationClip] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [phase, setPhase] = useState('ready'); // ready | recording | narrating | preview | compiling | done
  const [mixes, setMixes] = useState({ ...defaultMix });
  const [assetMap, setAssetMap] = useState({}); // sceneId -> media element
  const [timeline, setTimeline] = useState({ index: 0, total: scenes.length });
  const [sceneElapsed, setSceneElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [promptPosition, setPromptPosition] = useState('overlay');
  const [meterLevel, setMeterLevel] = useState(0);
  const [prompt, setPrompt] = useState(() => ({
    text: scenePrompt(scenes[0]),
    durationSeconds: scenes[0]?.durationSeconds || 0,
    active: false,
    startedAt: null,
    label: scenes[0] ? 'Clip 1 — read this' : 'Read this',
  }));

  mixRef.current = mixes;

  const hasNarration = Boolean(fullNarrationClip) || Object.keys(narrationClips).length > 0;
  const duckFactor = hasNarration ? Number(narrationConfig.musicDuck ?? DEFAULT_NARRATION.musicDuck) : 1;
  const recordableCount = Object.keys(recorded).length;
  const allRecorded = scenes.length > 0 && scenes.every((scene) => recorded[scene.id]);
  const narrationDone = clipsRecorded(narrationClips, scenes);
  const narrationReady = captureLiveMic || (fullNarration ? Boolean(fullNarrationClip) : narrationDone === scenes.length);
  const canFinish = allRecorded && narrationReady;
  const busy = phase !== 'ready' && phase !== 'done';

  // ---- Camera, canvases, assets ---------------------------------------------
  useEffect(() => {
    attachStream(cameraVideoRef.current, stream);
  }, [stream]);

  useEffect(() => {
    [previewCanvasRef, compileCanvasRef, sceneCanvasRef].forEach((ref) => {
      if (ref.current) {
        ref.current.width = CANVAS_W;
        ref.current.height = CANVAS_H;
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const broll = scenes.filter((scene) => scene.type === 'broll' && scene.assetUrl);
    if (!broll.length) return undefined;
    Promise.all(
      broll.map(async (scene) => {
        const media = createVideoElement(scene.assetUrl, { muted: true, loop: true });
        const ok = await waitForMedia(media);
        if (!ok) console.warn('[SceneEngine] b-roll failed to load', scene.assetUrl);
        return [scene.id, media];
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAssetMap(Object.fromEntries(entries));
      console.log('[SceneEngine] preloaded b-roll assets', entries.length);
    });
    return () => {
      cancelled = true;
    };
  }, [scenes]);

  /**
   * Any change to the audio sources invalidates the Web Audio graph, because a
   * media element can only ever be attached to one MediaElementSourceNode. The
   * graph is rebuilt lazily on the next preview or compile.
   */
  const invalidateAudioGraph = useCallback((reason) => {
    const graph = audioGraphRef.current;
    if (!graph) {
      mediaCacheRef.current.clear();
      narrationCacheRef.current.clear();
      bgmRef.current = null;
      return;
    }
    graph.ctx.close().catch(() => {});
    audioGraphRef.current = null;
    mediaCacheRef.current.forEach((el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    mediaCacheRef.current.clear();
    narrationCacheRef.current.clear();
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.removeAttribute('src');
      bgmRef.current.load();
    }
    bgmRef.current = null;
    console.log('[SceneEngine] audio graph invalidated:', reason);
  }, []);

  useEffect(() => {
    invalidateAudioGraph('narration changed');
  }, [invalidateAudioGraph, narrationClips, fullNarrationClip]);

  // ---- Record a single scene (strict timer, no trimming UI) -----------------
  const recordScene = useCallback(
    async (index) => {
      const scene = scenes[index];
      if (!scene) return;
      setError(null);
      clearOutput();
      // The cleaned microphone must be ready before the stream is assembled.
      const micTracks = captureLiveMic ? await liveMic.ensure() : [];

      setPhase('recording');
      setActiveIndex(index);

      const canvas = sceneCanvasRef.current;
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      const previewCtx = previewCanvasRef.current?.getContext('2d');

      const startedAt = performance.now();
      elapsedRef.current = 0;
      setSceneElapsed(0);
      // The prompt is live for the whole clip, so the talent reads while recording.
      setPrompt({
        text: scenePrompt(scene),
        durationSeconds: Number(scene.durationSeconds) || 0,
        active: true,
        startedAt,
        label: `Clip ${index + 1} of ${scenes.length} — read this`,
      });

      const loop = () => {
        const t = (performance.now() - startedAt) / 1000;
        drawSceneFrame(ctx, scene, t, {
          cameraVideo: cameraVideoRef.current,
          asset: assetMap[scene.id],
        });
        // Mirror the exact recording frame to the visible canvas: the talent has
        // to be able to see themselves, and what they see has to be what ships.
        if (previewCtx) previewCtx.drawImage(canvas, 0, 0, CANVAS_W, CANVAS_H);
        if (Math.abs(t - elapsedRef.current) >= 0.1) {
          elapsedRef.current = t;
          setSceneElapsed(Math.min(t, Number(scene.durationSeconds) || 0));
        }
        sceneRafRef.current = requestAnimationFrame(loop);
      };
      loop();

      const canvasStream = canvas.captureStream(FPS);
      // Live mic mode captures voice across EVERY clip, not just camera ones, so
      // narration over a title card or B-roll is not silently dropped.
      micTracks.forEach((track) => canvasStream.addTrack(track));
      const hasAudio = micTracks.length > 0;

      const mimeType = pickRecorderMimeType();
      let recorder;
      try {
        recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
      } catch (err) {
        console.error('[SceneEngine] MediaRecorder failed', err);
        cancelAnimationFrame(sceneRafRef.current);
        setPrompt((state) => ({ ...state, active: false }));
        setPhase('ready');
        setActiveIndex(-1);
        setError(`Recording is unavailable in this browser: ${err.message}`);
        return;
      }

      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      sceneRecorderRef.current = recorder;
      recorder.start(250);
      console.log(`[SceneEngine] recording scene ${index} for ${scene.durationSeconds}s`, { hasAudio });

      await new Promise((resolve) => setTimeout(resolve, Math.max(200, scene.durationSeconds * 1000)));
      if (recorder.state === 'recording') recorder.stop();
      await stopped;
      cancelAnimationFrame(sceneRafRef.current);

      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecorded((prev) => {
        const previous = prev[scene.id];
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return { ...prev, [scene.id]: { blob, url, durationSeconds: scene.durationSeconds, hasAudio } };
      });
      invalidateAudioGraph(`scene ${index} re-recorded`);
      // Advance the prompt so the next line is already on screen — the loop
      // should never leave the talent staring at a stale script.
      const next = scenes[index + 1];
      if (next) {
        setPrompt({
          text: scenePrompt(next),
          durationSeconds: Number(next.durationSeconds) || 0,
          active: false,
          startedAt: null,
          label: `Clip ${index + 2} of ${scenes.length} — read this`,
        });
      } else {
        setPrompt((state) => ({ ...state, active: false }));
      }
      setPhase('ready');
      setActiveIndex(-1);
      console.log(`[SceneEngine] scene ${index} recorded`, { size: blob.size, hasAudio });
    },
    [assetMap, captureLiveMic, clearOutput, invalidateAudioGraph, liveMic, scenes, stream],
  );

  // ---- Web Audio mixing graph ----------------------------------------------
  const ensureAudioGraph = useCallback(() => {
    if (audioGraphRef.current) return audioGraphRef.current;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const dest = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(dest);
    master.connect(ctx.destination);

    const gains = {};
    mediaCacheRef.current.forEach((el, id) => {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = mixRef.current.voiceVolume ?? 1;
      source.connect(gain);
      gain.connect(master);
      gains[id] = gain;
    });

    const narrationGains = {};
    narrationCacheRef.current.forEach((el, id) => {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(master);
      narrationGains[id] = gain;
    });

    let bgmGain = null;
    const bgm = bgmRef.current;
    if (bgm && config.backgroundMusicUrl) {
      try {
        const source = ctx.createMediaElementSource(bgm);
        bgmGain = ctx.createGain();
        bgmGain.gain.value = (mixRef.current.musicVolume ?? 0.3) * (hasNarration ? duckFactor : 1);
        source.connect(bgmGain);
        bgmGain.connect(master);
      } catch (err) {
        console.warn('[SceneEngine] could not route background music', err);
      }
    }

    audioGraphRef.current = { ctx, dest, master, gains, narrationGains, bgmGain };
    console.log('[SceneEngine] audio graph built', {
      voice: Object.keys(gains).length,
      narration: Object.keys(narrationGains).length,
      bgmGain: Boolean(bgmGain),
      ducking: hasNarration ? duckFactor : null,
    });
    return audioGraphRef.current;
  }, [config.backgroundMusicUrl, duckFactor, hasNarration]);

  // Keep gains in sync with the sliders (and with music ducking under narration).
  useEffect(() => {
    const graph = audioGraphRef.current;
    if (!graph) return;
    Object.values(graph.gains).forEach((gain) => {
      gain.gain.value = mixes.voiceVolume;
    });
    if (graph.bgmGain) graph.bgmGain.gain.value = (mixes.musicVolume ?? 0.3) * duckFactor;
  }, [duckFactor, mixes]);

  const ensureMediaElements = useCallback(() => {
    const cache = mediaCacheRef.current;
    scenes.forEach((scene) => {
      const rec = recorded[scene.id];
      if (!rec || cache.has(scene.id)) return;
      const el = document.createElement('video');
      el.src = rec.url;
      el.playsInline = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      cache.set(scene.id, el);
    });

    const narrationCache = narrationCacheRef.current;
    if (fullNarrationClip && !narrationCache.has('full')) {
      narrationCache.set('full', createAudioElement(fullNarrationClip.url));
    }
    scenes.forEach((scene) => {
      const clip = narrationClips[scene.id];
      if (clip && !narrationCache.has(scene.id)) {
        narrationCache.set(scene.id, createAudioElement(clip.url));
      }
    });

    if (config.backgroundMusicUrl && !bgmRef.current) {
      bgmRef.current = createAudioElement(config.backgroundMusicUrl, { loop: true });
    }

    return { cache, narrationCache };
  }, [config.backgroundMusicUrl, fullNarrationClip, narrationClips, recorded, scenes]);

  // ---- Timeline playback (drives Preview, Compile and narration takes) ------
  const playTimeline = useCallback(
    async (ctx, { from = 0, to = scenes.length - 1, prompt: promptMode = 'none' } = {}) => {
      const { cache, narrationCache } = ensureMediaElements();
      const graph = ensureAudioGraph();
      await graph.ctx.resume();
      const bgm = bgmRef.current;
      if (bgm && config.backgroundMusicUrl) {
        bgm.currentTime = 0;
        bgm.play().catch((err) => console.warn('[SceneEngine] bgm play failed', err));
      }

      // A whole-video narration starts before the first clip and runs across.
      const fullEl = narrationCache.get('full');
      if (fullEl) {
        fullEl.currentTime = 0;
        fullEl.play().catch((err) => console.warn('[SceneEngine] narration play failed', err));
      }
      if (promptMode === 'full') {
        setPrompt({
          text: fullNarrationScript(scenes),
          durationSeconds: totalDuration,
          active: true,
          startedAt: performance.now(),
          label: 'Read the whole script',
        });
      }

      for (let i = from; i <= to; i += 1) {
        const scene = scenes[i];
        const rec = recorded[scene.id];
        const el = cache.get(scene.id);
        if (!rec || !el) continue;
        setTimeline({ index: i, total: scenes.length });
        if (promptMode === 'per-scene') {
          setPrompt({
            text: scenePrompt(scene),
            durationSeconds: rec.durationSeconds || scene.durationSeconds,
            active: true,
            startedAt: performance.now(),
            label: `Clip ${i + 1} of ${scenes.length} — read this`,
          });
        }
        // A per-clip narration rides on its own scene's offset.
        const segment = narrationCache.get(scene.id);
        if (segment) {
          segment.currentTime = 0;
          segment.play().catch((err) => console.warn('[SceneEngine] clip narration play failed', err));
        }
        console.log(`[SceneEngine] timeline scene ${i} (${scene.type})`);
        el.currentTime = 0;
        try {
          await el.play();
        } catch (err) {
          console.warn('[SceneEngine] scene playback failed', err);
        }
        const dur = rec.durationSeconds || scene.durationSeconds;
        await new Promise((resolve) => {
          const startedAt = performance.now();
          const step = () => {
            const t = (performance.now() - startedAt) / 1000;
            if (el.readyState >= 2) drawCover(ctx, el, 0, 0, CANVAS_W, CANVAS_H);
            if (t >= dur || el.ended) {
              el.pause();
              resolve();
            } else {
              timelineRafRef.current = requestAnimationFrame(step);
            }
          };
          step();
        });
      }

      if (bgm) bgm.pause();
      if (fullEl) fullEl.pause();
      narrationCache.forEach((el, id) => {
        if (id !== 'full') el.pause();
      });
      setPrompt((state) => ({ ...state, active: false }));
    },
    [config.backgroundMusicUrl, ensureAudioGraph, ensureMediaElements, recorded, scenes, totalDuration],
  );

  // ---- Dedicated audio-only narration takes --------------------------------
  const recordClipNarration = useCallback(
    async (index) => {
      const scene = scenes[index];
      if (!scene || !recorded[scene.id]) return;
      setError(null);
      const take = await narration.beginTake({ label: `clip-${index + 1}` });
      if (!take) return;
      setPhase('narrating');
      const canvas = previewCanvasRef.current;
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      try {
        await playTimeline(canvas.getContext('2d'), { from: index, to: index, prompt: 'per-scene' });
      } finally {
        const clip = await take.stop();
        if (clip) {
          setNarrationClips((prev) => {
            const previous = prev[scene.id];
            if (previous?.url) URL.revokeObjectURL(previous.url);
            return { ...prev, [scene.id]: clip };
          });
          console.log('[SceneEngine] clip narration captured', { index, seconds: clip.durationSeconds });
        } else {
          setError('That narration take captured nothing — check the microphone and try again.');
        }
        setPhase('ready');
      }
    },
    [narration, playTimeline, recorded, scenes],
  );

  const recordFullNarration = useCallback(async () => {
    if (!allRecorded) return;
    setError(null);
    const take = await narration.beginTake({ label: 'narration' });
    if (!take) return;
    setPhase('narrating');
    const canvas = previewCanvasRef.current;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    try {
      await playTimeline(canvas.getContext('2d'), { prompt: 'full' });
    } finally {
      const clip = await take.stop();
      if (clip) {
        setFullNarrationClip((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return clip;
        });
        console.log('[SceneEngine] whole-video narration captured', { seconds: clip.durationSeconds });
      } else {
        setError('That narration take captured nothing — check the microphone and try again.');
      }
      setPhase('ready');
    }
  }, [allRecorded, narration, playTimeline]);

  // Mic level for the meter: live-mic mode meters the processed camera stream,
  // dedicated narration takes meter their own processed signal.
  useEffect(() => {
    if (!captureLiveMic || phase === 'ready' || phase === 'done') {
      setMeterLevel(0);
      return undefined;
    }
    let raf;
    const tick = () => {
      const bucket = Math.round(readLevel(liveMic.analyser()) * 20) / 20;
      if (bucket !== micLevelRef.current) {
        micLevelRef.current = bucket;
        setMeterLevel(bucket);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [captureLiveMic, liveMic, phase]);

  const meter = captureLiveMic ? meterLevel : narration.level;

  // ---- Preview and compile -------------------------------------------------
  const runPreview = useCallback(async () => {
    if (!canFinish) return;
    setError(null);
    setPhase('preview');
    const canvas = previewCanvasRef.current;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    await playTimeline(canvas.getContext('2d'));
    setPhase('ready');
  }, [canFinish, playTimeline]);

  const runCompile = useCallback(async () => {
    if (!canFinish) return;
    setError(null);
    clearOutput();
    setPhase('compiling');
    const canvas = compileCanvasRef.current;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    ensureMediaElements();
    const graph = ensureAudioGraph();
    const canvasStream = canvas.captureStream(FPS);
    graph.dest.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));

    const mimeType = pickRecorderMimeType();
    const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start(250);
    console.log('[SceneEngine] compiling stitched timeline', { narrationMode: narrationMode.id });

    await playTimeline(canvas.getContext('2d'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (recorder.state === 'recording') recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    console.log('[SceneEngine] compile complete', { size: blob.size, narrationMode: narrationMode.id });
    setOutput({
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      mimeType: mimeType || 'video/webm',
      name: buildFileName('scene', mimeType),
      mode: 'scene',
    });
    setPhase('done');
  }, [canFinish, clearOutput, ensureAudioGraph, ensureMediaElements, narrationMode.id, playTimeline, setOutput]);

  // ---- Cleanup --------------------------------------------------------------
  useEffect(
    () => () => {
      cancelAnimationFrame(sceneRafRef.current);
      cancelAnimationFrame(timelineRafRef.current);
      if (sceneRecorderRef.current?.state === 'recording') sceneRecorderRef.current.stop();
      mediaCacheRef.current.forEach((el) => {
        el.pause();
        el.removeAttribute('src');
        el.load();
      });
      mediaCacheRef.current.clear();
      narrationCacheRef.current.clear();
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.removeAttribute('src');
        bgmRef.current.load();
      }
      if (audioGraphRef.current) {
        audioGraphRef.current.ctx.close().catch(() => {});
        audioGraphRef.current = null;
      }
      console.log('[SceneEngine] cleaned up media + audio');
    },
    [],
  );

  const remaining = Math.max(0, (scenes[activeIndex]?.durationSeconds || 0) - sceneElapsed);

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Scene checklist</h2>
        <p>
          {recordableCount}/{scenes.length} scenes recorded.
          {captureLiveMic ? ' Voice is captured with each clip.' : ` Narration: ${narrationProgress(narrationClips, scenes, fullNarrationClip, fullNarration)}.`}
        </p>
        {cameraError ? <p className="error">{cameraError}</p> : null}
        {narration.error ? (
          <p className="error" data-testid="narration-error">
            {narration.error}
          </p>
        ) : null}
        {error ? (
          <p className="error" data-testid="record-error">
            {error}
          </p>
        ) : null}
        <div data-testid="scene-list">
          {scenes.map((scene, i) => (
            <div key={scene.id} className={`scene-row ${recorded[scene.id] ? 'done' : ''}`}>
              <span className="idx">{i + 1}</span>
              <div className="grow">
                <strong data-testid={`scene-type-${i}`}>{scene.type}</strong>
                <div className="status">
                  {scene.durationSeconds}s
                  {scenePrompt(scene) ? ` — read: “${scenePrompt(scene)}”` : ''}
                  {scene.text ? ` — on screen: "${scene.text}"` : ''}
                </div>
                {clipNarration ? (
                  <div className="status" data-testid={`scene-narration-status-${i}`}>
                    {narrationClips[scene.id]
                      ? `Narration ${narrationClips[scene.id].durationSeconds.toFixed(1)}s`
                      : 'Narration pending'}
                  </div>
                ) : null}
              </div>
              <span className="status" data-testid={`scene-status-${i}`}>
                {recorded[scene.id] ? 'Recorded' : activeIndex === i ? 'Recording…' : 'Pending'}
              </span>
              <button
                type="button"
                className="secondary"
                data-testid={`scene-record-${i}`}
                disabled={busy}
                onClick={() => recordScene(i)}
              >
                {recorded[scene.id] ? 'Re-record' : 'Record'}
              </button>
              {clipNarration ? (
                <button
                  type="button"
                  className="secondary"
                  data-testid={`scene-narrate-${i}`}
                  disabled={busy || !recorded[scene.id]}
                  onClick={() => recordClipNarration(i)}
                >
                  {narrationClips[scene.id] ? 'Re-narrate' : 'Narrate'}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {fullNarration ? (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              data-testid="narration-full"
              disabled={busy || !allRecorded}
              onClick={recordFullNarration}
            >
              {fullNarrationClip ? 'Re-record the narration' : 'Record the whole narration'}
            </button>
            <span className="asset-meta" data-testid="narration-full-status">
              {fullNarrationClip ? `${fullNarrationClip.durationSeconds.toFixed(1)}s captured` : 'Not recorded yet'}
            </span>
          </div>
        ) : null}

        <p className="status" data-testid="scene-phase">
          {phase === 'recording'
            ? `Recording scene ${activeIndex + 1}…`
            : phase === 'narrating'
              ? `Narrating scene ${timeline.index + 1}/${timeline.total}…`
              : phase === 'compiling'
                ? `Compiling scene ${timeline.index + 1}/${timeline.total}…`
                : phase === 'preview'
                  ? `Previewing scene ${timeline.index + 1}/${timeline.total}…`
                  : phase === 'done'
                    ? 'Compiled.'
                    : 'Ready.'}
        </p>
        <div className="row">
          <button type="button" data-testid="scene-preview" disabled={!canFinish || busy} onClick={runPreview}>
            Preview stitched
          </button>
          <button type="button" data-testid="scene-compile" disabled={!canFinish || busy} onClick={runCompile}>
            Compile video
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Live preview</h2>
        <div className="prompt-stage">
          <canvas ref={previewCanvasRef} className="preview" data-testid="scene-preview-canvas" />
          <Teleprompter
            text={prompt.text}
            durationSeconds={prompt.durationSeconds}
            active={prompt.active}
            startedAt={prompt.startedAt}
            position={promptPosition}
            onPositionChange={setPromptPosition}
            label={prompt.label}
          />
          {phase === 'recording' ? (
            <div className="take-hud" data-testid="scene-hud">
              <span data-testid="scene-countdown">● REC · {remaining.toFixed(1)}s left</span>
            </div>
          ) : null}
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <span className="asset-meta">{captureLiveMic ? 'Mic' : 'Narration'}</span>
          <div className="level-meter" data-testid="mic-meter" data-level={meter}>
            <div className="level-fill" style={{ width: `${Math.round(meter * 100)}%` }} />
          </div>
          <span className="asset-meta" data-testid="narration-mode-label">
            {narrationMode.label}
          </span>
        </div>
        {!captureLiveMic ? (
          <p className="status" data-testid="narration-status">
            {fullNarration
              ? fullNarrationClip
                ? `Whole-video narration ready (${fullNarrationClip.durationSeconds.toFixed(1)}s).`
                : 'Record the narration after every clip is done — the timeline plays back while you read.'
              : narrationDone === scenes.length
                ? 'Every clip has narration.'
                : `${narrationDone}/${scenes.length} clips narrated.`}
          </p>
        ) : null}

        <h3 style={{ marginTop: 18 }}>Audio mix</h3>
        <div className="slider-row">
          <label htmlFor="voiceVolume">Voice</label>
          <input
            id="voiceVolume"
            data-testid="mix-voice"
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={mixes.voiceVolume}
            onChange={(e) => setMixes((m) => ({ ...m, voiceVolume: Number(e.target.value) }))}
          />
          <span className="val">{Number(mixes.voiceVolume).toFixed(2)}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="musicVolume">Music</label>
          <input
            id="musicVolume"
            data-testid="mix-music"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={mixes.musicVolume}
            onChange={(e) => setMixes((m) => ({ ...m, musicVolume: Number(e.target.value) }))}
          />
          <span className="val">{Number(mixes.musicVolume).toFixed(2)}</span>
        </div>
        <div className="slider-row">
          <label htmlFor="brollOriginalAudio">B-roll audio</label>
          <input
            id="brollOriginalAudio"
            data-testid="mix-broll"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={mixes.brollOriginalAudio}
            onChange={(e) => setMixes((m) => ({ ...m, brollOriginalAudio: Number(e.target.value) }))}
          />
          <span className="val">{Number(mixes.brollOriginalAudio).toFixed(2)}</span>
        </div>
        {hasNarration ? (
          <p className="asset-meta" data-testid="duck-note">
            Music ducked to {Math.round(duckFactor * 100)}% under narration.
          </p>
        ) : null}
      </section>

      {/* Offscreen canvases: scene capture + the hidden 1:1 compiler. */}
      <canvas ref={sceneCanvasRef} className="hidden-compiler" />
      <canvas ref={compileCanvasRef} className="hidden-compiler" data-testid="compile-canvas" />
      <video ref={cameraVideoRef} muted playsInline style={{ display: 'none' }} />
    </div>
  );
}

function clipsRecorded(narrationClips, scenes) {
  return scenes.filter((scene) => narrationClips[scene.id]).length;
}

function narrationProgress(narrationClips, scenes, fullClip, isFull) {
  if (isFull) return fullClip ? 'whole video captured' : 'none yet';
  return `${clipsRecorded(narrationClips, scenes)}/${scenes.length} clips`;
}
