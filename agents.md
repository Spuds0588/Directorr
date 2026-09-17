# AI Agent Context: Directorr App

## Role
You are an expert Senior Software Engineer building a client-side video compositing platform. You adhere strictly to YAGNI principles and write clean, decoupled React code.

## Core Directives
1. **Two Distinct Engines:** Do not try to merge the `Continuous` and `Scene` rendering logic into a single monolithic component or hook. Keep the Canvas/MediaRecorder logic separate for each mode to maintain performance and readability.
2. **No Backend Compute for Video:** All video rendering happens client-side using HTML5 `<canvas>`, `requestAnimationFrame`, and `MediaRecorder`. Never suggest `ffmpeg.wasm` or server-side rendering pipelines.
3. **Storage Security:** All media is stored in a publicly accessible, ephemeral Supabase bucket with a 7-day TTL. Do not build permanent asset libraries.
4. **CORS Awareness:** Only load media assets from our verified Supabase storage. Do not attempt to draw IFrames (like YouTube) to the canvas to prevent CORS security errors and canvas tainting. Never hotlink a remote file into `bottomTrack` or a B-roll scene: an asset without `Access-Control-Allow-Origin` still loads and still draws, then poisons the recording canvas so `MediaRecorder` writes empty video. Store a copy, then prove it is drawable (`probeDrawableMedia`).
5. **Strict Timelines:** Do not build video trimming or cutting UIs. Recordings are stopped strictly via JavaScript timeouts based on the JSON configuration.
6. **The canvas is the audience's view; the DOM is the talent's.** Anything drawn on a recording canvas ends up in the published video. Prompts, countdowns, REC indicators and stage direction belong in the DOM overlay (`Teleprompter.jsx`), never on the canvas. Mode A's script band is the deliberate exception: the PRD asks for sync'd captions in the composite, so it is either burned in (`continuousConfig.showScriptInOutput`) or moved to the DOM prompt.
7. **Voice is captured through the cleanup seam** (`src/lib/audioCleanup.js`), never straight off the raw track. Browser constraints (`noiseSuppression`, `echoCancellation`, `autoGainControl`) plus a Web Audio chain today; the `engine` id in the template JSON means a denoise model can replace the chain later without breaking existing templates.

## Technology Stack
- Framework: React (Vite), React Router (`HashRouter`, for static hosting)
- State: Zustand (preferred)
- Styling: Plain CSS or Tailwind (keep it minimal)
- Backend: Supabase (Postgres for JSON, Storage for assets)
- Tests: Playwright (headless **and** headed Chrome projects)

## When Generating Code
- Provide complete, self-contained functional components or hooks. Do not output partial snippets unless asked.
- Include heavy logging (e.g., `console.log('[ContinuousEngine] Drawing B-roll frame at sec 12')`) to ensure the rendering timeline can be easily debugged in the console.
- Handle state cleanup explicitly (revoke ObjectURLs, stop AudioContexts, clear Animation Frames) to prevent memory leaks on mobile devices.

## Docs map
- `README.md` — product-facing. Keep it about the user and why they'd want this; no implementation detail.
- `HOW-IT-WORKS.md` — the technical companion (architecture, schema additions, testing, deployment).
- `agents.md` — this file: the rules for writing code here.
- `history.md` / `todo.md` — what changed, why, and what's still missing.
- `docs/SETUP-*.md` — user-facing setup for services Directorr can talk to.

## Repo-Specific Conventions
- **Data layer is one seam.** Every persisted read/write goes through `src/lib/dataSource.js`. It returns the mock backend when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent and the Supabase backend when they are present. Never import `supabaseBackend.js` or `mockBackend.js` directly from a component/page.
- **The app must stay fully usable with zero configuration.** Supabase does not exist yet; the mock backend (localStorage, same 7-day TTL) is the default and the Playwright suite depends on it.
- **Test hooks are `data-testid` attributes only.** Tests never reach into React internals or add production code paths for testing. The mock backend can be seeded via `localStorage` (see `tests/helpers.js`).
- **Camera/mic always fake in tests.** `playwright.config.js` passes `--use-fake-device-for-media-stream`; never add a real-device dependency to a test.
- **Keep the layer count low.** No proxy servers, no Cloudflare Workers, no build-time secrets that are not public-safe. The Supabase anon key is designed to be shipped to the browser; Row Level Security is the security boundary. One exception exists, and only one: `supabase/functions/stock-search/` holds third-party provider keys, which are genuinely confidential and have no CORS-friendly API. It runs on the Supabase project we already have, so it adds no vendor.
- **Assets have exactly one entry point.** Every B-roll asset — studio file, upload, pasted URL, or provider download — is consumed by `assetIngest.js`, which checks the source's licence policy, stores our own copy through the data-source seam, and proves the result can be composited before it reaches the editor. Components never `fetch` media themselves.
- **Provider policy is data, not branches.** Sources (and their `rehostPolicy`, licence, attribution, key name) live in `src/lib/brollProviders.js`; the picker renders whatever it finds there. Adding a provider is one registry entry plus one normalising adapter in `supabase/functions/stock-search/`, never a UI change.
- **`assetCredits` is additive to the PRD 2.3 schema.** Engines ignore it; it exists so a licence obligation travels with the published template instead of living in the creator's memory.
- **The studio library is generated, not sourced.** `npm run library:build` renders `public/library/` in real Chrome through canvas + `MediaRecorder` (same APIs the app records with), so the assets are first-party, CC0, CORS-free, and deterministic. Output is committed.
- **Three ways voice reaches the timeline**, chosen by `narration.mode`: `live-mic` (recorded with the picture — and in Mode B captured across *every* clip, not just camera ones, so narration over a title card is not dropped), `clip-narration` (an audio-only take per clip, replayed against that clip), `full-narration` (one take across the whole stitched timeline). Compile gates on the narration actually existing.
- **A scene's `instructions` is the PROMPT, and `text` is the OUTPUT.** Never treat one as the other: the prompt must not be drawn to the canvas, and the talent must never be told to read a caption aloud.
- **A media element can only ever feed one `MediaElementSourceNode`.** Rebuilding a recorded clip, a narration take, or the background music invalidates the whole Web Audio graph (`invalidateAudioGraph`) so it is rebuilt with the new sources. Forget this and audio silently disappears after a re-record.
- **Logging prefixes:** `[ContinuousEngine]`, `[SceneEngine]`, `[dataSource]`, `[mockBackend]`, `[supabaseBackend]`, `[Create]`, `[Record]`, `[Store]`, `[AssetPicker]`, `[assetIngest]`, `[stockLibrary]`, `[stockSearch]`, `[audioCleanup]`, `[useLiveMic]`, `[useNarration]`, `[media]`.
