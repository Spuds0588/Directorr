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

## 2026-09-17 — B-roll picker, Studio Library, and provider adapters

**Context.** v1 shipped with a single file input for "ephemeral assets", which meant a creator had to source, download, and re-upload every B-roll clip by hand. The request was a provider-agnostic picker that re-hosts chosen assets into the ephemeral bucket, works today with no keys through upload/paste-URL, and lets provider search be layered in later.

**The constraint that shaped the design.** Every asset is `drawImage`d onto the canvas feeding `MediaRecorder`. A host without `Access-Control-Allow-Origin` still lets the file load and still lets it draw — and then taints the canvas so the recorded video comes out empty. That makes "store our own copy" the only universally safe strategy, not just a convenience.

**Shipped.**

- **Provider registry as data** (`src/lib/brollProviders.js`). Each source carries `kinds`, `requiresKey`, `keyName`, `license`, `attribution`, `rateLimit`, and a `rehostPolicy`: `not-needed` (studio/upload), `allowed` (Pexels), `required` (Pixabay — hotlinking forbidden, a copy is mandatory), `prohibited` (Unsplash). The picker renders whatever the registry declares, so adding a provider is one entry plus one server adapter — never a UI change.
- **Unsplash is deliberately disabled**, with the conflict stated in the UI: its API guidelines require hotlinking and forbid stored copies, which cannot coexist with canvas compositing. Documented rather than half-built.
- **Studio Library** (`scripts/build-library.mjs` → `public/library/`, 956 KB committed). Six stills and three 4 s loops rendered in real Chrome via Playwright's canvas + `MediaRecorder` — the same APIs the app records with — plus a manifest and poster thumbnails. Because the files are generated they are first-party, CC0, CORS-free, deterministic, and never expire. Run with `npm run library:build`.
- **One ingest path** (`src/lib/assetIngest.js`) for all four sources: resolve the source and check licence policy → download or accept the file → store a copy through the existing data-source seam → **prove it can be drawn** via `probeDrawableMedia()`, which reads a pixel back and catches the `SecurityError` that marks a tainted canvas. A bad asset is refused with an explanation instead of ruining a take.
- **Picker UI** (`src/components/AssetPicker.jsx`) with four tabs: Studio library (searchable by name/tag), Upload, Paste URL, Stock providers. The providers tab states the exact key requirement and disables search rather than failing silently.
- **Provider adapter seam** (`src/lib/stockSearch.js` + `supabase/functions/stock-search/index.ts`). Keys stay confidential in Supabase's secret store; the app only ever receives an endpoint URL. Written and documented, not deployed — the zero-key paths cover the product today.
- **Creator UI gains real asset assignment**: a per-scene B-roll chooser (previously every B-roll scene silently used the first asset) and a background-music chooser.
- **`assetCredits`** added to the published template JSON (additive to PRD 2.3) so licence obligations travel with the template. `validateTemplate` now rejects a B-roll scene with no asset.

**Two latent bugs found and fixed.**

1. `waitForMedia()` only listened for `loadeddata`, which `<img>` never fires. Every image asset therefore "failed" after the full 8 s timeout — so image B-roll delayed the start of a take by eight seconds and the new drawability probe would have rejected valid pictures. It now listens for `load` as well and short-circuits when `naturalWidth` is already set.
2. The picker's library effect guarded on state that the effect itself set; React 18 StrictMode's setup/cleanup/setup cycle cleared the flag on the re-render it had just caused, stranding the panel on "Loading…" forever. A ref latch is immune to that cycle.
3. Also reduced the mock backend's data-URL threshold to 1.5 MB so large imports become session Blob URLs instead of blowing the localStorage quota.

**Verification.** `npm run build` clean. Sandbox: `chrome-headless` **22/22 passed**, `chrome-headed` **22/22 passed** (44 executions). The new specs assert real bytes, not mocked success — a continuous take over a studio loop recorded ≈362 KB / ≈353 KB, and a B-roll scene compiled ≈182 KB / ≈199 KB. The decisive assertion is a `getImageData()` call on the recording canvas after a take: it must not throw, which is the only direct proof that no hotlinked asset tainted it. Whole suite also runs in 28 s, down from 3.9 minutes, because image assets no longer wait out the decode timeout.

**Decisions.**

- Chose a **generated** Studio Library over bundled stock photos: same-origin and CC0 by construction, no attribution obligation, no licence ambiguity, and deterministic for tests.
- Chose **Supabase Edge Function** over a Cloudflare Worker for provider search — same vendor as storage, no new account, no second secret store.
- Kept **direct browser → Supabase** as the default path; the function exists solely for confidential third-party keys, and only when provider search is actually wanted.
- Refused any **hotlink** fallback for canvas assets, even where a licence would allow it, because the failure mode (silently empty video) is far worse than the error message.

**Known gaps.** The `stock-search` function is written and documented but not deployed (needs the Supabase project). Provider results are untested against live APIs for the same reason. `assetCredits` is recorded but not yet displayed on the export screen.

## 2026-09-17 — Talent prompts and on-device narration

**Context.** Three questions arrived together: is this a stacked clip editor? does the recorder show a scrolling script? and can we record audio-only narration — per clip or as one take over the whole video — using Chrome's built-in audio tools, with other cleanup models swappable later. The audit found a real product hole under the third one.

**What the audit found.** Mode A had a genuine scrolling teleprompter (paced to the take, drawn into the MID band) — but Mode B had only static per-scene `instructions`, and worse, those instructions were **painted on the recording canvas**, so "Introduce yourself." shipped to the audience along with a debug countdown timer in the corner. The visible preview canvas was not even painted while a clip recorded: the talent was staring at a blank box with no idea what they looked like. And voice only existed when a scene was type `camera`, so anything spoken over a title card or B-roll was silently thrown away.

**The rule that fixed all of it: the canvas is the audience's view, the DOM is the talent's.**

- **`src/components/Teleprompter.jsx`** — a DOM prompt that scrolls in sync with the take (driven from the same `startedAt` clock the engine times the clip with), floats over the video or docks below, centres short lines instead of stranding them, and shows the clip's reading pace. Because it is DOM it cannot be recorded by construction, and it renders crisper than 720px canvas text.
- **`src/lib/teleprompter.js`** — the shared painter (`drawTeleprompter`) Mode A's caption band now uses, plus the word/pace maths. Mode A's band passes `guide: false` so captions still look like captions rather than a teleprompter.
- **Stage direction left the video.** `drawSceneFrame` now renders output only. The countdown and REC state became a DOM HUD, and the prompt replaced the burned-in instructions. Proof is in the tests, not the comments: a `fillText` spy asserts the audience string is composited while the prompt string never is.
- **The talent can see themselves.** The recording canvas is mirrored to the visible one every frame, so what they watch is exactly what ships.
- **Voice is now a first-class track.** `narration.mode` is `live-mic` (recorded with the picture), `clip-narration` (an audio-only take per clip, replayed against that clip) or `full-narration` (one take across the whole stitched timeline, with the full script scrolling in timeline order). Compile gates on the narration existing — picture alone is not finished work in those modes.
- **Live-mic captures every clip**, not just camera ones, which is what makes "one long narration over the whole clip" true in Mode B instead of a partial take.
- **Cleanup is a seam, not a dependency.** `src/lib/audioCleanup.js` does browser constraints (`noiseSuppression` / `echoCancellation` / `autoGainControl` — Chrome's own tools, no bundle cost) plus a Web Audio chain: 90 Hz rumble filter, leveling compressor, makeup gain. Three presets including a genuinely raw one so the difference is audible. The `engine` id travels in the template JSON, and a second engine is declared-but-unimplemented, so a tested denoise model can replace the chain without touching either engine. `useLiveMic` builds the chain once per session and reuses the processed track for every clip; `useNarration` records the *processed* stream so what you hear in the meter is what lands in the file.
- **Music ducks under narration** (`narration.musicDuck`, default 0.35) rather than the creator guessing a level.
- **Reading pace is now visible while writing.** A 27-word prompt in a 2-second clip reports `810 wpm — too fast`, per clip and for the whole script, and publishing is blocked when `clip-narration` has a clip with nothing to say.

**Four bugs found and fixed.**

1. **A media element can only ever feed one `MediaElementSourceNode`.** Adding narration exposed it: after a re-record the graph still held the old elements, so re-recorded audio went silent, and the background-music element would have thrown on the second `createMediaElementSource`. Any source change now invalidates and rebuilds the graph (`invalidateAudioGraph`).
2. **Device-length mismatch**: `pickRecorderMimeType()` returns a *video* mime type, which throws on an audio-only stream. Added `pickAudioRecorderMimeType()` and audio-aware file extensions (`m4a`/`ogg`/`webm`).
3. **`waitForMedia` and short prompts** — a prompt that fits its viewport never moved, which looked broken rather than intentional; it now centres on the guide line.
4. A test caught its own weakness: `toContainText('Narration')` matched "Narration **pending**", so a narration take could still be running when the compile assertion ran. The assertions now key off the button flipping to "Re-narrate".

**Deployed and verified.** Pushed to `main` (commit `05f48d7`); the workflow gated on the headless suite and published successfully. The production suite then exercised the live artifact in headless and headed Chrome: **12/12 passed**, including the B-roll picker shipping from the Pages sub-path and a clip-narrated scene template completing end to end on the deployed build (continuous take ≈318–327 KB, compiled scene ≈209–211 KB).

**Verification.** `npm run build` clean. Sandbox: `chrome-headless` **32/32 passed**, `chrome-headed` **32/32 passed** (64 executions, both suites including the B-roll picker). New recordings are real: a clip-narrated 2-clip compile ≈226–242 KB, a one-take narration compile ≈159–185 KB, Mode A prompt-only ≈330 KB. The prompt/canvas split is asserted by intercepting every `fillText` call on the page, which is a stronger guarantee than a pixel check: the audience string is composited and the prompt string provably never touches a canvas.

**Decisions.**

- Chose **DOM for the prompt** over a second canvas: unrecordable by construction, sharper text, and testable with ordinary DOM assertions.
- Chose to **remove the instruction burn-in** rather than add a flag. Burning "Introduce yourself." into a published social video was only ever defensible as a debug aid, and the PRD's captions requirement is a Mode A concern.
- Kept **Mode A on live-mic only**. A silent-take-then-narrate flow needs a replay path for an already-recorded one-take; building half of it would be worse than not building it.
- Chose to **duck music only for dedicated narration**, not for `live-mic`, so existing mixes behave exactly as before unless the creator asks for a separate voice track.
- Recorded the **cleanup engine id in each template** rather than globally, so takes made with one engine stay reproducible after another is added.

**Docs restructured.** The README had grown into an implementation document, which is the wrong job for a README on an open-source project people arrive at from a link. It is now product-facing — what it is, why the first take problem is worth solving, and how to try it — with the live GitHub Pages link at the top. Everything technical moved to `HOW-IT-WORKS.md`: the two engines, the canvas/DOM rule, the narration modes and cleanup seam, the asset-ingest pipeline, the data-layer seam, testing and deployment, plus the table of additive schema fields. `agents.md` gained a docs map so the split stays obvious. Deliberately not a replacement for `agents.md`, which still owns code conventions.

**Known gaps.** Mode A has no silent-take-then-narrate (no replay path). `live-mic` in scene mode uses the browser's capture processing plus the Web Audio chain at record time, while dedicated narration takes get the chain applied live — both are cleaned, but the compile does not re-apply the chain to live takes. Narration longer than its clip is cut by the strict timer, which the creator-facing pace warning is designed to prevent. Per-scene audience captions for camera clips do not exist yet.
