# How Directorr works

The technical companion to the [README](README.md). The README sells the product; this file explains how
it's built, and why the awkward decisions were made the way they were.

For repo conventions, code style rules and the rules an AI agent must follow, see [`agents.md`](agents.md).
Build history, decisions and known gaps live in [`history.md`](history.md).

---

## The one architectural constraint

**There is no backend video compute.** Everything is composited in the browser with `<canvas>` +
`requestAnimationFrame` and captured with `MediaRecorder`. No `ffmpeg.wasm`, no render farm, no upload
step. That single constraint explains most of the design: if you can't render on a server, you have to get
the take right the first time, and you have to be careful about what can legally be drawn onto a canvas.

## Two engines, on purpose

The rendering logic is deliberately **not** unified into one component. Each mode gets its own engine,
because they have genuinely different lifecycles and merging them would mean one file where either half
can break the other.

| Mode | Component | What it does |
| --- | --- | --- |
| **A — One take** | `src/components/engineA/ContinuousEngine.jsx` | A single `requestAnimationFrame` loop composites webcam (top), a scrolling caption band (mid) and timed B-roll (bottom) onto a 720×1280 canvas piped straight into `MediaRecorder`. Auto-stops at `durationSeconds`. |
| **B — Scene by scene** | `src/components/engineB/SceneEngine.jsx` | Each scene records for exactly its `durationSeconds` → Blob URL. A Web Audio graph mixes voice, music, B-roll and narration; the stitched timeline is previewed, then the same loop is forked onto a hidden 1:1 canvas to compile one file. |

`/record/:id` picks the engine from `template.type`. The template JSON contract is the PRD's section 2.3
schema, with additive fields documented below.

## The canvas is the audience's view; the DOM is the talent's

This is the rule that keeps the product honest.

Anything drawn on a recording canvas ends up in the published video. So:

- **On the canvas:** the composite, on-screen title text, timed B-roll, and Mode A's caption band (which
  the PRD explicitly asks for).
- **In the DOM:** the scrolling prompt, the countdown/REC indicator, the input meter, the scene checklist.

Scene mode used to paint each scene's `instructions` onto the recording canvas, which published stage
direction to the audience along with a debug countdown. That's gone. A scene's `instructions` is now the
**prompt** (talent-only) and its `text` is the **output** (audience-facing), and the two are never
confused.

Mode A keeps its caption band because it's specified, but a creator can move it to a prompt-only overlay
with `continuousConfig.showScriptInOutput: false`, leaving the canvas clean.

The tests assert this by intercepting every `fillText` call on the page: the audience string must be
composited, and the prompt string must never touch a canvas.

## Prompts that keep pace

`src/lib/teleprompter.js` holds the shared maths — word counting, words-per-minute estimates, and the
canvas painter Mode A's caption band uses. `src/components/Teleprompter.jsx` is the DOM overlay the talent
reads: it scrolls from the same `startedAt` clock the engine times the clip with (so it cannot drift),
floats over the video or docks below, and centres short lines instead of stranding them in an empty box.

Pace is surfaced while the creator is writing, not after a bad take. A prompt that can't be read in its
slot reports its actual words-per-minute and publishing is blocked outright if a clip-by-clip narration
mode has a clip with nothing to say.

## Voice: three ways onto the timeline

`narration.mode` selects one:

| Mode | Behaviour |
| --- | --- |
| `live-mic` | Captured with the picture. In scene mode **every** clip captures it, not just camera scenes, so narration over a title card isn't silently dropped. |
| `clip-narration` | An audio-only take per clip, read while that clip replays. Retake one line without redoing the take. |
| `full-narration` | One audio-only take across the whole stitched timeline, with the full script scrolling in order. |

Compile gates on the narration actually existing — picture alone is not finished work in the last two.
Music ducks under dedicated narration (`narration.musicDuck`, default 0.35).

### Cleanup is a seam, not a dependency

`src/lib/audioCleanup.js` is built so a model you test elsewhere can replace the chain without either
engine changing:

1. **Browser capture constraints** — `noiseSuppression` (Chrome's in-built suppressor),
   `echoCancellation`, `autoGainControl`. Real-time, free, and the biggest quality win for on-device
   narration.
2. **A Web Audio chain** — rumble filter, optional mud cut, leveling compressor, makeup gain. Three
   presets, including a genuinely raw one so the difference is audible.

An `engine` id selects the implementation, and it's **recorded in each template's JSON**, so takes made
with the Web Audio chain stay reproducible after a second engine exists. Adding one is an entry in
`CLEANUP_ENGINES` plus an `AudioWorklet`; a model-based engine is already declared as unavailable.

`useLiveMic` builds the chain once per session and reuses the processed track for every clip, so a
three-clip video sounds like one recording. `useNarration` records the **processed** stream, so what the
input meter shows is what lands in the file.

### The graph gotcha worth knowing

A media element can only ever feed **one** `MediaElementSourceNode`. Recording a clip, retaking narration
or changing the background music therefore invalidates the whole Web Audio graph (`invalidateAudioGraph`),
which is rebuilt lazily with the new sources. Skip this and audio silently disappears after a re-record.

## B-roll assets

Every asset — studio library, upload, pasted link, provider download — goes through one pipeline,
`src/lib/assetIngest.js`:

1. resolve the source and check its **licence policy**;
2. download or accept the bytes;
3. store our own copy in the ephemeral bucket;
4. **prove it can be drawn** — load the stored URL, draw it, and read one pixel back.

Step 4 is the important one. A host without `Access-Control-Allow-Origin` still lets a file load and still
lets it draw, and *then* taints the canvas so `MediaRecorder` writes empty video. `getImageData` throws
`SecurityError` exactly when that happens, so a bad asset is refused with an explanation instead of ruining
a take. Nothing is ever hotlinked into a take.

Licence policy is **data**, not branches: `src/lib/brollProviders.js` describes each source with
`rehostPolicy` of `not-needed`, `allowed` (Pexels), `required` (Pixabay — hotlinking forbidden, a copy
mandatory) or `prohibited` (Unsplash, which is listed as disabled with the conflict explained rather than
half-built). Adding a provider is one registry entry plus one normalising adapter server-side.

The Studio Library in `public/library/` is **generated**, not sourced: `npm run library:build` renders it in
real Chrome via canvas + `MediaRecorder`, so it's first-party, CC0, CORS-free and deterministic.

Provider search needs one thin key-holding function (`supabase/functions/stock-search/`) because
third-party API keys are genuinely confidential, unlike the Supabase anon key. See
[`docs/SETUP-BROLL.md`](docs/SETUP-BROLL.md).

## The data layer is one seam

`src/lib/dataSource.js` is the only module any page imports for persistence. It returns:

- `src/lib/mockBackend.js` — localStorage with the same 7-day TTL semantics, and the default. This is why
  the whole product is usable and testable with zero configuration.
- `src/lib/supabaseBackend.js` — lazily `import()`ed only when keys exist, so the mock bundle stays clean.

Going live is an environment-variable change with no component edits. The Supabase anon key is public by
design and Row Level Security is the security boundary, so there's no proxy in the default path.

## Routes

- `/` — overview
- `/create` — the creator template builder
- `/record/:id` — the Magic Link destination; the engine is chosen by `template.type`

`HashRouter` is used so GitHub Pages can host this as static files with no 404 rewrite shim.

## Testing

Playwright runs the full suite in **both** a headless and a headed Chrome session, with fake camera and
microphone devices:

```bash
npm test              # local dev server, both Chrome projects
npm run test:headless # chrome-headless only
npm run test:headed   # chrome-headed only (needs a display)

npm run test:prod     # against the live deploy, no dev server
```

Coverage spans creation (both modes, prompts and pace, narration config, the B-roll picker, validation),
the picker's licence and canvas-taint guards, and filling (one-take recording; scene record → narrate →
preview → compile). Tests assert **real recorded byte counts** rather than mocked success, and the
prompt/canvas split is asserted by intercepting `fillText` on the page.

> Headless Chrome is what runs in CI and gates the deploy. The headed project is a local-only check for the
> on-screen path and needs a display.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`: it runs the headless suite, builds with
`VITE_BASE=/<repo>/`, and publishes to GitHub Pages. Supabase values come from repository **Variables**
(they're public-safe) — see [`docs/SETUP-SUPABASE.md`](docs/SETUP-SUPABASE.md).

## Additive schema fields

On top of the PRD's section 2.3 contract, the template JSON carries:

| Field | Where | Why |
| --- | --- | --- |
| `narration` | top level | `{ mode, cleanup: { engine, preset }, musicDuck }` — how voice reaches the timeline and which engine cleaned it. |
| `assetCredits` | top level | Provenance and licence for every third-party asset the template actually uses, so the obligation travels with the template. Engines ignore it. |
| `continuousConfig.showScriptInOutput` | Mode A | Whether the script is a caption band in the composite or a talent-only prompt. |
