/**
 * Builds the zero-key "Studio Library" into public/library/.
 *
 *   node scripts/build-library.mjs
 *
 * Why generate assets instead of bundling stock photos?
 * ----------------------------------------------------
 * The picker has to work today, with no API keys, on a canvas that refuses to
 * composite cross-origin media. Rather than hotlink files we do not own (which
 * would taint the recording canvas and breach most licences), we generate a
 * small set of abstract stills and loops that are:
 *
 *   - same-origin (served from our own /library/ path -> CORS-free, taint-free)
 *   - licence-clean (CC0, no attribution obligation)
 *   - deterministic (fixed seed), so the manifest and tests are stable
 *
 * Output is committed, so this script is only re-run when the artwork changes.
 * Rendering happens in real Chrome via Playwright's canvas + MediaRecorder — the
 * exact same APIs the app records with.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve(process.argv[2] || 'public/library');
const CLIP_SECONDS = 4;
const CLIP_FPS = 24;
const CLIP_BITRATE = 420_000; // keeps each loop a couple of hundred KB
const W = 1280;
const H = 720;

// JPEG keeps the gradients and grain a few hundred KB instead of megabytes;
// these are photographic-style backgrounds, not UI artwork.
const JPEG_QUALITY = 0.85;

const STILLS = [
  { id: 'studio-blueprint-grid', name: 'Blueprint grid', tags: ['grid', 'tech', 'background'] },
  { id: 'studio-warm-sunrise', name: 'Warm sunrise', tags: ['gradient', 'warm', 'background'] },
  { id: 'studio-cool-dusk', name: 'Cool dusk', tags: ['gradient', 'cool', 'background'] },
  { id: 'studio-dot-matrix', name: 'Dot matrix', tags: ['pattern', 'tech', 'background'] },
  { id: 'studio-diagonal-stripes', name: 'Diagonal stripes', tags: ['pattern', 'texture'] },
  { id: 'studio-paper-grain', name: 'Paper grain', tags: ['texture', 'organic'] },
];

const CLIPS = [
  { id: 'studio-drift-gradient', name: 'Drifting gradient', tags: ['motion', 'gradient', 'ambient'] },
  { id: 'studio-grid-parallax', name: 'Grid parallax', tags: ['motion', 'grid', 'tech'] },
  { id: 'studio-light-sweep', name: 'Light sweep', tags: ['motion', 'light', 'transition'] },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');

  console.log(`[library] rendering into ${OUT_DIR}`);
  const rendered = await page.evaluate(
    async ({ stills, clips, W, H, CLIP_SECONDS, CLIP_FPS, CLIP_BITRATE, JPEG_QUALITY }) => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { alpha: false });

      // Deterministic PRNG so the grain texture never shifts between builds.
      const mulberry32 = (seed) => () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      const linear = (stops, x0, y0, x1, y1) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        stops.forEach(([offset, color]) => g.addColorStop(offset, color));
        return g;
      };

      const blob = (x, y, r, color) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      };

      const drawGrid = (x0, y0, step, minor, major) => {
        ctx.strokeStyle = minor;
        ctx.lineWidth = 1;
        for (let x = x0 % step; x <= W; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, H);
          ctx.stroke();
        }
        for (let y = y0 % step; y <= H; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(W, y + 0.5);
          ctx.stroke();
        }
        ctx.strokeStyle = major;
        ctx.lineWidth = 2;
        const big = step * 5;
        for (let x = x0 % big; x <= W; x += big) {
          ctx.beginPath();
          ctx.moveTo(x + 1, 0);
          ctx.lineTo(x + 1, H);
          ctx.stroke();
        }
        for (let y = y0 % big; y <= H; y += big) {
          ctx.beginPath();
          ctx.moveTo(0, y + 1);
          ctx.lineTo(W, y + 1);
          ctx.stroke();
        }
      };

      const vignette = (strength = 0.55) => {
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.9);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${strength})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      };

      const stillsPainters = {
        'studio-blueprint-grid': () => {
          ctx.fillStyle = '#0e1c2e';
          ctx.fillRect(0, 0, W, H);
          drawGrid(0, 0, 40, 'rgba(120,180,255,0.20)', 'rgba(120,180,255,0.45)');
        },
        'studio-warm-sunrise': () => {
          ctx.fillStyle = linear(
            [
              [0, '#ff9a3c'],
              [0.45, '#ff5f6d'],
              [1, '#2b1055'],
            ],
            0,
            0,
            W,
            H,
          );
          ctx.fillRect(0, 0, W, H);
          blob(W * 0.72, H * 0.28, H * 0.9, 'rgba(255,214,140,0.55)');
        },
        'studio-cool-dusk': () => {
          ctx.fillStyle = linear(
            [
              [0, '#0f2027'],
              [0.5, '#203a43'],
              [1, '#2c5364'],
            ],
            0,
            0,
            W,
            H,
          );
          ctx.fillRect(0, 0, W, H);
          blob(W * 0.28, H * 0.7, H * 0.95, 'rgba(0,209,178,0.35)');
        },
        'studio-dot-matrix': () => {
          ctx.fillStyle = '#12121a';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = 'rgba(108,92,231,0.75)';
          for (let x = 20; x < W; x += 32) {
            for (let y = 20; y < H; y += 32) {
              ctx.beginPath();
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        },
        'studio-diagonal-stripes': () => {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = 'rgba(0,209,178,0.16)';
          for (let i = -H; i < W + H; i += 56) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 28, 0);
            ctx.lineTo(i + 28 + H, H);
            ctx.lineTo(i + H, H);
            ctx.closePath();
            ctx.fill();
          }
        },
        'studio-paper-grain': () => {
          ctx.fillStyle = linear(
            [
              [0, '#efe9dd'],
              [1, '#d9d2c4'],
            ],
            0,
            0,
            W,
            H,
          );
          ctx.fillRect(0, 0, W, H);
          const rand = mulberry32(1337);
          const grain = ctx.getImageData(0, 0, W, H);
          for (let i = 0; i < grain.data.length; i += 4) {
            const n = (rand() - 0.5) * 26;
            grain.data[i] += n;
            grain.data[i + 1] += n;
            grain.data[i + 2] += n;
          }
          ctx.putImageData(grain, 0, 0);
        },
      };

      const clipPainters = {
        'studio-drift-gradient': (t) => {
          ctx.fillStyle = '#0b0b12';
          ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          blob(W * (0.3 + 0.12 * Math.sin(t * 0.9)), H * (0.4 + 0.1 * Math.cos(t * 0.7)), H * 0.8, 'rgba(108,92,231,0.45)');
          blob(W * (0.7 + 0.1 * Math.cos(t * 0.6)), H * (0.6 + 0.12 * Math.sin(t * 0.8)), H * 0.7, 'rgba(0,209,178,0.32)');
          blob(W * 0.5, H * (0.5 + 0.15 * Math.sin(t * 0.5)), H * 0.5, 'rgba(255,120,180,0.22)');
          ctx.globalCompositeOperation = 'source-over';
          vignette(0.45);
        },
        'studio-grid-parallax': (t) => {
          ctx.fillStyle = '#0d1117';
          ctx.fillRect(0, 0, W, H);
          ctx.save();
          ctx.translate(-t * 22, -t * 12);
          drawGrid(0, 0, 48, 'rgba(0,209,178,0.18)', 'rgba(0,209,178,0.4)');
          ctx.restore();
          vignette(0.6);
        },
        'studio-light-sweep': (t, dur) => {
          ctx.fillStyle = '#141422';
          ctx.fillRect(0, 0, W, H);
          blob(W * 0.5, H * 0.5, H, 'rgba(108,92,231,0.28)');
          const p = dur > 0 ? t / dur : 0;
          const x = -W * 0.6 + p * W * 2.2;
          ctx.save();
          ctx.translate(x, 0);
          ctx.rotate(-0.28);
          const g = ctx.createLinearGradient(0, -H, W * 0.35, H);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, 'rgba(255,255,255,0.34)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, -H, W * 0.35, H * 3);
          ctx.restore();
          vignette(0.5);
        },
      };

      const stillResults = {};
      for (const still of stills) {
        stillsPainters[still.id]();
        stillResults[still.id] = canvas.toDataURL('image/jpeg', JPEG_QUALITY).replace(/^data:image\/jpeg;base64,/, '');
      }

      const toBase64 = async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
      };

      const recordClip = async (id) => {
        const paint = clipPainters[id];
        const stream = canvas.captureStream(CLIP_FPS);
        const candidate = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((mimeType) => {
          try {
            return MediaRecorder.isTypeSupported(mimeType);
          } catch {
            return false;
          }
        });
        const recorder = new MediaRecorder(stream, {
          ...(candidate ? { mimeType: candidate } : {}),
          videoBitsPerSecond: CLIP_BITRATE,
        });
        const chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });

        const startedAt = performance.now();
        paint(0, CLIP_SECONDS);
        const poster = canvas.toDataURL('image/jpeg', JPEG_QUALITY).replace(/^data:image\/jpeg;base64,/, '');
        recorder.start(200);
        await new Promise((resolve) => {
          const loop = () => {
            const t = (performance.now() - startedAt) / 1000;
            paint(Math.min(t, CLIP_SECONDS), CLIP_SECONDS);
            if (t >= CLIP_SECONDS) resolve();
            else requestAnimationFrame(loop);
          };
          loop();
        });
        recorder.stop();
        await stopped;

        const blob = new Blob(chunks, { type: candidate || 'video/webm' });
        return { poster, base64: await toBase64(blob), size: blob.size, mimeType: (candidate || 'video/webm').split(';')[0] };
      };

      const clipResults = {};
      for (const clip of clips) {
        clipResults[clip.id] = await recordClip(clip.id);
      }

      return { stillResults, clipResults };
    },
    { stills: STILLS, clips: CLIPS, W, H, CLIP_SECONDS, CLIP_FPS, CLIP_BITRATE, JPEG_QUALITY },
  );

  await browser.close();

  const assets = [];
  for (const still of STILLS) {
    const base64 = rendered.stillResults[still.id];
    const bytes = Buffer.from(base64, 'base64');
    await writeFile(path.join(OUT_DIR, `${still.id}.jpg`), bytes);
    assets.push({
      id: still.id,
      name: still.name,
      kind: 'image',
      file: `library/${still.id}.jpg`,
      mimeType: 'image/jpeg',
      width: W,
      height: H,
      durationSeconds: null,
      size: bytes.length,
      tags: still.tags,
    });
    console.log(`[library] still ${still.id}.jpg (${bytes.length} bytes)`);
  }

  for (const clip of CLIPS) {
    const result = rendered.clipResults[clip.id];
    const bytes = Buffer.from(result.base64, 'base64');
    const poster = Buffer.from(result.poster, 'base64');
    await writeFile(path.join(OUT_DIR, `${clip.id}.webm`), bytes);
    await writeFile(path.join(OUT_DIR, `${clip.id}.poster.jpg`), poster);
    assets.push({
      id: clip.id,
      name: clip.name,
      kind: 'video',
      file: `library/${clip.id}.webm`,
      poster: `library/${clip.id}.poster.jpg`,
      mimeType: result.mimeType,
      width: W,
      height: H,
      durationSeconds: CLIP_SECONDS,
      fps: CLIP_FPS,
      size: bytes.length,
      tags: clip.tags,
    });
    console.log(`[library] clip ${clip.id}.webm (${bytes.length} bytes)`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-library.mjs',
    license: 'CC0 / public domain — generated by Directorr. No attribution required.',
    note: 'First-party assets served from this origin, so they can be composited without tainting the canvas.',
    assets,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[library] wrote manifest.json with ${assets.length} assets`);
}

main().catch((error) => {
  console.error('[library] failed:', error);
  process.exit(1);
});
