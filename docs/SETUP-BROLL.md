# Directorr — B-roll sources, licences, and keys

The creator editor has one B-roll picker (`src/components/AssetPicker.jsx`) with four sources. Three of
them need **no keys, no server, and no configuration** — they work in the deployed build today. The
fourth is the optional stock-provider layer.

| Tab | Source id | Key needed | Where the file ends up |
| --- | --- | --- | --- |
| **Studio library** | `studio` | none | `public/library/` on our own origin — never expires |
| **Upload** | `upload` | none | `ephemeral_assets/creator-uploads/` — 7-day TTL |
| **Paste URL** | `url` | none | `ephemeral_assets/imported/` — 7-day TTL |
| **Stock providers** | `pexels`, `pixabay` | yes | `ephemeral_assets/stock/<provider>/` — 7-day TTL |

---

## 1. The constraint that decides everything: canvas tainting

Every asset is composited with `ctx.drawImage()` onto a canvas that feeds `MediaRecorder`
(`ContinuousEngine`, `SceneEngine`). If a remote file's host does not send
`Access-Control-Allow-Origin`, the browser still loads it and still draws it — and the canvas becomes
**tainted**. `MediaRecorder` then produces empty or black video, and you only find out after the take.

So the rule in `agents.md` — *only load media from our verified storage* — is not stylistic. Two
consequences:

1. **Hotlinking is never used for canvas assets.** Thumbnails in the picker are hotlinked (that is
   legal and cheap); the asset that actually gets recorded is always our own copy.
2. **Every candidate is proven drawable before it is accepted.** `probeDrawableMedia()` in
   `src/lib/mediaUtils.js` loads the stored URL, draws it, and reads one pixel back. `getImageData`
   throws `SecurityError` exactly when the canvas is tainted, so a bad asset is rejected with an
   explanation instead of ruining a recording.

## 2. Licences disagree, so policy is data

`src/lib/brollProviders.js` describes each source. The field that matters is `rehostPolicy`:

| Value | Meaning | Handled by |
| --- | --- | --- |
| `not-needed` | First-party: `studio`, `upload` | used in place |
| `allowed` | Re-hosting permitted, credit appreciated: **Pexels** | copied into the bucket |
| `required` | Permanent hotlinking **forbidden**, a copy is mandatory: **Pixabay** | copied into the bucket |
| `prohibited` | Copies forbidden, hotlinking mandatory: **Unsplash** | source is disabled, with the reason shown in the UI |

That third row is why a single "just hotlink everything" strategy cannot work across providers — and
why our ephemeral bucket turns out to be the right container for all of them: the copy kills CORS as a
variable, satisfies Pixabay, and inherits the 7-day TTL you already have.

**Unsplash is deliberately not offered.** Its API guidelines require hotlinking and state that keys
"must remain confidential… this may require using a proxy", while Directorr must store a copy to
composite the frame. Rather than ship something that silently breaks takes, the provider is listed as
disabled with that explanation visible to the creator. If you want Unsplash imagery, add it to the
Studio library as a properly licensed file.

## 3. Adding a provider

Two edits, no UI changes:

1. Append an entry to `SOURCES` in `src/lib/brollProviders.js` (label, blurb, `kinds`, `keyName`,
   `rehostPolicy`, `license`, `attribution`, `rateLimit`). The picker renders whatever it finds there.
2. Add a normalising adapter to `supabase/functions/stock-search/index.ts` that returns the contract
   documented at the top of that file. Keep vendor quirks in the adapter, never in the app.

## 4. Keys: where they go and where they must never go

Provider keys are **not** public-safe, unlike the Supabase anon key. They belong in exactly one place —
Supabase's secret store, read by the edge function:

```bash
supabase secrets set PEXELS_API_KEY=... PIXABAY_API_KEY=...
```

Never in `.env`, never in a `VITE_*` variable, never in GitHub, never in this repo. Anything prefixed
`VITE_` is compiled into the public bundle.

### Deploy the one function

```bash
supabase functions deploy stock-search --no-verify-jwt
```

Then point the app at it. Locally, add to `.env`:

```
VITE_STOCK_SEARCH_ENDPOINT=https://<project-ref>.supabase.co/functions/v1/stock-search
```

(An endpoint URL is not a secret, which is why it is safe to ship.)

### GitHub Actions

**Settings → Secrets and variables → Actions → Variables**:

| Name | Type | Value |
| --- | --- | --- |
| `VITE_STOCK_SEARCH_ENDPOINT` | Variable | the deployed function URL |

The workflow already passes `vars.VITE_STOCK_SEARCH_ENDPOINT` into the build. Leave it unset and the
providers tab simply reports "Search endpoint: not configured" — nothing else regresses.

The app reports the state honestly: open **Stock providers** and look at the status line under the tab.
No endpoint means the search buttons stay disabled and the reason is on screen.

## 5. The Studio library (the zero-key path)

```bash
npm run library:build      # regenerates public/library/ and its manifest
```

`scripts/build-library.mjs` renders the artwork in real Chrome via Playwright's canvas +
`MediaRecorder` — the same APIs the app records with — and writes:

- six `studio-*.jpg` stills (1280×720, ~300 KB total)
- three `studio-*.webm` loops (1280×720, 4 s, ~490 KB total) plus `.poster.jpg` thumbnails
- `manifest.json`, which the picker loads

They are generated rather than sourced so they are guaranteed same-origin, licence-clean (CC0, no
attribution obligation), and deterministic. Output is committed; re-run the script only when the
artwork changes.

Adding your own first-party asset is just dropping a file in `public/library/` and appending an entry
to the manifest.

## 6. Operating notes

- **Size.** The picker caps an imported file at 15 MB (`MAX_INGEST_BYTES`). Prefer 1080p; the composite
  is 720×1280, so 4K only costs storage and encode time.
- **Storage cost.** Re-hosted files live for 7 days and are purged by the `pg_cron` job in
  `docs/SETUP-SUPABASE.md`. B-roll is the biggest thing you will ever put in the bucket.
- **Rate limits.** Pexels: 200 requests/hour. Pixabay: 100 requests/minute (and Pixabay requires you to
  cache responses — the function caches for 5 minutes).
- **Small, trusted creator group** is the PRD assumption. Prefer the Studio library for recurring
  templates: it is instant, free, never expires, and cannot break a take.
- **Model releases.** Stock footage and photos usually carry none, and end users *publish* these videos
  commercially. Prefer abstract, texture, and landscape B-roll over clips with recognisable people.
- **Search is not a download farm.** Both providers forbid systematic mass downloading. Fetch what a
  template needs.

## 7. What NOT to do

- ❌ Do not put a provider key in a `VITE_*` variable or GitHub — it ships to the browser.
- ❌ Do not hotlink a remote file into `bottomTrack` or a B-roll scene; it can taint the canvas.
- ❌ Do not add a Cloudflare Worker for search — the Supabase function is the same vendor you already
  have, so it adds no account, no second secret store, and no extra origin.
- ❌ Do not disable the drawability probe to "make a provider work". Fix the provider's download URL
  instead.
