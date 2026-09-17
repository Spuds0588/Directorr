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
  createImageElement,
  createVideoElement,
} from '../../lib/mediaUtils.js';

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

  const [phase, setPhase] = useState('idle'); // idle | recording | done
  const [elapsed, setElapsed] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [error, setError] = useState(null);

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

      // MID: teleprompter / captions
      const midTop = WEBCAM_H;
      const midH = ASSET_Y - WEBCAM_H;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, midTop, CANVAS_W, midH);

      const fontSize = Number(theme.fontSize) || 44;
      ctx.fillStyle = theme.textColor || '#FFFFFF';
      ctx.font = `600 ${fontSize}px ${theme.font || 'Arial'}, sans-serif`;
      ctx.textBaseline = 'top';

      const padding = 40;
      const lines = wrapText(ctx, config.script || '', CANVAS_W - padding * 2);
      const lineHeight = fontSize * 1.35;
      const viewH = midH - 48;
      const totalH = lines.length * lineHeight;
      const maxScroll = Math.max(0, totalH - viewH);
      const progress = duration > 0 ? Math.min(1, t / duration) : 0;
      const offsetY = midTop + 24 - progress * maxScroll;

      lines.forEach((line, i) => {
        const y = offsetY + i * lineHeight;
        if (y > midTop - lineHeight && y < ASSET_Y) {
          ctx.fillText(line, padding, y);
        }
      });

      // Progress bar along the very bottom edge.
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(0, CANVAS_H - 8, CANVAS_W, 8);
      ctx.fillStyle = theme.textColor || '#FFFFFF';
      ctx.fillRect(0, CANVAS_H - 8, CANVAS_W * progress, 8);
    },
    [config.script, theme.backgroundColor, theme.font, theme.fontSize, theme.textColor, duration],
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

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!assetsReady) {
      setError('Assets are still loading — try again in a moment.');
      return;
    }
    setError(null);
    clearOutput();

    const canvasStream = canvas.captureStream(FPS);
    if (stream) {
      stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
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
    recorder.onstop = () => {
      const finalType = mimeType || chunksRef.current[0]?.type || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: finalType });
      console.log('[ContinuousEngine] recording stopped', { size: blob.size, type: finalType });
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
        mimeType: finalType,
        name: buildFileName('continuous', finalType),
        mode: 'continuous',
      });
      setPhase('done');
    };

    recorderRef.current = recorder;
    chunksRef.current = [];
    startTimeRef.current = performance.now();
    elapsedRef.current = 0;
    setElapsed(0);
    setPhase('recording');
    recorder.start(1000);
    console.log('[ContinuousEngine] recording started', { duration, mimeType });
  }, [assetsReady, clearOutput, duration, setOutput, stream]);

  // Cleanup any live recorder on unmount.
  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const progressPct = Math.min(100, (elapsed / duration) * 100);

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Continuous take</h2>
        <p>{config.script ? 'Read the scrolling script on screen.' : 'No script provided for this template.'}</p>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="preview" data-testid="record-preview-canvas" />
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
