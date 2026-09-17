import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera, attachStream } from '../../hooks/useCamera.js';
import { useAppStore } from '../../store/useAppStore.js';
import {
  drawCover,
  formatSeconds,
  pickRecorderMimeType,
  buildFileName,
  waitForMedia,
  wrapText,
  createVideoElement,
} from '../../lib/mediaUtils.js';

const CANVAS_W = 720;
const CANVAS_H = 1280;
const FPS = 30;

/** Render one scene's frame at time `t` (seconds since the scene began). */
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
    if (scene.instructions) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, CANVAS_W, 180);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 40px Arial, sans-serif';
      ctx.textBaseline = 'top';
      const lines = wrapText(ctx, scene.instructions, CANVAS_W - 80);
      lines.forEach((line, i) => ctx.fillText(line, 40, 36 + i * 52));
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
    const fade = Math.min(1, t / 0.6);
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 64px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapText(ctx, scene.text || '', CANVAS_W - 120);
    const startY = CANVAS_H / 2 - ((lines.length - 1) * 76) / 2;
    lines.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, startY + i * 76));
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // Subtle countdown so strict timers are obvious on screen.
  const remaining = Math.max(0, (scene.durationSeconds || 0) - t);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 30px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(remaining.toFixed(1), CANVAS_W - 28, CANVAS_H - 28);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/**
 * Engine B — Scene-by-scene mode (PRD 2.2).
 *
 * 1. Each scene is recorded for exactly its `durationSeconds` -> Blob URL.
 * 2. Audio is mixed with a Web Audio graph (voice / music / B-roll) using GainNodes.
 * 3. "Preview" replays the stitched timeline on the visible canvas.
 * 4. "Compile" forks the exact same loop onto a hidden 1:1 canvas piped to
 *    MediaRecorder, producing a single file with the mixed audio.
 */
export default function SceneEngine({ template }) {
  const config = template.sceneConfig || {};
  const scenes = config.scenes || [];
  const defaultMix = config.defaultMix || {};

  const { stream, error: cameraError } = useCamera({ video: true, audio: true });
  const setOutput = useAppStore((s) => s.setOutput);
  const clearOutput = useAppStore((s) => s.clearOutput);

  const cameraVideoRef = useRef(null);
  const sceneCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const compileCanvasRef = useRef(null);
  const sceneRecorderRef = useRef(null);
  const sceneRafRef = useRef(null);
  const timelineRafRef = useRef(null);
  const mediaCacheRef = useRef(new Map());
  const audioGraphRef = useRef(null);
  const bgmRef = useRef(null);
  const mixRef = useRef({ ...defaultMix });

  const [recorded, setRecorded] = useState({}); // sceneId -> { blob, url, durationSeconds, hasAudio }
  const [activeIndex, setActiveIndex] = useState(-1);
  const [phase, setPhase] = useState('ready'); // ready | recording | preview | compiling | done
  const [mixes, setMixes] = useState({ ...defaultMix });
  const [assetMap, setAssetMap] = useState({}); // sceneId -> media element
  const [timeline, setTimeline] = useState({ index: 0, total: scenes.length });
  const [error, setError] = useState(null);

  mixRef.current = mixes;
  const allRecorded = scenes.length > 0 && scenes.every((s) => recorded[s.id]);
  const recordableCount = Object.keys(recorded).length;

  // ---- Camera + canvases ----------------------------------------------------
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

  // ---- Preload B-roll assets referenced by scenes ---------------------------
  useEffect(() => {
    let cancelled = false;
    const broll = scenes.filter((s) => s.type === 'broll' && s.assetUrl);
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

  // ---- Record a single scene (strict timer, no trimming UI) -----------------
  const recordScene = useCallback(
    async (index) => {
      const scene = scenes[index];
      if (!scene) return;
      setError(null);
      clearOutput();
      setPhase('recording');
      setActiveIndex(index);

      const canvas = sceneCanvasRef.current;
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');

      const startedAt = performance.now();
      const loop = () => {
        const t = (performance.now() - startedAt) / 1000;
        drawSceneFrame(ctx, scene, t, {
          cameraVideo: cameraVideoRef.current,
          asset: assetMap[scene.id],
        });
        sceneRafRef.current = requestAnimationFrame(loop);
      };
      loop();

      const canvasStream = canvas.captureStream(FPS);
      let hasAudio = false;
      if (scene.type === 'camera' && stream) {
        stream.getAudioTracks().forEach((track) => {
          canvasStream.addTrack(track);
          hasAudio = true;
        });
      }

      const mimeType = pickRecorderMimeType();
      let recorder;
      try {
        recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
      } catch (err) {
        console.error('[SceneEngine] MediaRecorder failed', err);
        cancelAnimationFrame(sceneRafRef.current);
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
      console.log(`[SceneEngine] recording scene ${index} for ${scene.durationSeconds}s`);

      await new Promise((resolve) => setTimeout(resolve, Math.max(200, scene.durationSeconds * 1000)));
      if (recorder.state === 'recording') recorder.stop();
      await stopped;
      cancelAnimationFrame(sceneRafRef.current);

      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecorded((prev) => {
        const previous = prev[scene.id];
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return {
          ...prev,
          [scene.id]: { blob, url, durationSeconds: scene.durationSeconds, hasAudio },
        };
      });
      // Media cache must be rebuilt because the source URL changed.
      const cached = mediaCacheRef.current.get(scene.id);
      if (cached) {
        cached.pause();
        mediaCacheRef.current.delete(scene.id);
      }
      setPhase('ready');
      setActiveIndex(-1);
      console.log(`[SceneEngine] scene ${index} recorded`, { size: blob.size, hasAudio });
    },
    [assetMap, clearOutput, scenes, stream],
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

    let bgmGain = null;
    const bgm = bgmRef.current;
    if (bgm && config.backgroundMusicUrl) {
      try {
        const source = ctx.createMediaElementSource(bgm);
        bgmGain = ctx.createGain();
        bgmGain.gain.value = mixRef.current.musicVolume ?? 0.3;
        source.connect(bgmGain);
        bgmGain.connect(master);
      } catch (err) {
        console.warn('[SceneEngine] could not route background music', err);
      }
    }

    audioGraphRef.current = { ctx, dest, master, gains, bgmGain };
    console.log('[SceneEngine] audio graph built', { nodes: Object.keys(gains).length, bgmGain: Boolean(bgmGain) });
    return audioGraphRef.current;
  }, [config.backgroundMusicUrl]);

  // Keep gains in sync with the sliders.
  useEffect(() => {
    const graph = audioGraphRef.current;
    if (!graph) return;
    Object.values(graph.gains).forEach((gain) => {
      gain.gain.value = mixes.voiceVolume;
    });
    if (graph.bgmGain) graph.bgmGain.gain.value = mixes.musicVolume;
  }, [mixes]);

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
    return cache;
  }, [recorded, scenes]);

  // ---- Timeline playback (used by both Preview and Compile) ----------------
  const playTimeline = useCallback(
    async (ctx) => {
      const elements = ensureMediaElements();
      const graph = ensureAudioGraph();
      await graph.ctx.resume();
      if (bgmRef.current && config.backgroundMusicUrl) {
        bgmRef.current.currentTime = 0;
        bgmRef.current.play().catch((err) => console.warn('[SceneEngine] bgm play failed', err));
      }

      for (let i = 0; i < scenes.length; i += 1) {
        const scene = scenes[i];
        const rec = recorded[scene.id];
        const el = elements.get(scene.id);
        if (!rec || !el) continue;
        setTimeline({ index: i, total: scenes.length });
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
      if (bgmRef.current) bgmRef.current.pause();
    },
    [config.backgroundMusicUrl, ensureAudioGraph, ensureMediaElements, recorded, scenes],
  );

  const runPreview = useCallback(async () => {
    if (!allRecorded) return;
    setError(null);
    setPhase('preview');
    const canvas = previewCanvasRef.current;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    await playTimeline(canvas.getContext('2d'));
    setPhase('ready');
  }, [allRecorded, playTimeline]);

  const runCompile = useCallback(async () => {
    if (!allRecorded) return;
    setError(null);
    clearOutput();
    setPhase('compiling');
    const canvas = compileCanvasRef.current;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const elements = ensureMediaElements();
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
    console.log('[SceneEngine] compiling stitched timeline');

    await playTimeline(canvas.getContext('2d'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (recorder.state === 'recording') recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    console.log('[SceneEngine] compile complete', { size: blob.size, elements: elements.size });
    setOutput({
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      mimeType: mimeType || 'video/webm',
      name: buildFileName('scene', mimeType),
      mode: 'scene',
    });
    setPhase('done');
  }, [allRecorded, clearOutput, ensureAudioGraph, ensureMediaElements, playTimeline, setOutput]);

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
      if (audioGraphRef.current) {
        audioGraphRef.current.ctx.close().catch(() => {});
        audioGraphRef.current = null;
      }
      console.log('[SceneEngine] cleaned up media + audio');
    },
    [],
  );

  const busy = phase === 'recording' || phase === 'compiling';

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Scene checklist</h2>
        <p>
          {recordableCount}/{scenes.length} scenes recorded.
        </p>
        {cameraError ? <p className="error">{cameraError}</p> : null}
        {error ? <p className="error" data-testid="record-error">{error}</p> : null}
        <div data-testid="scene-list">
          {scenes.map((scene, i) => (
            <div key={scene.id} className={`scene-row ${recorded[scene.id] ? 'done' : ''}`}>
              <span className="idx">{i + 1}</span>
              <div className="grow">
                <strong data-testid={`scene-type-${i}`}>{scene.type}</strong>
                <div className="status">
                  {scene.durationSeconds}s
                  {scene.instructions ? ` — ${scene.instructions}` : ''}
                  {scene.text ? ` — "${scene.text}"` : ''}
                </div>
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
            </div>
          ))}
        </div>
        <p className="status" data-testid="scene-phase">
          {phase === 'recording'
            ? `Recording scene ${activeIndex + 1}…`
            : phase === 'compiling'
              ? `Compiling scene ${timeline.index + 1}/${timeline.total}…`
              : phase === 'preview'
                ? `Previewing scene ${timeline.index + 1}/${timeline.total}…`
                : phase === 'done'
                  ? 'Compiled.'
                  : 'Ready.'}
        </p>
        <div className="row">
          <button type="button" data-testid="scene-preview" disabled={!allRecorded || busy} onClick={runPreview}>
            Preview stitched
          </button>
          <button type="button" data-testid="scene-compile" disabled={!allRecorded || busy} onClick={runCompile}>
            Compile video
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Live preview</h2>
        <canvas ref={previewCanvasRef} className="preview" data-testid="scene-preview-canvas" />

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
      </section>

      {/* Offscreen canvases: scene capture + the hidden 1:1 compiler. */}
      <canvas ref={sceneCanvasRef} className="hidden-compiler" />
      <canvas ref={compileCanvasRef} className="hidden-compiler" data-testid="compile-canvas" />
      <video ref={cameraVideoRef} muted playsInline style={{ display: 'none' }} />
      {config.backgroundMusicUrl ? (
        <audio ref={bgmRef} src={config.backgroundMusicUrl} loop crossOrigin="anonymous" preload="auto" />
      ) : null}
    </div>
  );
}
