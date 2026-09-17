// Small, dependency-free media helpers shared by both engines.

const RECORDER_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const candidate of RECORDER_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        console.log('[media] using recorder mimeType', candidate);
        return candidate;
      }
    } catch {
      /* ignore and keep probing */
    }
  }
  console.warn('[media] no explicit mimeType supported; falling back to browser default');
  return '';
}

export function extensionForMimeType(mimeType = '') {
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

export function buildFileName(mode, mimeType) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `directorr-${mode || 'video'}-${stamp}.${extensionForMimeType(mimeType)}`;
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSeconds(seconds = 0) {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}

/** Draw `media` into a rect using CSS `object-fit: cover` semantics. */
export function drawCover(ctx, media, dx, dy, dw, dh) {
  const mw = media.videoWidth || media.naturalWidth || media.width;
  const mh = media.videoHeight || media.naturalHeight || media.height;
  if (!mw || !mh) return;
  const scale = Math.max(dw / mw, dh / mh);
  const sw = mw * scale;
  const sh = mh * scale;
  ctx.drawImage(media, dx + (dw - sw) / 2, dy + (dh - sh) / 2, sw, sh);
}

/** Greedy word-wrap for canvas text. Caller must set ctx.font first. */
export function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Wait for an <img>/<video> to be drawable, resolving even on error. */
export function waitForMedia(media, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      done(true);
    };
    media.addEventListener('loadeddata', finish, { once: true });
    media.addEventListener('error', () => {
      clearTimeout(timer);
      done(false);
    }, { once: true });
  });
}

export function createImageElement(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  return img;
}

export function createVideoElement(url, { muted = true, loop = true } = {}) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.muted = muted;
  video.loop = loop;
  video.preload = 'auto';
  video.src = url;
  return video;
}
