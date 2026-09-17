# Directorr - Master Developer Document

This document serves as the single source of truth for "Directorr", a client-side video creation platform. It contains the Product Requirements Document (PRD), Technical Implementation Guide, Developer Task List, and AI Agent Context (`agents.md`).

---

## 1. Product Requirements Document (PRD)

### 1.1 Product Vision
To reduce short-form video creation from a tedious editing task to a guided, 5-minute automated workflow. Directorr provides creators with a way to distribute strict video templates via a "Magic Link", allowing end-users to record perfectly timed, pre-composited content with zero post-production required.

### 1.2 The Problem
Professionals and marketing teams need high volumes of short-form video (TikTok, Reels, Shorts). Creating this requires scripting, filming, transferring, editing, adding B-roll, mixing audio, and exporting. Existing tools are too complex (Premiere) or create friction that leads to dropped projects.

### 1.3 The Solution
A web-based platform with two distinct recording modes driven by JSON templates:

*   **Mode A: Continuous (Teleprompter):** A one-take recording where the user reads a scrolling teleprompter. The app composites their webcam, the captions, and the creator's timed assets (B-roll/images) in real-time. The MP4 is ready the second they hit stop.
*   **Mode B: Scene-by-Scene (Storyboard):** A guided checklist where users record distinct clips with strict, pre-defined timers. Users can adjust audio levels, preview the live stitched result, and compile a single MP4 without ever seeing an editing timeline.

### 1.4 Target Audience
*   **Template Creators:** Content strategists designing scripts, scene formulas, and uploading B-roll assets.
*   **End Users:** Non-technical professionals (sales, real estate, executives) fulfilling the video requirements from their phones.

### 1.5 Core Features & Requirements
*   **Magic Link Routing:** URLs fetch a JSON configuration from the database determining the mode and assets.
*   **HTML5 Canvas Rendering:** All video, text, and media are drawn to an HTML5 `<canvas>` and captured via `MediaRecorder` at 30fps.
*   **Ephemeral Asset Hosting:** Free, unauthenticated image/video upload for creators. Assets must be publicly accessible but automatically purged after 7 days to minimize hosting liability.
*   **Mode A Specifics:** Split-screen layout, real-time compositing, sync'd teleprompter/captions.
*   **Mode B Specifics:** Scene checklist UI, Web Audio API mixing (mic, background music, B-roll), live preview, and a 1:1 post-record hidden canvas compiler.
*   **Native Share:** Direct handoff to TikTok, Instagram, etc., via `navigator.share()`.

### 1.6 Out of Scope (YAGNI)
*   Visual Drag-and-Drop Editor (Canva-style) or Clip Trimming UI.
*   Real-time AI Audio Transcription (Whisper/etc.).
*   Backend Video Rendering (`ffmpeg.wasm` / server-side stitching).
*   Permanent asset management or complex user authentication.

---

## 2. Implementation Guide

### 2.1 Tech Stack
*   **Frontend:** React (Vite), React Router.
*   **State Management:** Zustand (critical for managing multiple recorded Blobs) or React Context.
*   **Video Engine:** HTML5 `<canvas>`, `requestAnimationFrame`.
*   **Audio Engine:** Web Audio API (`AudioContext`, `GainNode`).
*   **Storage/Database:** Supabase (Postgres for JSON templates, Storage for 7-day ephemeral assets).
*   **Deployment:** GitHub Pages or Netlify.

### 2.2 System Architecture
To avoid complexity, the core rendering logic is split into two distinct React engines based on `template.type`.

1.  **Shared Layer:** Supabase fetcher, WebRTC Camera permissions, UI Shell.
2.  **Engine A (Continuous):** Pre-loads assets into memory. On record, runs a `requestAnimationFrame` loop that composites the webcam, scrolling text, and timed B-roll directly onto a canvas, piping it immediately into a `MediaRecorder`.
3.  **Engine B (Scene):** Records individual scenes as temporary browser `Blob` URLs. Uses an `AudioContext` graph for volume mixing. Runs a canvas loop to playback scenes sequentially for the "Preview", and forks that exact same loop onto a hidden canvas for the final "Compile" into a `MediaRecorder`.

### 2.3 The Template JSON Schema
```json
{
  "id": "uuid-1234",
  "title": "My Template",
  "type": "continuous", 
  "durationSeconds": 30,
  "continuousConfig": {
    "script": "Welcome to this week's update...",
    "theme": { "font": "Arial", "textColor": "#FFFFFF", "backgroundColor": "#1A1A2E" },
    "bottomTrack": [
      { "type": "image", "url": "https://storage.supabase.com/ephemeral/img_123.jpg", "startTime": 0.0, "endTime": 15.0 }
    ]
  },
  "sceneConfig": {
    "backgroundMusicUrl": "https://storage.supabase.com/ephemeral/upbeat.mp3",
    "defaultMix": { "musicVolume": 0.3, "voiceVolume": 1.0, "brollOriginalAudio": 0.0 },
    "scenes": [
      { "id": "scene-1", "type": "title-slide", "durationSeconds": 3.0, "text": "Welcome!" },
      { "id": "scene-2", "type": "camera", "durationSeconds": 5.0, "instructions": "Introduce yourself." }
    ]
  }
}
```
*(Note: Only one config object is populated based on the `type` discriminator).*

### 2.4 Ephemeral Storage Strategy
To allow the Web Audio API and Canvas to manipulate media without CORS tainting, all media is served from a Supabase Storage bucket (`ephemeral_assets`) with public access. A `pg_cron` script auto-deletes assets older than 7 days.

---

## 3. Developer Task List

### Phase 1: Environment & Scaffolding
- [ ] Initialize Vite React project (`npm create vite@latest`).
- [ ] Set up React Router (`/`, `/create`, `/record/:id`).
- [ ] Configure Supabase Postgres schema (`templates` table: `id`, `created_at`, `json_data`).
- [ ] Configure Supabase Storage bucket (`ephemeral_assets`) with public read and IP-restricted upload.
- [ ] Implement `pg_cron` auto-delete function for 7-day TTL in Supabase.
- [ ] Set up Zustand store for app state.

### Phase 2: Engine A (Continuous Mode)
- [ ] Build the Continuous UI view.
- [ ] Implement WebRTC capture.
- [ ] Implement the `requestAnimationFrame` loop (Top: Webcam, Mid: Scrolling Text, Bot: Timed Assets).
- [ ] Implement media pre-loader to ensure assets are ready before recording starts.
- [ ] Pipe Canvas + Audio to `MediaRecorder` and output to MP4/WebM.

### Phase 3: Engine B (Scene Mode)
- [ ] Build the Scene Checklist UI.
- [ ] Implement strict auto-stop recording logic (save as Blob URLs).
- [ ] Create Web Audio API routing graph (`GainNode`s for Mic, BGM, B-roll).
- [ ] Build the Canvas Preview loop (sequential playback based on timeline).
- [ ] Build the 1:1 Hidden Compiler (pipes Preview loop + AudioContext to `MediaRecorder`).

### Phase 4: Shared Features & Export
- [ ] Implement UI for volume sliders mapping to global state (for Scene Mode).
- [ ] Implement `navigator.share()` API handling the compiled `File` object.
- [ ] Add fallback download button (`URL.createObjectURL()`) for desktop browsers.

### Phase 5: Creator Setup UI
- [ ] Build `/create` view with a toggle for "Continuous" vs "Scene" mode.
- [ ] Implement Ephemeral Storage uploader with Terms of Service / 7-day deletion warning.
- [ ] Generate JSON schema and POST to Supabase, returning the Magic Link.

---

## 4. `agents.md`

```markdown
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
- Framework: React (Vite), React Router
- State: Zustand (preferred)
- Styling: Plain CSS or Tailwind (keep it minimal)
- Backend: Supabase (Postgres for JSON, Storage for assets)

## When Generating Code
- Provide complete, self-contained functional components or hooks. Do not output partial snippets unless asked.
- Include heavy logging (e.g., `console.log('[ContinuousEngine] Drawing B-roll frame at sec 12')`) to ensure the rendering timeline can be easily debugged in the console.
- Handle state cleanup explicitly (revoke ObjectURLs, stop AudioContexts, clear Animation Frames) to prevent memory leaks on mobile devices.
```
```

Let me know if this looks good to you, or if you want to tweak the JSON structure or flow before we start generating the code components!