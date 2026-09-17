import { useState } from 'react';
import { createTemplate, uploadAsset, buildMagicLink } from '../lib/dataSource.js';
import { buildContinuousTemplate, buildSceneTemplate, validateTemplate, SCENE_TYPES } from '../lib/templateSchema.js';
import { formatBytes } from '../lib/mediaUtils.js';
import { useAppStore } from '../store/useAppStore.js';

let sceneSeq = 0;
const newScene = (overrides = {}) => ({
  id: `scene-${Date.now()}-${(sceneSeq += 1)}`,
  type: 'camera',
  durationSeconds: 5,
  instructions: '',
  text: '',
  assetUrl: '',
  ...overrides,
});

export default function Create() {
  const [mode, setMode] = useState('continuous');
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [duration, setDuration] = useState(30);
  const [scenes, setScenes] = useState([
    newScene({ type: 'title-slide', durationSeconds: 3, text: 'Welcome!' }),
    newScene({ type: 'camera', durationSeconds: 5, instructions: 'Introduce yourself.' }),
  ]);

  const assets = useAppStore((s) => s.assets);
  const addAsset = useAppStore((s) => s.addAsset);
  const removeAsset = useAppStore((s) => s.removeAsset);
  const magicLink = useAppStore((s) => s.magicLink);
  const setMagicLink = useAppStore((s) => s.setMagicLink);

  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        // Ignore files with no usable type.
        const asset = await uploadAsset(file, { folder: 'creator-uploads' });
        addAsset(asset);
      }
    } catch (err) {
      console.error('[Create] upload failed', err);
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  const updateScene = (index, patch) =>
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));

  const removeScene = (index) => setScenes((prev) => prev.filter((_, i) => i !== index));

  function buildPayload() {
    const mediaAssets = assets.filter((a) => !a.type.startsWith('audio'));
    const audioAssets = assets.filter((a) => a.type.startsWith('audio'));
    const safeDuration = Math.max(1, Number(duration) || 30);

    if (mode === 'continuous') {
      const bottomTrack = mediaAssets.map((asset, i) => {
        const slot = safeDuration / Math.max(1, mediaAssets.length);
        return {
          type: asset.type.startsWith('image') ? 'image' : 'video',
          url: asset.url,
          startTime: Number((i * slot).toFixed(2)),
          endTime: Number(((i + 1) * slot).toFixed(2)),
        };
      });
      return buildContinuousTemplate({ title, durationSeconds: safeDuration, script, bottomTrack });
    }

    return buildSceneTemplate({
      title,
      scenes: scenes.map((scene) => ({ ...scene, assetUrl: scene.assetUrl || mediaAssets[0]?.url || '' })),
      backgroundMusicUrl: audioAssets[0]?.url || '',
    });
  }

  async function publish(event) {
    event.preventDefault();
    setError(null);
    setCopied(false);
    const payload = buildPayload();
    const errors = validateTemplate(payload);
    if (!title.trim()) errors.unshift('Give the template a title.');
    if (mode === 'continuous' && !script.trim()) errors.push('Add a teleprompter script.');
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    setPublishing(true);
    try {
      const { id } = await createTemplate(payload);
      setMagicLink(buildMagicLink(id));
      console.log('[Create] template published', id);
    } catch (err) {
      console.error('[Create] publish failed', err);
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(magicLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section className="card">
        <h1>New template</h1>
        <p>Design the recording once, then share one Magic Link. Your talent never touches an editor.</p>

        <form onSubmit={publish}>
          <label htmlFor="title">Template title</label>
          <input
            id="title"
            data-testid="create-title"
            type="text"
            value={title}
            placeholder="Weekly sales update"
            onChange={(e) => setTitle(e.target.value)}
          />

          <label>Recording mode</label>
          <div className="mode-toggle">
            <button
              type="button"
              data-testid="mode-continuous"
              className={mode === 'continuous' ? 'active' : ''}
              onClick={() => setMode('continuous')}
            >
              Mode A — Continuous
              <small>One take with a scrolling teleprompter.</small>
            </button>
            <button
              type="button"
              data-testid="mode-scene"
              className={mode === 'scene' ? 'active' : ''}
              onClick={() => setMode('scene')}
            >
              Mode B — Scene by scene
              <small>Strict timers per clip, stitched automatically.</small>
            </button>
          </div>

          {mode === 'continuous' ? (
            <>
              <label htmlFor="script">Teleprompter script</label>
              <textarea
                id="script"
                data-testid="create-script"
                value={script}
                placeholder="Welcome to this week's update..."
                onChange={(e) => setScript(e.target.value)}
              />
              <label htmlFor="duration">Total duration (seconds)</label>
              <input
                id="duration"
                data-testid="create-duration"
                type="number"
                min="1"
                max="300"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </>
          ) : (
            <>
              <label>Scenes</label>
              <div data-testid="scene-editor">
                {scenes.map((scene, i) => (
                  <div className="scene-row" key={scene.id} data-testid={`scene-editor-row-${i}`}>
                    <span className="idx">{i + 1}</span>
                    <select
                      className="grow"
                      data-testid={`scene-editor-type-${i}`}
                      value={scene.type}
                      onChange={(e) => updateScene(i, { type: e.target.value })}
                    >
                      {SCENE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      style={{ width: 90 }}
                      data-testid={`scene-editor-duration-${i}`}
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={scene.durationSeconds}
                      onChange={(e) => updateScene(i, { durationSeconds: Number(e.target.value) })}
                    />
                    <input
                      className="grow"
                      data-testid={`scene-editor-text-${i}`}
                      type="text"
                      placeholder={scene.type === 'title-slide' ? 'On-screen text' : 'Instructions'}
                      value={scene.type === 'title-slide' ? scene.text : scene.instructions}
                      onChange={(e) =>
                        updateScene(i, scene.type === 'title-slide' ? { text: e.target.value } : { instructions: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="ghost"
                      data-testid={`scene-editor-remove-${i}`}
                      onClick={() => removeScene(i)}
                      disabled={scenes.length <= 1}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                data-testid="scene-editor-add"
                onClick={() => setScenes((prev) => [...prev, newScene()])}
              >
                + Add scene
              </button>
            </>
          )}

          <label htmlFor="assets">Ephemeral assets (images, video, or background music)</label>
          <input
            id="assets"
            data-testid="create-assets"
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            onChange={handleUpload}
          />
          <p className="notice" style={{ marginTop: 10 }}>
            Assets are public and auto-deleted after 7 days. Do not upload anything confidential — by uploading you
            accept that these files are served publicly from the ephemeral bucket.
          </p>
          {uploading ? <p className="status">Uploading…</p> : null}
          {assets.length ? (
            <ul className="steps" data-testid="asset-list">
              {assets.map((asset) => (
                <li key={asset.id}>
                  {asset.name} — {formatBytes(asset.size)} ({asset.type || 'unknown'}){' '}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeAsset(asset.id)}
                    style={{ padding: '2px 8px', fontSize: 12 }}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? <p className="error" data-testid="create-error">{error}</p> : null}

          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" data-testid="create-submit" disabled={publishing || uploading}>
              {publishing ? 'Publishing…' : 'Publish & get Magic Link'}
            </button>
          </div>
        </form>
      </section>

      {magicLink ? (
        <section className="card" data-testid="magic-link-panel">
          <h2>Magic Link ready</h2>
          <p>Send this to whoever is recording. It carries the whole configuration — no login required.</p>
          <div className="magic-link" data-testid="magic-link">
            {magicLink}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <a data-testid="record-link" href={magicLink} style={{ textDecoration: 'none' }}>
              <button type="button">Open recording view</button>
            </a>
            <button type="button" className="secondary" data-testid="copy-link" onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
