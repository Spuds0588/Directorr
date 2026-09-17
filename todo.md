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
- [~] B-roll scene type is implemented but not covered by an automated test (needs a generated video fixture).
- [ ] Add a `video/mp4` capture assertion for browsers that support MP4 recording.

## Phase 7: Deployment
- [x] GitHub Pages workflow (`.github/workflows/deploy.yml`) — tests gate the deploy.
- [x] Supabase keys flow through GitHub Actions **variables/secrets** into the build (no runtime proxy).
- [ ] First production deploy verified.
- [ ] Supabase project provisioned and keys wired.

## Explicitly out of scope (YAGNI)
- No visual drag-and-drop editor or clip trimming.
- No AI transcription.
- No backend/`ffmpeg.wasm` rendering.
- No permanent asset library or user accounts.
