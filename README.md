# Directorr

Directorr provides creators with a way to distribute strict video templates via a "Magic Link", allowing
end-users to record perfectly timed, pre-composited content with zero post-production required.

Everything renders **client-side** — canvas + `requestAnimationFrame` + `MediaRecorder`. There is no
backend video compute.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5180
```

That is the entire setup. **Supabase is not required** — with no keys configured the app uses a local
mock backend (templates and assets in `localStorage`, 7-day TTL). To go live, see
[`docs/SETUP-SUPABASE.md`](docs/SETUP-SUPABASE.md).

## The two recording engines

| Mode | Component | What it does |
| --- | --- | --- |
| **A — Continuous** | `src/components/engineA/ContinuousEngine.jsx` | One take. A single rAF loop composites webcam (top), scrolling teleprompter (mid) and timed B-roll (bottom) onto a 720×1280 canvas piped straight into `MediaRecorder`. Auto-stops at the template duration. |
| **B — Scene by scene** | `src/components/engineB/SceneEngine.jsx` | Strict per-scene timers → Blob URLs. A Web Audio graph mixes voice/music/B-roll; the stitched timeline is previewed, then the same loop is forked onto a hidden 1:1 canvas to compile one file. |

## Routes

- `/` — overview
- `/create` — the creator template builder (both modes, ephemeral uploads, Magic Link output)
- `/record/:id` — the Magic Link destination; the engine is chosen by `template.type`

`HashRouter` is used so GitHub Pages can host this as pure static files with no 404 rewrite shim.

## Testing

Playwright runs the full suite in **both** a headless and a headed Chrome session, with fake camera and
microphone devices:

```bash
npm test              # local dev server, both Chrome projects
npm run test:headless # chrome-headless only
npm run test:headed   # chrome-headed only (needs a display)

# Against the live deploy (no dev server, real GitHub Pages artifact):
npm run test:prod     # override with PROD_URL=https://... npm run test:prod
```

Coverage spans template **creation** (both modes, upload, validation) and template **filling** (one-take
continuous recording; scene record → preview → compile), asserting real recorded byte counts rather than
mocked success.

> Headless Chrome is what runs in CI and gates the deploy. The headed project is a local-only check for
the on-screen path.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`: it runs the headless suite, builds with
`VITE_BASE=/<repo>/`, and publishes to GitHub Pages. Supabase values come from repository **Variables**
(they are public-safe). See the setup doc for why no Cloudflare Worker belongs in this stack.

## Project docs

- [`agents.md`](agents.md) — context and conventions for AI agents working in this repo
- [`todo.md`](todo.md) — task list and status
- [`history.md`](history.md) — build history
- [`docs/SETUP-SUPABASE.md`](docs/SETUP-SUPABASE.md) — Supabase, keys, secrets, and layering guidance
- [`PRD-Directorr.v2.md`](PRD-Directorr.v2.md) — the source-of-truth spec
