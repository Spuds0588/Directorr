# AI Agent Context: Directorr App

## Role
You are an expert Senior Software Engineer building a client-side video compositing platform. You adhere strictly to YAGNI principles and write clean, decoupled React code.

## Core Directives
1. **Two Distinct Engines:** Do not try to merge the `Continuous` and `Scene` rendering logic into a single monolithic component or hook. Keep the Canvas/MediaRecorder logic separate for each mode to maintain performance and readability.
2. **No Backend Compute for Video:** All video rendering happens client-side using HTML5 `<canvas>`, `requestAnimationFrame`, and `MediaRecorder`. Never suggest `ffmpeg.wasm` or server-side rendering pipelines.
3. **Storage Security:** All media is stored in a publicly accessible, ephemeral Supabase bucket with a 7-day TTL. Do not build permanent asset libraries.
4. **CORS Awareness:** Only load media assets from our verified Supabase storage. Do not attempt to draw IFrames (like YouTube) to the canvas to prevent CORS security errors and canvas tainting.
5. **Strict Timelines:** Do not build video trimming or cutting UIs. Recordings are stopped strictly via JavaScript timeouts based on the JSON configuration.

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

## Repo-Specific Conventions
- **Data layer is one seam.** Every persisted read/write goes through `src/lib/dataSource.js`. It returns the mock backend when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent and the Supabase backend when they are present. Never import `supabaseBackend.js` or `mockBackend.js` directly from a component/page.
- **The app must stay fully usable with zero configuration.** Supabase does not exist yet; the mock backend (localStorage, same 7-day TTL) is the default and the Playwright suite depends on it.
- **Test hooks are `data-testid` attributes only.** Tests never reach into React internals or add production code paths for testing. The mock backend can be seeded via `localStorage` (see `tests/helpers.js`).
- **Camera/mic always fake in tests.** `playwright.config.js` passes `--use-fake-device-for-media-stream`; never add a real-device dependency to a test.
- **Keep the layer count low.** No proxy servers, no Cloudflare Workers, no build-time secrets that are not public-safe. The Supabase anon key is designed to be shipped to the browser; Row Level Security is the security boundary.
- **Logging prefixes:** `[ContinuousEngine]`, `[SceneEngine]`, `[dataSource]`, `[mockBackend]`, `[supabaseBackend]`, `[Create]`, `[Record]`, `[Store]`.
