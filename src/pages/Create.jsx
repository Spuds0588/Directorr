import { useState } from 'react';
import { createTemplate, buildMagicLink } from '../lib/dataSource.js';
import {
  buildAssetCredits,
  buildContinuousTemplate,
  buildSceneTemplate,
  fullNarrationScript,
  narrationModeById,
  narrationModesFor,
  scenePrompt,
  validateTemplate,
  DEFAULT_NARRATION,
  SCENE_TYPES,
} from '../lib/templateSchema.js';
import { CLEANUP_ENGINES, CLEANUP_PRESETS, presetById } from '../lib/audioCleanup.js';
import { paceFor } from '../lib/teleprompter.js';
import { assetKind, formatBytes } from '../lib/mediaUtils.js';
import AssetPicker from '../components/AssetPicker.jsx';
import { useAppStore } from '../store/useAppStore.js';

const totalSceneSeconds = (list) => list.reduce((total, scene) => total + (Number(scene.durationSeconds) || 0), 0);

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
  const [showScriptInOutput, setShowScriptInOutput] = useState(true);
  const [narration, setNarration] = useState({ ...DEFAULT_NARRATION });
  const [scenes, setScenes] = useState([
    newScene({ type: 'title-slide', durationSeconds: 3, text: 'Welcome!' }),
    newScene({ type: 'camera', durationSeconds: 5, instructions: 'Introduce yourself.' }),
  ]);

  const assets = useAppStore((s) => s.assets);
  const removeAsset = useAppStore((s) => s.removeAsset);
  const magicLink = useAppStore((s) => s.magicLink);
  const setMagicLink = useAppStore((s) => s.setMagicLink);
  const [musicUrl, setMusicUrl] = useState('');

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // `kind` is normalised during ingest, but legacy/seed assets may predate it.
  const kindOf = (asset) => asset.kind || assetKind(asset);
  const drawableAssets = assets.filter((asset) => ['image', 'video'].includes(kindOf(asset)));
  const audioAssets = assets.filter((asset) => kindOf(asset) === 'audio');
  const creditFor = (asset) =>
    [asset?.attribution, asset?.license].filter(Boolean).join(' — ') || 'Unverified — you are responsible for the rights';

  const updateScene = (index, patch) =>
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));

  const removeScene = (index) => setScenes((prev) => prev.filter((_, i) => i !== index));

  const availableNarrationModes = narrationModesFor(mode);
  // Switching template type can strand an unavailable narration mode, so the
  // effective mode is always the one this template type can actually run.
  const narrationMode = availableNarrationModes.find((item) => item.id === narration.mode) || availableNarrationModes[0];
  const narrationConfig = { ...narration, mode: narrationMode.id };
  const promptsGiven = scenes.filter((scene) => scenePrompt(scene)).length;
  // The one-take narration reads every clip's prompt in timeline order.
  const narrationScript = fullNarrationScript(scenes);
  const sceneSeconds = totalSceneSeconds(scenes);
  const scriptPace = paceFor(script, Number(duration) || 0);
  const creditsPace = paceFor(narrationScript, sceneSeconds);
  const needsPrompts = narrationMode.id === 'clip-narration';

  function buildPayload() {
    const safeDuration = Math.max(1, Number(duration) || 30);
    const assetByUrl = new Map(drawableAssets.map((asset) => [asset.url, asset]));

    if (mode === 'continuous') {
      // Assets are spread evenly across the take; the strict timeline is the
      // PRD contract, so there is no trimming UI to fight with.
      const bottomTrack = drawableAssets.map((asset, i) => {
        const slot = safeDuration / Math.max(1, drawableAssets.length);
        return {
          type: kindOf(asset) === 'image' ? 'image' : 'video',
          url: asset.url,
          startTime: Number((i * slot).toFixed(2)),
          endTime: Number(((i + 1) * slot).toFixed(2)),
        };
      });
      const used = drawableAssets.filter((asset) => bottomTrack.some((item) => item.url === asset.url));
      return buildContinuousTemplate({
        title,
        durationSeconds: safeDuration,
        script,
        bottomTrack,
        assetCredits: buildAssetCredits(used),
        narration: narrationConfig,
        showScriptInOutput,
      });
    }

    const resolved = scenes.map((scene) => ({
      ...scene,
      assetUrl: scene.type === 'broll' ? scene.assetUrl || drawableAssets[0]?.url || '' : '',
    }));
    const selectedMusic = audioAssets.find((asset) => asset.url === musicUrl) || audioAssets[0] || null;
    const used = [
      ...resolved.map((scene) => assetByUrl.get(scene.assetUrl)).filter(Boolean),
      selectedMusic,
    ].filter(Boolean);

    return buildSceneTemplate({
      title,
      scenes: resolved,
      backgroundMusicUrl: selectedMusic?.url || '',
      assetCredits: buildAssetCredits(used),
      narration: narrationConfig,
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
    // A narration mode that prompts clip by clip is useless with no prompts: the
    // talent would be recording silence to a blank screen.
    if (mode === 'scene' && needsPrompts && promptsGiven < scenes.length) {
      errors.push(
        `${narrationMode.label} needs a prompt on every clip — ${scenes.length - promptsGiven} still ${scenes.length - promptsGiven === 1 ? 'has' : 'have'} nothing to say.`,
      );
    }
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
              <label htmlFor="script">Teleprompter script — what the talent reads</label>
              <textarea
                id="script"
                data-testid="create-script"
                value={script}
                placeholder="Welcome to this week's update..."
                onChange={(e) => setScript(e.target.value)}
              />
              <p className={`status pace pace-${scriptPace.verdict}`} data-testid="create-script-pace">
                {scriptPace.message}
              </p>
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
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  data-testid="create-script-in-output"
                  checked={showScriptInOutput}
                  onChange={(e) => setShowScriptInOutput(e.target.checked)}
                />
                Burn the script into the video as a caption band
              </label>
              <p className="asset-meta" data-testid="create-script-in-output-note">
                {showScriptInOutput
                  ? 'The script is part of the composite, exactly like the PRD layout. Uncheck it to keep the script as a talent-only prompt.'
                  : 'The script scrolls as a live prompt only — the canvas stays clean, so nothing the talent reads is recorded.'}
              </p>
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
                    {scene.type === 'title-slide' ? (
                      <input
                        className="grow"
                        data-testid={`scene-editor-text-${i}`}
                        type="text"
                        placeholder="On-screen text"
                        value={scene.text}
                        onChange={(e) => updateScene(i, { text: e.target.value })}
                      />
                    ) : null}
                    {scene.type === 'broll' ? (
                      <select
                        data-testid={`scene-editor-asset-${i}`}
                        value={scene.assetUrl || ''}
                        onChange={(e) => updateScene(i, { assetUrl: e.target.value })}
                      >
                        <option value="">B-roll asset…</option>
                        {drawableAssets.map((asset) => (
                          <option key={asset.id} value={asset.url}>
                            {asset.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="ghost"
                      data-testid={`scene-editor-remove-${i}`}
                      onClick={() => removeScene(i)}
                      disabled={scenes.length <= 1}
                    >
                      ✕
                    </button>
                    <input
                      className="grow prompt-input"
                      data-testid={`scene-editor-say-${i}`}
                      type="text"
                      placeholder="Say this — the prompt the talent reads"
                      value={scene.instructions}
                      onChange={(e) => updateScene(i, { instructions: e.target.value })}
                    />
                    <span
                      className={`asset-meta pace pace-${paceFor(scene.instructions, scene.durationSeconds).verdict}`}
                      data-testid={`scene-editor-pace-${i}`}
                    >
                      {paceFor(scene.instructions, scene.durationSeconds).verdict === 'empty'
                        ? 'No prompt'
                        : `${Math.round(paceFor(scene.instructions, scene.durationSeconds).targetWpm)} wpm`}
                    </span>
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

          <label htmlFor="narration-mode">Voice</label>
          <div className="narration-block" data-testid="narration-block">
            <select
              id="narration-mode"
              data-testid="narration-mode"
              value={narrationMode.id}
              onChange={(e) => setNarration((n) => ({ ...n, mode: e.target.value }))}
            >
              {availableNarrationModes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="asset-meta" data-testid="narration-mode-blurb">
              {narrationMode.blurb}
            </p>

            <div className="row">
              <div className="grow">
                <label htmlFor="narration-preset">Microphone cleanup</label>
                <select
                  id="narration-preset"
                  data-testid="narration-preset"
                  value={narration.cleanup.preset}
                  onChange={(e) => setNarration((n) => ({ ...n, cleanup: { ...n.cleanup, preset: e.target.value } }))}
                >
                  {CLEANUP_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grow">
                <label htmlFor="narration-engine">Cleanup engine</label>
                <select
                  id="narration-engine"
                  data-testid="narration-engine"
                  value={narration.cleanup.engine}
                  onChange={(e) => setNarration((n) => ({ ...n, cleanup: { ...n.cleanup, engine: e.target.value } }))}
                >
                  {CLEANUP_ENGINES.map((engine) => (
                    <option key={engine.id} value={engine.id} disabled={!engine.available}>
                      {engine.label}
                      {engine.available ? '' : ' — not wired yet'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="asset-meta" data-testid="narration-preset-blurb">
              {presetById(narration.cleanup.preset).blurb}
            </p>

            {mode === 'scene' ? (
              <p className="status" data-testid="narration-script-summary">
                Prompts: {promptsGiven}/{scenes.length} clips
                {narrationScript ? ` · ${creditsPace.message}` : ''}
              </p>
            ) : null}

            {narrationMode.id !== 'live-mic' && mode === 'scene' ? (
              <div className="slider-row">
                <label htmlFor="musicDuck">Music under narration</label>
                <input
                  id="musicDuck"
                  data-testid="narration-duck"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={narration.musicDuck}
                  onChange={(e) => setNarration((n) => ({ ...n, musicDuck: Number(e.target.value) }))}
                />
                <span className="val">{Math.round(Number(narration.musicDuck) * 100)}%</span>
              </div>
            ) : null}
          </div>

          {mode === 'scene' && audioAssets.length ? (
            <>
              <label htmlFor="create-music">Background music</label>
              <select
                id="create-music"
                data-testid="create-music"
                value={musicUrl || audioAssets[0]?.url || ''}
                onChange={(e) => setMusicUrl(e.target.value)}
              >
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.url}>
                    {asset.name}
                  </option>
                ))}
                <option value="">None</option>
              </select>
            </>
          ) : null}

          <label>B-roll assets</label>
          <AssetPicker />
          <p className="notice" style={{ marginTop: 10 }}>
            Assets added from the studio library stay first-party and never expire. Uploads, pasted URLs, and provider
            results are copied into the ephemeral bucket and auto-deleted after 7 days.
          </p>
          {assets.length ? (
            <ul className="steps" data-testid="asset-list">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.name}</strong> — {formatBytes(asset.size)} · {kindOf(asset)}
                  {asset.rehosted ? ' · re-hosted copy' : asset.source === 'studio' ? ' · studio library' : ''}
                  <div className="asset-meta">{creditFor(asset)}</div>{' '}
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
            <button type="submit" data-testid="create-submit" disabled={publishing}>
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
