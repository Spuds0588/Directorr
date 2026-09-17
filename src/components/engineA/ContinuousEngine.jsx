import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera, attachStream } from '../../hooks/useCamera.js';
import { useAppStore } from '../../store/useAppStore.js';
import {
  drawCover,
  formatSeconds,
  pickRecorderMimeType,
  buildFileName,
  waitForMedia,
  createImageElement,
  createVideoElement,
} from '../../lib/mediaUtils.js';
import { drawTeleprompter } from '../../lib/teleprompter.js';
import { DEFAULT_NARRATION, narrationModeById } from '../../lib/templateSchema.js';
import { createVoiceProcessor, readLevel } from '../../lib/audioCleanup.js';
import Teleprompter from '../Teleprompter.jsx';

const CANVAS_W = 720;
const CANVAS_H = 1280;
const WEBCAM_H = 640;      // top third: webcam
const ASSET_Y = 980;       // bottom track region starts here
const FPS = 30;

/**
 * Engine A — Continuous mode (PRD 2.2).
 *
 * A single requestAnimationFrame loop composites, every frame:
 *   TOP   -> live webcam (cover-fit)
 *   MID   -> scrolling teleprompter / captions
 *   BOT   -> timed B-roll assets active at the current second
 *
 * The same loop paints both the on-screen preview and the canvas piped into
 * MediaRecorder, so what the user watches is byte-for-byte what is recorded.
 * Recording auto-stops at `durationSeconds` (strict timeline, no trimming UI).
 */
export default function ContinuousEngine({ template }) {
  const config = template.continuousConfig || {};
  const theme = config.theme || {};
  const duration = Number(template.durationSeconds) || 30;
  const narration = { ...DEFAULT_NARRATION, ...(template.narration || {}) };
  const narrationMode = narrationModeById(narration.mode);
  // Mode A has no replay path, so the microphone is always captured with the
  // picture: the scrolling script IS the narration prompt. Creators can still
  // choose whether that script ends up in the published video.
  const showScriptInOutput = config.showScriptInOutput !== false;

  const { stream, error: cameraError } = useCamera({ video: true, audio: true });
  const setOutput = useAppStore((s) => s.setOutput);
  const clearOutput = useAppStore((s) => s.clearOutput);

  const canvasRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const assetsRef = useRef([]);
  const startTimeRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const elapsedRef = useRef(0);
  const micRef = useRef(null);
  const micLevelRef = useRef(0);

  const [phase, setPhase] = useState('idle'); // idle | recording | done
  const [elapsed, setElapsed] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [error, setError] = useState(null);
  const [takeStartedAt, setTakeStartedAt] = useState(null);
  const [micLevel, setMicLevel] = useState(0);

  // ---- Camera binding -------------------------------------------------------
  useEffect(() => {
    attachStream(cameraVideoRef.current, stream);
  }, [stream]);

  // ---- Asset preloading (must finish before recording starts) ---------------
  useEffect(() => {
    let cancelled = false;
    const track = Array.isArray(config.bottomTrack) ? config.bottomTrack : [];
    if (!track.length) {
      setAssetsReady(true);
      return undefined;
    }
    Promise.all(
      track.map(async (item) => {
        const isImage = item.type === 'image';
        const media = isImage ? createImageElement(item.url) : createVideoElement(item.url, { muted: true, loop: true });
        const ok = await waitForMedia(media);
        if (!ok) console.warn('[ContinuousEngine] asset failed to load', item.url);
        return { ...item, media, ok };
      }),
    ).then((loaded) => {
      if (cancelled) return;
      assetsRef.current = loaded;
      setAssetsReady(true);
      console.log('[ContinuousEngine] preloaded assets', loaded.length);
    });
    return () => {
      cancelled = true;
    };
  }, [config.bottomTrack]);

  // ---- The single frame renderer -------------------------------------------
  const renderFrame = useCallback(
    (ctx, t) => {
      const bg = theme.backgroundColor || '#1A1A2E';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // TOP: webcam
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, CANVAS_W, WEBCAM_H);
      ctx.clip();
      const camVideo = cameraVideoRef.current;
      if (camVideo && camVideo.readyState >= 2) {
        drawCover(ctx, camVideo, 0, 0, CANVAS_W, WEBCAM_H);
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CANVAS_W, WEBCAM_H);
      }
      ctx.restore();

      // BOT: timed assets
      const activeAsset = assetsRef.current.find((a) => t >= a.startTime && t < a.endTime);
      if (activeAsset) {
        console.log(`[ContinuousEngine] Drawing B-roll frame at sec ${t.toFixed(1)}`);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, ASSET_Y, CANVAS_W, CANVAS_H - ASSET_Y);
        ctx.clip();
        drawCover(ctx, activeAsset.media, 0, ASSET_Y, CANVAS_W, CANVAS_H - ASSET_Y);
        ctx.restore();
      }

      // MID: caption band. Left empty when the creator wants the script to be a
      // talent-only prompt — the canvas is what the audience gets, always.
      const progress = duration > 0 ? Math.min(1, t / duration) : 0;
      if (showScriptInOutput) {
        drawTeleprompter(ctx, {
          text: config.script || '',
          rect: { x: 0, y: WEBCAM_H, width: CANVAS_W, height: ASSET_Y - WEBCAM_H },
          progress,
          // Only the text styling carries over; the caption band keeps its own
          // translucent fill, and `guide: false` keeps captions looking like
          // captions rather than a teleprompter.
          theme: { font: theme.font, fontSize: theme.fontSize, textColor: theme.textColor },
          guide: false,
        });
      }

      // Progress bar along the very bottom edge.
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(0, CANVAS_H - 8, CANVAS_W, 8);
      ctx.fillStyle = theme.textColor || '#FFFFFF';
      ctx.fillRect(0, CANVAS_H - 8, CANVAS_W * progress, 8);
    },
    [config.script, showScriptInOutput, theme.backgroundColor, theme.font, theme.fontSize, theme.textColor, duration],
  );

  // ---- Persistent render loop ----------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let rafId;

    const loop = () => {
      const startedAt = startTimeRef.current;
      let t = 0;
      if (startedAt) {
        t = (performance.now() - startedAt) / 1000;
      }
      renderFrame(ctx, t);

      if (startedAt) {
        const clamped = Math.min(t, duration);
        if (Math.abs(clamped - elapsedRef.current) >= 0.1) {
          elapsedRef.current = clamped;
          setElapsed(clamped);
        }
        // Input meter, sampled on the loop we already run. Bucketed so a quiet
        // room does not re-render 60 times a second.
        const bucket = Math.round(readLevel(micRef.current?.analyser) * 20) / 20;
        if (bucket !== micLevelRef.current) {
          micLevelRef.current = bucket;
          setMicLevel(bucket);
        }
        if (t >= duration && recorderRef.current?.state === 'recording') {
          console.log('[ContinuousEngine] duration reached — auto-stopping');
          recorderRef.current.stop();
          startTimeRef.current = null;
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [renderFrame, duration]);

  // ---- Recording ------------------------------------------------------------
  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      startTimeRef.current = null;
    }
  }, []);

  /**
   * Route the microphone through the cleanup chain and hand back the processed
   * track. Without this the browser's suppressor is all you get and the take's
   * level is whatever the talent's distance happened to be.
   */
  const openCleanedMic = useCallback(async () => {
    if (!stream || !stream.getAudioTracks().length) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = createVoiceProcessor(ctx, source, narration.cleanup);
    const destination = ctx.createMediaStreamDestination();
    processor.output.connect(destination);
    console.log('[ContinuousEngine] voice cleanup ready', processor.describe());
    return { ctx, source, processor, destination, tracks: destination.stream.getAudioTracks() };
  }, [narration.cleanup, stream]);

  const closeCleanedMic = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    if (!mic) return;
    mic.processor.dispose();
    try {
      await mic.ctx.close();
    } catch (err) {
      console.warn('[ContinuousEngine] mic context close', err);
    }
  }, []);

  const startRecording = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!assetsReady) {
      setError('Assets are still loading — try again in a moment.');
      return;
    }
    setError(null);
    clearOutput();

    let mic = null;
    try {
      mic = await openCleanedMic();
    } catch (err) {
      console.error('[ContinuousEngine] could not open the cleaned mic', err);
      setError(`Microphone setup failed: ${err.message}`);
      return;
    }
    micRef.current = mic;

    const canvasStream = canvas.captureStream(FPS);
    if (mic) {
      mic.tracks.forEach((track) => canvasStream.addTrack(track));
    }

    const mimeType = pickRecorderMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      console.error('[ContinuousEngine] MediaRecorder failed', err);
      setError(`Recording is unavailable in this browser: ${err.message}`);
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const finalType = mimeType || chunksRef.current[0]?.type || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: finalType });
      console.log('[ContinuousEngine] recording stopped', { size: blob.size, type: finalType });
      await closeCleanedMic();
      setMicLevel(0);
      micLevelRef.current = 0;
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
        mimeType: finalType,
        name: buildFileName('continuous', finalType),
        mode: 'continuous',
      });
      setPhase('done');
      setTakeStartedAt(null);
    };

    recorderRef.current = recorder;
    chunksRef.current = [];
    const startedAt = performance.now();
    startTimeRef.current = startedAt;
    elapsedRef.current = 0;
    setElapsed(0);
    setTakeStartedAt(startedAt);
    setPhase('recording');
    recorder.start(1000);
    console.log('[ContinuousEngine] recording started', {
      duration,
      mimeType,
      narrationMode: narrationMode.id,
      voiceCleanup: mic ? mic.processor.describe() : null,
    });
  }, [assetsReady, clearOutput, closeCleanedMic, duration, narration.cleanup, narrationMode.id, openCleanedMic, setOutput]);

  // Cleanup any live recorder and microphone graph on unmount.
  useEffect(
    () => () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      closeCleanedMic();
    },
    [closeCleanedMic],
  );

  const progressPct = Math.min(100, (elapsed / duration) * 100);

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Continuous take</h2>
        <p>{config.script ? 'Read the scrolling script on screen.' : 'No script provided for this template.'}</p>
        <div className="prompt-stage">
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="preview" data-testid="record-preview-canvas" />
          {!showScriptInOutput ? (
            <Teleprompter
              text={config.script}
              durationSeconds={duration}
              active={phase === 'recording'}
              startedAt={takeStartedAt}
              theme={theme}
              label="Read this — live prompt"
            />
          ) : null}
        </div>
        <video ref={cameraVideoRef} muted playsInline style={{ display: 'none' }} />
        {cameraError ? <p className="error" data-testid="camera-error">{cameraError}</p> : null}
        {error ? <p className="error" data-testid="record-error">{error}</p> : null}
        <p className="status" data-testid="record-status">
          {phase === 'recording'
            ? `Recording ${formatSeconds(elapsed)} / ${formatSeconds(duration)}`
            : phase === 'done'
              ? 'Take complete.'
              : assetsReady
                ? `Ready — ${formatSeconds(duration)} one-take`
                : 'Loading assets…'}
        </p>
        <div className="row">
          <span className="asset-meta">Mic</span>
          <div className="level-meter" data-testid="mic-meter" data-level={micLevel}>
            <div className="level-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <span className="asset-meta">{narrationMode.label}</span>
        </div>
        {showScriptInOutput ? (
          <p className="asset-meta" data-testid="script-band-note">
            The script is part of the composite as a caption band.
          </p>
        ) : null}
        <div className="row">
          <button
            type="button"
            data-testid="record-start"
            onClick={startRecording}
            disabled={phase === 'recording' || !assetsReady}
          >
            Start take
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="record-stop"
            onClick={stopRecording}
            disabled={phase !== 'recording'}
          >
            Stop early
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Timeline</h2>
        <p className="status">
          {formatSeconds(elapsed)} / {formatSeconds(duration)} ({progressPct.toFixed(0)}%)
        </p>
        <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden', margin: '10px 0 18px' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--accent-2)' }} />
        </div>
        <h3>Bottom track</h3>
        {(config.bottomTrack || []).length ? (
          <ul className="steps">
            {config.bottomTrack.map((item, i) => (
              <li key={i}>
                {item.type} @ {item.startTime}s–{item.endTime}s
              </li>
            ))}
          </ul>
        ) : (
          <p>No timed assets for this template.</p>
        )}
      </section>
    </div>
  );
}
