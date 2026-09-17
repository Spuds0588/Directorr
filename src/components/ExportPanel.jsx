import { useState } from 'react';
import { useAppStore } from '../store/useAppStore.js';
import { formatBytes } from '../lib/mediaUtils.js';

/**
 * Post-record actions: native share handoff (PRD 1.5) with a download fallback
 * for desktop browsers where navigator.share is unavailable.
 */
export default function ExportPanel() {
  const output = useAppStore((s) => s.output);
  const clearOutput = useAppStore((s) => s.clearOutput);
  const [shareMessage, setShareMessage] = useState('');

  if (!output) return null;

  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';

  async function handleShare() {
    try {
      const file = new File([output.blob], output.name, { type: output.mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Directorr video' });
        setShareMessage('Shared.');
      } else {
        setShareMessage('This device cannot share files — use Download instead.');
      }
    } catch (error) {
      console.warn('[ExportPanel] share cancelled/failed', error);
      setShareMessage('Share cancelled.');
    }
  }

  return (
    <section className="card" data-testid="output-panel">
      <h2>Your video is ready</h2>
      <p className="lead">
        {output.mode === 'scene' ? 'Stitched from all scenes' : 'Recorded in one take'} — no editing required.{' '}
        <span data-testid="output-size" data-bytes={output.size}>
          {formatBytes(output.size)}
        </span>
      </p>
      {output.url ? (
        <video
          data-testid="output-video"
          src={output.url}
          controls
          playsInline
          style={{ width: '100%', maxWidth: 320, borderRadius: 12, border: '1px solid var(--border)', background: '#000' }}
        />
      ) : null}
      <div className="row" style={{ marginTop: 14 }}>
        <a
          className="button-like"
          data-testid="download-link"
          href={output.url}
          download={output.name}
          style={{ textDecoration: 'none' }}
        >
          <button type="button" className="secondary">
            Download {output.name}
          </button>
        </a>
        {canShare ? (
          <button type="button" data-testid="share-button" onClick={handleShare}>
            Share to socials
          </button>
        ) : null}
        <div className="spacer" />
        <button type="button" className="ghost" data-testid="record-again" onClick={clearOutput}>
          Record again
        </button>
      </div>
      {shareMessage ? <p className="status" data-testid="share-message">{shareMessage}</p> : null}
    </section>
  );
}
