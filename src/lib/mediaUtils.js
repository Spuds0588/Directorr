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

const AUDIO_RECORDER_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** Audio-only sibling of `pickRecorderMimeType` — a video mimeType throws on an audio stream. */
export function pickAudioRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const candidate of AUDIO_RECORDER_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        console.log('[media] using audio recorder mimeType', candidate);
        return candidate;
      }
    } catch {
      /* ignore and keep probing */
    }
  }
  console.warn('[media] no audio mimeType supported; falling back to browser default');
  return '';
}

export function extensionForMimeType(mimeType = '') {
  if (mimeType.startsWith('audio/')) {
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
  }
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

export function buildFileName(mode, mimeType) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `directorr-${mode || 'video'}-${stamp}.${extensionForMimeType(mimeType)}`;
}

export function buildAudioFileName(label, mimeType) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `directorr-${label || 'narration'}-${stamp}.${extensionForMimeType(mimeType || 'audio/webm')}`;
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

/**
 * Wait for an <img>/<video> to be drawable, resolving even on error.
 *
 * Both events matter: `<video>` fires `loadeddata`, while `<img>` fires `load`
 * and never fires `loadeddata` at all. Listening only for `loadeddata` used to
 * make every image asset "fail" after the full timeout — which delayed the first
 * frame of a take by eight seconds and made the drawability probe reject valid
 * pictures.
 */
export function waitForMedia(media, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    media.addEventListener('load', () => finish(true), { once: true });
    media.addEventListener('loadeddata', () => finish(true), { once: true });
    media.addEventListener('error', () => finish(false), { once: true });
    // Already decoded: an image straight from cache or a data URL.
    if (media.complete && media.naturalWidth) finish(true);
  });
}

/**
 * Normalise any asset-shaped object into the three kinds the engines understand.
 * Mime types from stock hosts are inconsistent ("video/quicktime", no type at
 * all), so the file extension is used as a fallback.
 */
export function assetKind({ type = '', name = '', url = '' } = {}) {
  const mime = String(type).toLowerCase();
  if (mime.startsWith('image')) return 'image';
  if (mime.startsWith('video')) return 'video';
  if (mime.startsWith('audio')) return 'audio';
  const path = `${name || ''} ${url || ''}`.toLowerCase().split(/[?#]/)[0];
  if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(path)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path)) return 'audio';
  return 'unknown';
}

/** Kinds the canvas renderers can actually composite. */
export function isDrawableKind(kind) {
  return kind === 'image' || kind === 'video';
}

/**
 * The single guard that keeps a bad asset out of the creator's timeline.
 *
 * A remote host that does not send `Access-Control-Allow-Origin` poisons the
 * recording canvas: `drawImage` still "works", but the canvas becomes tainted
 * and `captureStream`/`MediaRecorder` then produce empty video. Rather than
 * discover that after a take, we load the candidate and read one pixel back —
 * `getImageData` throws `SecurityError` precisely when the canvas is tainted.
 */
export async function probeDrawableMedia(url, kind, { timeoutMs = 8000 } = {}) {
  if (!isDrawableKind(kind)) return { ok: false, reason: `unsupported kind "${kind}"` };
  const media = kind === 'image' ? createImageElement(url) : createVideoElement(url, { muted: true, loop: true });
  const loaded = await waitForMedia(media, timeoutMs);
  if (!loaded) {
    if (kind !== 'image') media.removeAttribute('src');
    return { ok: false, reason: 'the file could not be decoded by this browser' };
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  try {
    ctx.drawImage(media, 0, 0, 2, 2);
    ctx.getImageData(0, 0, 1, 1);
  } catch (error) {
    return { ok: false, reason: `canvas-tainted (${error.name}: ${error.message})` };
  } finally {
    if (kind !== 'image') {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
  }
  return { ok: true };
}

export function createImageElement(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  return img;
}

export function createAudioElement(url, { loop = false } = {}) {
  const audio = document.createElement('audio');
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  audio.loop = loop;
  audio.src = url;
  return audio;
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
