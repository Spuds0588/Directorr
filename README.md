# Directorr

### **[▶ Open the live app →](https://spuds0588.github.io/Directorr/)**

Send a link. Get back a finished, perfectly timed video. No editing, no app install, no account.

---

## The problem

You need video from someone else. You write them a script, or a rough brief, and then you wait. What comes
back is the wrong length, shot in a hurry, talks over the beat they were supposed to hit, and now someone
has to open an editor and make it work. Every single time.

Editing isn't the hard part. **Getting a usable first take is.**

## What Directorr does

You build the template once — the script, the pacing, the on-screen text, the B-roll, the voice — and get
one **Magic Link**.

Whoever's on camera opens that link in a browser. They see a **scrolling prompt telling them exactly what
to say**, at the speed they need to say it. They hit record. The take **stops itself** at the right moment,
clip after clip. What comes out the other end is a finished vertical video, already composited, ready for
TikTok, Reels or Shorts.

Nobody opens an editor. There's nothing to trim, because nothing was the wrong length.

## Why it feels effortless

**The prompt does the work.** It scrolls in step with the take and it's paced to the clip, so the person on
camera is never guessing. Write 27 words into a 2-second slot and Directorr tells *you* `810 wpm — too
fast` while you're still writing it, not after a ruined take.

**Timing can't drift.** Every clip runs exactly as long as the template says. No "hold on, let me start
over", no picking the best of nine takes, no trimming at the end.

**They can see themselves doing it.** The preview shows precisely what's being recorded, so the person on
camera is never staring at a blank box wondering how they look.

**Talking over a title card is fine.** Voice can be recorded live with the picture, or as clean audio-only
takes — one per clip, or a single take across the whole finished video. Read one line, retake only that
line, keep the rest.

**B-roll without a stock subscription.** A built-in library of nine licence-free stills and loops works
instantly, plus your own uploads, any direct link, and optional Pexels/Pixabay search. Music ducks under
narration so you don't have to guess a level.

## Two ways to shoot

| | Best for | How it feels |
| --- | --- | --- |
| **One take** | Talking-head updates, announcements | A single continuous recording with the webcam, a scrolling script band and timed B-roll, all composited as they record. |
| **Scene by scene** | Anything scripted beat by beat | A checklist of clips. Each one runs for exactly its allotted seconds, then the full timeline is stitched into one file. |

## Your video never leaves your device

This isn't a marketing line, it's how it's built:

- **The video is composited in your browser** and handed straight to your share sheet or downloads folder.
  It is never uploaded anywhere.
- **No accounts, no login, no email.** A Magic Link is just a URL pointing at your template.
- **B-roll you add is public and auto-deleted after 7 days.** Never upload anything confidential; the
  template builder tells you the same thing before you do.
- **No analytics in the app.** Nothing phones home while you record.

## Status

Honest about where things stand:

- **The live demo runs without a database.** Templates are kept in your own browser, so a Magic Link works
  for you but won't travel to another device until a Supabase project is connected — two environment
  variables, [instructions here](docs/SETUP-SUPABASE.md).
- **B-roll**: the studio library, uploads and pasted links all work today. Pexels/Pixabay search is built
  but needs one small function deployed with your provider keys — see
  [B-roll setup](docs/SETUP-BROLL.md).
- **Chrome and Chromium-based browsers** are the target. Recording uses `MediaRecorder`, so MP4 vs WebM
  output depends on the browser.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5180
```

That's the whole setup — no keys, no services, no database. It runs fully on your machine.

```bash
npm test             # Playwright, headless + headed Chrome
npm run test:prod    # the same checks against the live deployment
```

## Open source

MIT licensed. Directorr is built in the open because a tool that records people on camera should be
inspectable — you can read exactly what it does with your footage, and the answer is "nothing, it stays on
your machine".

It's also just nicer this way. If something's missing, an issue or a PR is welcome. There's no roadmap
theatre and no waitlist.

## Documentation

- **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** — architecture and the technical decisions behind it
- [`docs/SETUP-SUPABASE.md`](docs/SETUP-SUPABASE.md) — make Magic Links shareable across devices
- [`docs/SETUP-BROLL.md`](docs/SETUP-BROLL.md) — B-roll sources, licences and provider keys
- [`agents.md`](agents.md) — conventions for AI agents and contributors working in this repo
- [`history.md`](history.md) — build history, decisions and known gaps
- [`todo.md`](todo.md) — what's shipped and what isn't
- [`PRD-Directorr.v2.md`](PRD-Directorr.v2.md) — the original spec
