/**
 * Asset ingest — the one path every B-roll asset travels before the editor sees
 * it, whatever its source.
 *
 * The pipeline is deliberately identical for a studio file, a pasted URL, and a
 * stock-provider download:
 *
 *   1. resolve the source and check its licence policy (never hotlink)
 *   2. download or copy the bytes
 *   3. store a copy in the ephemeral bucket through the data-source seam
 *   4. PROVE the stored URL can be drawn to a canvas without tainting it
 *
 * Step 4 is the important one. A remote file whose host omits
 * `Access-Control-Allow-Origin` still loads, still draws, and then silently
 * poisons the recording canvas so MediaRecorder emits empty video. Catching that
 * here means the creator gets an explanation instead of a ruined take.
 */

import { uploadAsset } from './dataSource.js';
import { assetKind, formatBytes, isDrawableKind, probeDrawableMedia } from './mediaUtils.js';
import { REHOST_POLICY, sourceById, sourceForUrl } from './brollProviders.js';

export const MAX_INGEST_BYTES = 15 * 1024 * 1024;
const EXTENSION_FOR = { image: 'jpg', video: 'mp4', audio: 'mp3' };

export class IngestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}

function filenameFromUrl(url, contentType) {
  const last = url.pathname.split('/').filter(Boolean).pop() || 'asset';
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const ext = EXTENSION_FOR[assetKind({ type: contentType, name: last })] || 'bin';
  return `${last}.${ext}`;
}

/** Smallest possible asset record; every source below funnels into this shape. */
function buildAsset({ stored, kind, source, extra = {} }) {
  return {
    ...stored,
    kind,
    source,
    createdAt: stored.createdAt || new Date().toISOString(),
    ...extra,
  };
}

/**
 * Creator's own file. Already on this origin's storage, so it only needs a
 * provenance tag and a draw check.
 */
export async function ingestFile(file, { folder = 'creator-uploads' } = {}) {
  const kind = assetKind({ type: file.type, name: file.name });
  if (kind === 'unknown') {
    throw new IngestError(`"${file.name}" is not an image, video, or audio file the canvas can use.`, 'unsupported-type');
  }
  if (file.size > MAX_INGEST_BYTES) {
    throw new IngestError(
      `"${file.name}" is ${formatBytes(file.size)}; keep uploads under ${formatBytes(MAX_INGEST_BYTES)} so takes stay smooth.`,
      'too-large',
    );
  }
  const stored = await uploadAsset(file, { folder });
  const asset = buildAsset({
    stored,
    kind,
    source: 'upload',
    extra: { rehosted: false, license: 'Creator-supplied — you own the rights', originalUrl: '' },
  });
  await assertDrawable(asset);
  return asset;
}

/**
 * A file from the Studio Library. First-party and permanent, so it is referenced
 * by URL rather than copied into the 7-day ephemeral bucket.
 */
export async function ingestLibraryItem(item, { license = '' } = {}) {
  const kind = item.kind;
  if (!isDrawableKind(kind)) throw new IngestError(`Unsupported library kind "${kind}".`, 'unsupported-type');
  const asset = {
    id: item.id,
    name: item.name,
    size: item.size || 0,
    type: item.mimeType || '',
    kind,
    path: item.file,
    url: item.url,
    posterUrl: item.posterUrl || '',
    source: 'studio',
    rehosted: false,
    durationSeconds: item.durationSeconds ?? null,
    license: item.license || license,
    attribution: 'Directorr Studio Library',
    originalUrl: '',
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
  await assertDrawable(asset);
  return asset;
}

/**
 * A pasted link to a remote file. This is the zero-key path that works today:
 * any direct image/video/audio URL, from any host that permits it.
 */
export async function ingestRemoteUrl(rawUrl, { sourceId = '', name = '' } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim(), window.location.href);
  } catch {
    throw new IngestError('That does not look like a URL. Paste a direct link to an image, video, or audio file.', 'invalid-url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IngestError(`Only http(s) links can be imported (got "${url.protocol}").`, 'invalid-url');
  }

  const source = sourceById(sourceId) || sourceForUrl(url.href);
  if (source && !source.enabled) {
    throw new IngestError(`${source.label} cannot be used: ${source.disabledReason}`, 'disabled-source');
  }
  if (source && source.rehostPolicy === REHOST_POLICY.PROHIBITED) {
    throw new IngestError(
      `${source.label} forbids storing copies, and Directorr must store a copy to draw the frame without tainting the recording canvas.`,
      'blocked-source',
    );
  }

  let response;
  try {
    response = await fetch(url.href, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  } catch (error) {
    throw new IngestError(
      `Could not download that file (${error.message}). If the host does not send an Access-Control-Allow-Origin header, the asset can never be drawn to the recording canvas, so it is refused up front.`,
      'fetch-failed',
    );
  }
  if (!response.ok) throw new IngestError(`The host answered HTTP ${response.status} for that link.`, 'http-error');

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_INGEST_BYTES) {
    throw new IngestError(`That file is ${formatBytes(declared)}; the limit is ${formatBytes(MAX_INGEST_BYTES)}.`, 'too-large');
  }

  const blob = await response.blob();
  if (!blob.size) throw new IngestError('The download was empty.', 'empty');
  if (blob.size > MAX_INGEST_BYTES) {
    throw new IngestError(`That file is ${formatBytes(blob.size)}; the limit is ${formatBytes(MAX_INGEST_BYTES)}.`, 'too-large');
  }

  const kind = assetKind({ type: contentType || blob.type, name: url.pathname });
  if (kind === 'unknown') {
    throw new IngestError(`"${contentType || 'unknown content type'}" is not media the canvas can composite.`, 'unsupported-type');
  }
  if (!isDrawableKind(kind)) {
    throw new IngestError(`Audio can be used as background music, not as B-roll. Import it in the audio slot.`, 'wrong-slot');
  }

  // Always store our own copy: it removes CORS as a variable and satisfies the
  // "no permanent hotlinking" licences in one move.
  const file = new File([blob], name || filenameFromUrl(url, contentType), { type: contentType || blob.type });
  const stored = await uploadAsset(file, { folder: source ? `stock/${source.id}` : 'imported' });
  console.log('[assetIngest] re-hosted remote asset', { from: url.host, size: blob.size, kind });

  const asset = buildAsset({
    stored,
    kind,
    source: source?.id || 'url',
    extra: {
      rehosted: true,
      originalUrl: url.href,
      license: source?.license || 'Unverified — you are responsible for the rights to this file',
      attribution: source?.attribution || '',
      attributionUrl: source?.attributionUrl || '',
    },
  });
  await assertDrawable(asset);
  return asset;
}

/** A normalised result from a stock provider search adapter. */
export async function ingestSearchResult(item, source) {
  if (!item?.downloadUrl) throw new IngestError('That result has no downloadable file.', 'no-download');
  // Providers all forbid hotlinking for canvas use, so every result is re-hosted.
  return ingestRemoteUrl(item.downloadUrl, { sourceId: source?.id || item.sourceId || '', name: item.name });
}

async function assertDrawable(asset) {
  const probe = await probeDrawableMedia(asset.url, asset.kind);
  if (probe.ok) return asset;
  console.warn('[assetIngest] rejected undrawable asset', { url: asset.url, reason: probe.reason });
  throw new IngestError(
    `The file was stored but cannot be composited: ${probe.reason}. Stored copies expire on their own in 7 days.`,
    'canvas-unsafe',
  );
}
