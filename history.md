# Directorr — Build History

Chronological log of what changed and why. Newest entries at the bottom.

## 2026-09-17 — v1 initial build

**Context.** Repository `Spuds0588/Directorr` contained only a README and a LICENSE. `PRD-Directorr.v2.md` was added to the workspace and is the source of truth. No Supabase project exists yet.

**Shipped.**

- **Scaffolding.** Vite + React 18, React Router (`HashRouter` so GitHub Pages needs no 404 rewrite), Zustand store, plain CSS dark theme. Dev server pinned to port 5180, preview to 5181.
- **Data layer seam.** `src/lib/dataSource.js` selects between:
  - `src/lib/mockBackend.js` — localStorage-backed templates + assets with the same 7-day TTL semantics (default).
  - `src/lib/supabaseBackend.js` — real implementation, lazily `import()`ed so it is only fetched when keys are present. The build emits it as a separate chunk, keeping the mock bundle clean.
  Because the seam is one module, going live is an env-var change with zero component edits.
- **Engine A (Continuous).** `src/components/engineA/ContinuousEngine.jsx` runs one `requestAnimationFrame` loop that composites webcam (cover-fit) / scrolling teleprompter / timed bottom-track assets onto a 720×1280 canvas. The same loop feeds both the on-screen preview and `MediaRecorder`, and auto-stops at `template.durationSeconds`.
- **Engine B (Scene).** `src/components/engineB/SceneEngine.jsx` records each scene for exactly its declared duration, builds a Web Audio graph (voice/music/B-roll `GainNode`s into a `MediaStreamDestination`), previews the stitched timeline, then forks the identical loop onto a hidden 1:1 canvas while recording to produce the final file.
- **Export.** `navigator.share()` file handoff with a `URL.createObjectURL()` download fallback.
- **Creator UI.** `/create` builds the PRD 2.3 JSON, uploads ephemeral assets with the 7-day warning, and returns a Magic Link.
- **Tests.** Playwright with two Chrome projects — `chrome-headless` and `chrome-headed` — both running the full creation and filling suites with fake media devices.

**Verification.**

- `npm run build` — clean, 105 modules, Supabase in its own chunk.
- Sandbox: `chrome-headless` **11/11 passed**; `chrome-headed` **11/11 passed**. Real output was produced, not mocked: continuous one-take ≈231 KB (headless) / ≈207 KB (headed); compiled 3-scene stitch ≈434 KB (headless) / ≈285 KB (headed).

**Decisions.**

- Chose `HashRouter` over `BrowserRouter` to avoid a `404.html` shim — one fewer moving part on static hosting.
- Chose a localStorage mock over stubbing network calls so the product is genuinely usable before Supabase exists, and so the tests exercise the real persistence path.
- Recommended **direct browser → Supabase** (anon key + RLS) instead of a Cloudflare Worker proxy, per the request to minimise layers. See `docs/SETUP-SUPABASE.md`.

**Deployed and verified.** GitHub Pages enabled with the Actions source at <https://spuds0588.github.io/Directorr/>. The deploy workflow gates on the headless suite, then publishes with `VITE_BASE=/Directorr/`. A dedicated production config (`playwright.production.config.js` + `production-tests/`) then exercised the live artifact in both headless and headed Chrome: **6/6 passed**, with real recordings produced from the deployed build (continuous ≈313 KB / ≈330 KB, compiled scene ≈236 KB / ≈221 KB). The live site runs on the mock backend because no Supabase variables are configured yet — which is the intended zero-config state.

**Known gaps.** B-roll scene type has no automated test; MP4 capture is browser-dependent; the `pg_cron` cleanup is written but not applied until the Supabase project exists.
