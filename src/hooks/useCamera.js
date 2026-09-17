import { useEffect, useRef, useState } from 'react';

/**
 * Acquire and release a camera/mic stream.
 * Cleanup is explicit per agents.md: every track is stopped on unmount so mobile
 * devices never keep the camera light on.
 */
export function useCamera({ video = true, audio = true } = {}) {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser has no camera/microphone access (getUserMedia unavailable).');
        return;
      }
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: video ? { width: { ideal: 720 }, height: { ideal: 1280 }, facingMode: 'user' } : false,
          audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
        });
        if (!active) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = acquired;
        setStream(acquired);
        setReady(true);
        console.log('[useCamera] stream ready', acquired.getTracks().map((t) => t.kind));
      } catch (err) {
        console.error('[useCamera] getUserMedia failed', err);
        setError(err?.message || 'Camera permission denied.');
      }
    }

    start();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        console.log('[useCamera] stream stopped');
      }
    };
  }, [video, audio]);

  return { stream, error, ready };
}

/** Bind a MediaStream to a <video> element ref. */
export function attachStream(videoEl, stream) {
  if (!videoEl || !stream) return;
  if (videoEl.srcObject !== stream) {
    videoEl.srcObject = stream;
    videoEl.play?.().catch(() => {
      /* autoplay is allowed because the stream is muted/gesture-driven */
    });
  }
}
