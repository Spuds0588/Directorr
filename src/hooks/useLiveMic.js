import { useCallback, useEffect, useRef } from 'react';
import { createVoiceProcessor } from '../lib/audioCleanup.js';

/**
 * Clean the camera stream's microphone once per recording session.
 *
 * Scene mode records clip by clip, so the naive approach is a fresh AudioContext
 * per clip — wasteful, and it makes the processed voice drift between takes.
 * This builds the chain once and hands the same processed track to every clip,
 * so a three-clip video sounds like one recording.
 *
 * The processed track is what lands in each clip, which means the compile step
 * mixes already-cleaned voice and needs no second pass.
 */
export function useLiveMic({ cleanup, stream, enabled = true } = {}) {
  const ref = useRef(null);
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  const close = useCallback(async () => {
    const current = ref.current;
    ref.current = null;
    if (!current) return;
    current.processor.dispose();
    try {
      await current.ctx.close();
    } catch (error) {
      console.warn('[useLiveMic] context close', error);
    }
  }, []);

  /** Build (once) and return the processed microphone tracks. */
  const ensure = useCallback(async () => {
    if (!enabled || !stream || !stream.getAudioTracks().length) return [];
    if (ref.current) return ref.current.tracks;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = createVoiceProcessor(ctx, source, cleanupRef.current);
    const destination = ctx.createMediaStreamDestination();
    // Deliberately not monitored to ctx.destination: playing the mic back to the
    // speakers is how you get feedback, not how you get a good take.
    processor.output.connect(destination);

    ref.current = { ctx, source, processor, destination, tracks: destination.stream.getAudioTracks() };
    console.log('[useLiveMic] voice cleanup ready', processor.describe());
    return ref.current.tracks;
  }, [enabled, stream]);

  const analyser = useCallback(() => ref.current?.processor.analyser || null, []);

  // A graph built from a stream dies with that stream.
  useEffect(() => {
    close();
  }, [close, stream]);

  useEffect(
    () => () => {
      close();
    },
    [close],
  );

  return { ensure, analyser, close };
}
