import { useCallback, useEffect, useRef, useState } from 'react';
import { CLEANUP_ENGINES, DEFAULT_CLEANUP, createVoiceProcessor, narrationConstraints, normalizeCleanup, readLevel } from '../lib/audioCleanup.js';
import { buildAudioFileName, pickAudioRecorderMimeType } from '../lib/mediaUtils.js';

/**
 * Audio-only narration takes, captured on device through the cleanup chain.
 *
 * Imperative on purpose: an engine needs "start listening, run the timeline,
 * stop" — a state machine in React would fight the `requestAnimationFrame` loop
 * driving the take. `beginTake()` hands back a `stop()` that resolves to a ready
 * narration clip.
 *
 * What gets recorded is the PROCESSED stream (MediaStreamDestination after the
 * filters and compressor), not the raw microphone, so the clip in the timeline
 * sounds like the meter the talent was watching.
 */
export function useNarration({ cleanup } = {}) {
  const [config, setConfig] = useState(() => normalizeCleanup(cleanup || DEFAULT_CLEANUP));
  const [status, setStatus] = useState('idle'); // idle | recording
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);

  const sessionRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

  const teardown = useCallback(async (session) => {
    if (!session) return;
    cancelAnimationFrame(session.raf);
    try {
      if (session.recorder.state === 'recording') session.recorder.stop();
      await session.stopped;
    } catch (err) {
      console.warn('[useNarration] recorder stop', err);
    }
    session.stream.getTracks().forEach((track) => track.stop());
    session.processor.dispose();
    try {
      await session.ctx.close();
    } catch (err) {
      console.warn('[useNarration] context close', err);
    }
  }, []);

  // Never leave the microphone light on.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      teardown(session);
    },
    [teardown],
  );

  const beginTake = useCallback(
    async ({ label = 'narration' } = {}) => {
      if (!supported) {
        setError('This browser cannot capture microphone input.');
        return null;
      }
      if (sessionRef.current) {
        setError('A narration take is already running.');
        return null;
      }

      setError(null);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      let stream;
      try {
        // A suspended context records silence, so resume before anything else.
        await ctx.resume();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: narrationConstraints(configRef.current.preset),
          video: false,
        });
        const source = ctx.createMediaStreamSource(stream);
        const processor = createVoiceProcessor(ctx, source, configRef.current);
        const destination = ctx.createMediaStreamDestination();
        processor.output.connect(destination);

        const mimeType = pickAudioRecorderMimeType();
        const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
        const chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });

        const session = {
          ctx,
          stream,
          source,
          processor,
          destination,
          recorder,
          chunks,
          mimeType,
          label,
          stopped,
          startedAt: performance.now(),
          raf: 0,
        };

        // Throttled meter: only re-render when the bar actually moves.
        let lastBucket = -1;
        const meter = () => {
          const bucket = Math.round(readLevel(processor.analyser) * 20) / 20;
          if (bucket !== lastBucket) {
            lastBucket = bucket;
            setLevel(bucket);
          }
          session.raf = requestAnimationFrame(meter);
        };
        session.raf = requestAnimationFrame(meter);

        recorder.start(200);
        sessionRef.current = session;
        setStatus('recording');
        console.log('[useNarration] take started', { label, cleanup: processor.describe(), mimeType });
      } catch (err) {
        console.error('[useNarration] could not start a take', err);
        stream?.getTracks().forEach((track) => track.stop());
        try {
          await ctx.close();
        } catch {
          /* context may never have started */
        }
        setError(err?.message || 'Microphone permission denied.');
        return null;
      }

      return {
        /** Stop and resolve the clip, or null if nothing usable was captured. */
        stop: async () => {
          const session = sessionRef.current;
          if (!session) return null;
          sessionRef.current = null;
          const durationSeconds = (performance.now() - session.startedAt) / 1000;
          await teardown(session);
          setStatus('idle');
          setLevel(0);

          const blob = new Blob(session.chunks, { type: session.mimeType || 'audio/webm' });
          console.log('[useNarration] take complete', { label: session.label, bytes: blob.size, durationSeconds });
          if (!blob.size) {
            setError('Nothing was captured — check the microphone input and try again.');
            return null;
          }
          return {
            blob,
            url: URL.createObjectURL(blob),
            durationSeconds,
            mimeType: session.mimeType || 'audio/webm',
            name: buildAudioFileName(session.label, session.mimeType),
          };
        },
      };
    },
    [supported, teardown],
  );

  const setPreset = useCallback((preset) => setConfig(normalizeCleanup({ ...configRef.current, preset })), []);
  const setEngine = useCallback((engine) => setConfig(normalizeCleanup({ ...configRef.current, engine })), []);

  return {
    supported,
    engines: CLEANUP_ENGINES,
    cleanup: config,
    preset: config.preset,
    engine: config.engine,
    setPreset,
    setEngine,
    status,
    recording: status === 'recording',
    level,
    error,
    beginTake,
  };
}
