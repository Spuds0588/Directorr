import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchTemplate } from '../lib/dataSource.js';
import ContinuousEngine from '../components/engineA/ContinuousEngine.jsx';
import SceneEngine from '../components/engineB/SceneEngine.jsx';
import ExportPanel from '../components/ExportPanel.jsx';
import { useAppStore } from '../store/useAppStore.js';

/**
 * The Magic Link destination. It resolves the template id to its JSON config and
 * hands off to the engine dictated by `template.type`.
 */
export default function Record() {
  const { id } = useParams();
  const [template, setTemplate] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState(null);
  const clearOutput = useAppStore((s) => s.clearOutput);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    clearOutput();
    fetchTemplate(id)
      .then((data) => {
        if (!active) return;
        if (data) {
          console.log('[Record] template loaded', { id, type: data.type });
          setTemplate(data);
          setStatus('ready');
        } else {
          setStatus('missing');
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('[Record] failed to load template', err);
        setError(err.message);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [id, clearOutput]);

  if (status === 'loading') {
    return (
      <section className="card">
        <h1>Loading template…</h1>
        <p data-testid="record-loading">Fetching the recording configuration.</p>
      </section>
    );
  }

  if (status === 'missing') {
    return (
      <section className="card">
        <h1>Link not found</h1>
        <p className="error" data-testid="record-missing">
          This Magic Link has no template behind it, or it expired (assets and templates live for 7 days).
        </p>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section className="card">
        <h1>Something went wrong</h1>
        <p className="error" data-testid="record-error">{error}</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h1 data-testid="record-title">{template.title}</h1>
        <p>
          Mode: <strong data-testid="record-mode">{template.type === 'scene' ? 'Scene by scene' : 'Continuous'}</strong>{' '}
          — {template.durationSeconds}s total. Everything is recorded and composited in your browser.
        </p>
      </section>

      {template.type === 'scene' ? <SceneEngine template={template} /> : <ContinuousEngine template={template} />}

      <ExportPanel />
    </>
  );
}
