import { Link } from 'react-router-dom';
import { isSupabaseConfigured } from '../lib/dataSource.js';

export default function Home() {
  return (
    <>
      <section className="card">
        <h1>Perfectly timed video, zero post-production</h1>
        <p className="lead">
          Directorr turns a script into a strict, guided recording. Send one Magic Link — your talent records,
          the app composites captions, B-roll and audio in real time, and the finished file is ready the second
          they hit stop.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link to="/create" data-testid="cta-create" style={{ textDecoration: 'none' }}>
            <button type="button">Create a template</button>
          </Link>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Mode A — Continuous</h2>
          <p>
            One take. A scrolling teleprompter keeps the script on pace while your webcam and timed B-roll are
            composited onto a single canvas. Stop the take and the video already exists.
          </p>
        </section>
        <section className="card">
          <h2>Mode B — Scene by Scene</h2>
          <p>
            A guided checklist with strict per-scene timers. Record a clip, watch the live stitched preview, then
            compile everything into one file without ever seeing a timeline.
          </p>
        </section>
      </div>

      <section className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Creator designs a template and uploads B-roll.</li>
          <li>Directorr mints a Magic Link that carries the whole JSON configuration.</li>
          <li>The end-user opens the link on their phone and follows the prompts.</li>
          <li>Everything renders client-side — share straight to TikTok, Reels or Shorts.</li>
        </ol>
      </section>

      {!isSupabaseConfigured ? (
        <section className="card">
          <p className="notice" data-testid="mock-notice">
            Supabase is not configured yet, so this build stores templates and assets locally in your browser
            (7-day TTL). See <code>docs/SETUP-SUPABASE.md</code> to go live — no code changes needed.
          </p>
        </section>
      ) : null}
    </>
  );
}
