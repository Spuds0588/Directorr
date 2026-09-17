import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_PROMPT_THEME, countWords, paceFor } from '../lib/teleprompter.js';

const CANVAS_W = 720;

/**
 * The talent's prompt, as DOM rather than canvas.
 *
 * This is deliberately NOT part of the composite. A prompt tells the person on
 * camera what to say; it is not a caption for the audience, and burning it into
 * the recording (as the scene engine used to) publishes stage direction to
 * TikTok. Keeping it in the DOM makes that impossible by construction — and it
 * renders crisper than 720px-wide canvas text anyway.
 *
 * Scroll position is driven from the same `startedAt` clock the engine times its
 * clip with, so the prompt cannot drift away from the take.
 */
export default function Teleprompter({
  text,
  durationSeconds = 0,
  active = false,
  startedAt = null,
  theme = {},
  position = 'overlay',
  onPositionChange,
  label = 'Read this',
}) {
  const viewportRef = useRef(null);
  const textRef = useRef(null);
  const [scale, setScale] = useState(1);

  const style = { ...DEFAULT_PROMPT_THEME, ...theme };

  // Match the prompt's type size to how big the preview is actually drawn, so a
  // 44px prompt on a 720px canvas looks the same as one on a phone.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => setScale(Math.min(1, Math.max(0.4, el.clientWidth / CANVAS_W)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = textRef.current;
    const viewport = viewportRef.current;
    if (!el || !viewport) return undefined;

    const apply = (progress) => {
      const max = Math.max(0, el.scrollHeight - viewport.clientHeight);
      // A short line has nothing to scroll, so centre it on the guide instead of
      // stranding it at the top of an empty box.
      viewport.classList.toggle('fits', max <= 1);
      el.style.transform = `translateY(${(-progress * max).toFixed(2)}px)`;
    };

    if (!active) {
      apply(0);
      return undefined;
    }

    let raf;
    const tick = () => {
      const elapsed = startedAt ? (performance.now() - startedAt) / 1000 : 0;
      const progress = durationSeconds > 0 ? Math.min(1, elapsed / durationSeconds) : 0;
      apply(progress);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, startedAt, durationSeconds, text]);

  const words = countWords(text);
  const pace = paceFor(text, durationSeconds);

  return (
    <section className={`teleprompter ${position}`} data-testid="teleprompter">
      <div className="prompt-head">
        <span className="prompt-label" data-testid="teleprompter-label">
          {label}
        </span>
        <span className="asset-meta" data-testid="teleprompter-pace">
          {text
            ? `${words} word${words === 1 ? '' : 's'} · ${Math.round(pace.targetWpm)} wpm${pace.verdict === 'fast' ? ' ⚠ too fast' : ''}`
            : 'no prompt'}
        </span>
        {onPositionChange ? (
          <button
            type="button"
            className="ghost"
            data-testid="teleprompter-position"
            onClick={() => onPositionChange(position === 'overlay' ? 'docked' : 'overlay')}
          >
            {position === 'overlay' ? 'Dock below' : 'Float over video'}
          </button>
        ) : null}
      </div>

      <div className="prompt-viewport" ref={viewportRef} data-testid="teleprompter-viewport">
        <p
          className="prompt-text"
          ref={textRef}
          data-testid="teleprompter-text"
          style={{
            fontFamily: `${style.font}, sans-serif`,
            fontSize: `${style.fontSize * scale}px`,
            color: style.textColor,
          }}
        >
          {text || 'No prompt for this clip.'}
        </p>
        <div className="prompt-guide" aria-hidden="true" />
      </div>
    </section>
  );
}
