# Directorr — Task List

Status legend: `[x]` shipped in v1 · `[ ]` not yet started · `[~]` partially done

## Phase 1: Environment & Scaffolding
- [x] Initialize Vite React project.
- [x] Set up React Router (`/`, `/create`, `/record/:id`) — `HashRouter` so static hosting needs no rewrite shim.
- [~] Configure Supabase Postgres schema (`templates` table) — SQL is written in `docs/SETUP-SUPABASE.md`, **not yet executed** (Supabase does not exist yet).
- [~] Configure Supabase Storage bucket (`ephemeral_assets`) — documented, not created.
- [~] Implement 7-day TTL — **implemented in the mock backend**; the `pg_cron` function is written but unapplied.
- [x] Set up Zustand store for app state.
- [x] Single data-layer seam (`src/lib/dataSource.js`) with mock + Supabase implementations.

## Phase 2: Engine A (Continuous Mode)
- [x] Build the Continuous UI view.
- [x] Implement WebRTC capture.
- [x] Implement the `requestAnimationFrame` loop (Top: Webcam, Mid: Scrolling Text, Bot: Timed Assets).
- [x] Implement media pre-loader so assets are ready before recording starts.
- [x] Pipe Canvas + Audio to `MediaRecorder` and auto-stop at `durationSeconds`.

## Phase 3: Engine B (Scene Mode)
- [x] Build the Scene Checklist UI.
- [x] Implement strict auto-stop recording logic (saved as Blob URLs).
- [x] Create Web Audio API routing graph (`GainNode`s for Mic/Music/B-roll).
- [x] Build the Canvas Preview loop (sequential playback based on the timeline).
- [x] Build the hidden 1:1 Compiler (pipes the preview loop + AudioContext to `MediaRecorder`).

## Phase 4: Shared Features & Export
- [x] Volume sliders mapped to the audio graph.
- [x] `navigator.share()` handling of the compiled `File`, with graceful fallback.
- [x] Download fallback via `URL.createObjectURL()`.

## Phase 5: Creator Setup UI
- [x] `/create` view with a toggle for Continuous vs Scene mode.
- [x] Ephemeral uploader with 7-day deletion warning.
- [x] Generate the JSON schema, POST it, and return the Magic Link.

## Phase 6: Testing
- [x] Playwright config with **two Chrome projects**: `chrome-headless` and `chrome-headed`.
- [x] Template creation coverage for both modes + upload + validation.
- [x] Template filling coverage: continuous one-take (auto-stop, real bytes written).
- [x] Template filling coverage: scene record → preview → compile (real bytes written).
- [x] Production suite (`production-tests/`) verified against the live GitHub Pages URL in headless + headed Chrome.
- [x] B-roll scene type covered end to end (a studio loop is selected per scene, recorded, and compiled).
- [ ] Add a `video/mp4` capture assertion for browsers that support MP4 recording.

## Phase 8: B-roll library & provider adapters
- [x] Provider registry with licence + re-host policy as data (`src/lib/brollProviders.js`).
- [x] Zero-key Studio Library (9 generated CC0 stills/loops) built by `npm run library:build` into `public/library/`.
- [x] Single ingest path (`assetIngest.js`): policy check → store our own copy → prove it draws without tainting the canvas.
- [x] Picker UI with four source tabs: studio library, upload, paste URL, stock providers.
- [x] Paste-URL imports re-hosted into the ephemeral bucket, originals recorded in `assetCredits`.
- [x] Per-scene B-roll asset chooser and background-music chooser in the creator UI.
- [x] `assetCredits` carried into the published template JSON (additive to PRD 2.3).
- [x] Provider search adapter (`stockSearch.js`) + `supabase/functions/stock-search/` edge function, written but not deployed.
- [x] Headless **and** headed Chrome coverage for every picker path, including a canvas-taint assertion.
- [ ] Provision Supabase (Phase 7 item) then deploy `stock-search` and set `VITE_STOCK_SEARCH_ENDPOINT`.
- [ ] Surface `assetCredits` on the recording/export screen so published videos carry on-screen credit.

## Phase 7: Deployment
- [x] GitHub Pages workflow (`.github/workflows/deploy.yml`) — tests gate the deploy.
- [x] Supabase keys flow through GitHub Actions **variables/secrets** into the build (no runtime proxy).
- [x] First production deploy verified at <https://spuds0588.github.io/Directorr/>.
- [ ] Supabase project provisioned and keys wired.

## Phase 9: Prompts & narration
- [x] Shared teleprompter module (`src/lib/teleprompter.js`): the canvas caption painter for Mode A plus the reading-pace maths both paths share.
- [x] DOM prompt overlay (`src/components/Teleprompter.jsx`) that scrolls in sync with the take, floats over the video or docks below, and centres short lines.
- [x] Reading-pace feedback per clip and for the whole script, with a hard block when a narration mode needs prompts that do not exist yet.
- [x] `instructions` is now a talent-only prompt. Stage direction is no longer burned into the video, and the debug countdown left the recording canvas too.
- [x] Scene mode mirrors the recording canvas to the visible one, so the talent can see themselves while a strict timer runs.
- [x] Audio-only narration takes via `narration.mode`: `live-mic`, `clip-narration` (one take per clip) and `full-narration` (one take across the stitched timeline).
- [x] Voice cleanup seam (`src/lib/audioCleanup.js`): browser constraints + Web Audio chain, a swappable `engine` recorded per template, and a live input meter.
- [x] Music ducks under narration (`narration.musicDuck`).
- [x] Compile gates on the narration actually existing, and the Web Audio graph is invalidated whenever a source changes.
- [x] Headless **and** headed Chrome coverage, including proof that a prompt never reaches the canvas.
- [ ] Mode A silent-take-then-narrate: needs a replay path for an already-recorded one-take.
- [ ] Apply the cleanup chain at compile time to `live-mic` takes, so scene-mode live voice matches dedicated narration exactly.
- [ ] Audience captions for camera clips (the prompt side is already separated out).

## Explicitly out of scope (YAGNI)
- No visual drag-and-drop editor or clip trimming.
- No AI transcription.
- No backend/`ffmpeg.wasm` rendering.
- No permanent asset library or user accounts. (The Studio Library is first-party product artwork, not a user library — it is not user-uploaded, not searchable state, and not per-account.)
- No Unsplash adapter: its API terms require hotlinking and forbid stored copies, which cannot coexist with canvas compositing. Documented rather than half-built.
