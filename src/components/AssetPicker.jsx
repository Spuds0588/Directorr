import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadStudioLibrary } from '../lib/stockLibrary.js';
import { ingestFile, ingestLibraryItem, ingestRemoteUrl, ingestSearchResult } from '../lib/assetIngest.js';
import { SOURCES, keyedSources } from '../lib/brollProviders.js';
import { searchStock, stockSearchStatus } from '../lib/stockSearch.js';
import { formatBytes } from '../lib/mediaUtils.js';
import { useAppStore } from '../store/useAppStore.js';

/**
 * B-roll picker — one component, four sources, one ingest contract.
 *
 *   Studio library   first-party, zero-key, no expiry (works today)
 *   Upload           creator's own file (works today)
 *   Paste URL        any direct media link, re-hosted into the bucket (works today)
 *   Stock providers  Pexels / Pixabay / Unsplash adapters behind one endpoint
 *
 * The picker never decides how to fetch anything: it hands a candidate to
 * `assetIngest`, which enforces licence policy, stores our own copy, and proves
 * the result can be drawn without tainting the recording canvas.
 */

const TABS = [
  { id: 'library', label: 'Studio library' },
  { id: 'upload', label: 'Upload' },
  { id: 'url', label: 'Paste URL' },
  { id: 'providers', label: 'Stock providers' },
];

const studioSource = SOURCES.find((source) => source.id === 'studio');
const uploadSource = SOURCES.find((source) => source.id === 'upload');
const urlSource = SOURCES.find((source) => source.id === 'url');

export default function AssetPicker() {
  const assets = useAppStore((s) => s.assets);
  const addAsset = useAppStore((s) => s.addAsset);

  const [tab, setTab] = useState('library');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [library, setLibrary] = useState({ status: 'idle', assets: [], license: '', error: null });
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState('');
  const [searches, setSearches] = useState({});

  const stock = useMemo(() => stockSearchStatus(), []);
  const alreadyAdded = useCallback((candidate) => assets.some((a) => a.url === candidate), [assets]);

  // The library is fetched the first time the tab is opened, not on mount, so
  // the create page stays instant.
  //
  // The latch is a ref rather than `library.status`, because in React 18
  // StrictMode the setup/cleanup/setup double-invoke would clear a status-based
  // guard's flag on the re-render it just caused, stranding the panel on
  // "Loading…" forever. A ref survives that cycle.
  const libraryRequested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (tab !== 'library' || libraryRequested.current) return;
    libraryRequested.current = true;
    setLibrary((state) => ({ ...state, status: 'loading' }));
    loadStudioLibrary()
      .then((manifest) => {
        if (!mounted.current) return;
        setLibrary({ status: 'ready', assets: manifest.assets, license: manifest.license, error: null });
      })
      .catch((err) => {
        console.error('[AssetPicker] library failed to load', err);
        if (mounted.current) setLibrary({ status: 'error', assets: [], license: '', error: err.message });
      });
  }, [tab]);

  /** Shared adapter from "produce an asset" to "store becomes truth". */
  const add = useCallback(
    async (label, work, message) => {
      setBusy(label);
      setError(null);
      setNotice(null);
      try {
        const asset = await work();
        addAsset(asset);
        setNotice(message(asset));
        return asset;
      } catch (err) {
        console.error('[AssetPicker] ingest failed', { label, err });
        setError(err.message);
        return null;
      } finally {
        setBusy('');
      }
    },
    [addAsset],
  );

  const handleFiles = useCallback(
    async (files) => {
      if (!files.length) return;
      setBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
      setError(null);
      setNotice(null);
      try {
        const added = [];
        for (const file of files) added.push(await ingestFile(file));
        added.forEach(addAsset);
        setNotice(
          `${added.length} file${added.length > 1 ? 's' : ''} stored in the ephemeral bucket — auto-deleted after 7 days.`,
        );
      } catch (err) {
        console.error('[AssetPicker] upload failed', err);
        setError(err.message);
      } finally {
        setBusy('');
      }
    },
    [addAsset],
  );

  async function runSearch(sourceId, query) {
    setSearches((state) => ({ ...state, [sourceId]: { status: 'loading', results: [], error: null, query } }));
    try {
      const results = await searchStock(sourceId, query);
      setSearches((state) => ({ ...state, [sourceId]: { status: 'ready', results, error: null, query } }));
    } catch (err) {
      console.error('[AssetPicker] search failed', { sourceId, err });
      setSearches((state) => ({ ...state, [sourceId]: { status: 'error', results: [], error: err.message, query } }));
    }
  }

  const filteredLibrary = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return library.assets;
    return library.assets.filter((item) =>
      [item.name, item.kind, ...(item.tags || [])].join(' ').toLowerCase().includes(needle),
    );
  }, [filter, library.assets]);

  return (
    <div className="asset-picker" data-testid="asset-picker">
      <div className="picker-tabs" role="tablist" aria-label="B-roll source">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            data-testid={`asset-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {busy ? (
        <p className="status" data-testid="picker-status">
          {busy}
        </p>
      ) : null}
      {error ? (
        <p className="error" data-testid="picker-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" data-testid="picker-notice">
          {notice}
        </p>
      ) : null}

      {tab === 'library' ? (
        <div data-testid="library-panel">
          <p>{studioSource.blurb}</p>
          {library.status === 'loading' ? (
            <p className="status" data-testid="library-status">
              Loading the studio library…
            </p>
          ) : null}
          {library.status === 'error' ? (
            <p className="error" data-testid="library-status">
              {library.error}
            </p>
          ) : null}
          {library.status === 'ready' ? (
            <>
              <input
                type="text"
                className="picker-search"
                data-testid="library-search"
                placeholder="Filter by name or tag (grid, gradient, motion…)"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="asset-grid" data-testid="library-grid">
                {filteredLibrary.map((item) => (
                  <figure className="asset-card" key={item.id} data-testid={`library-item-${item.id}`}>
                    <img src={item.posterUrl || item.url} alt="" loading="lazy" />
                    {item.kind === 'video' ? <span className="asset-flag">video · {item.durationSeconds}s</span> : null}
                    <figcaption>
                      <strong>{item.name}</strong>
                      <span className="asset-meta">
                        {item.width}×{item.height} · {formatBytes(item.size)}
                      </span>
                      <span className="asset-meta license">{item.license || library.license}</span>
                      <button
                        type="button"
                        className="secondary"
                        data-testid={`library-add-${item.id}`}
                        disabled={Boolean(busy) || alreadyAdded(item.url)}
                        onClick={() =>
                          add(
                            `Adding ${item.name}…`,
                            () => ingestLibraryItem(item, { license: library.license }),
                            (asset) => `${asset.name} added — first-party and licence-free, so it never expires.`,
                          )
                        }
                      >
                        {alreadyAdded(item.url) ? 'Added' : 'Add to template'}
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {!filteredLibrary.length ? (
                <p className="status" data-testid="library-empty">
                  Nothing in the library matches that filter.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'upload' ? (
        <div data-testid="upload-panel">
          <p>{uploadSource.blurb}</p>
          <label htmlFor="assets">Files (images, video, or background music)</label>
          <input
            id="assets"
            data-testid="create-assets"
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              handleFiles(files);
            }}
          />
          <p className="notice" style={{ marginTop: 10 }}>
            Assets are public and auto-deleted after 7 days. Do not upload anything confidential — by uploading you accept
            that these files are served publicly from the ephemeral bucket.
          </p>
        </div>
      ) : null}

      {tab === 'url' ? (
        <div data-testid="url-panel">
          <p>{urlSource.blurb}</p>
          <label htmlFor="asset-url">Direct media URL</label>
          <input
            id="asset-url"
            type="text"
            data-testid="url-input"
            placeholder="https://example.com/clip.mp4"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              data-testid="url-submit"
              disabled={Boolean(busy)}
              onClick={() =>
                add(
                  'Downloading and re-hosting…',
                  () => ingestRemoteUrl(url),
                  (asset) =>
                    `Stored our own copy of ${asset.name} (${formatBytes(asset.size)}) — hotlinks are never drawn to the canvas, so takes cannot be spoiled by CORS.`,
                )
              }
            >
              Download &amp; add
            </button>
          </div>
          <p className="status" data-testid="url-hint">
            The file must be reachable with CORS enabled. Anything that cannot be drawn to the canvas is rejected before it
            reaches a take, rather than silently recording black frames.
          </p>
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div data-testid="providers-panel">
          <p>
            Provider keys must stay confidential, so search runs through one key-holding endpoint. The{' '}
            <strong>Studio library</strong>, <strong>Upload</strong>, and <strong>Paste URL</strong> tabs need no keys at
            all.
          </p>
          <p className="status" data-testid="stock-search-status">
            {stock.configured ? `Search endpoint: ${stock.endpoint}` : 'Search endpoint: not configured'}
          </p>
          {keyedSources().map((source) => {
            const state = searches[source.id] || { status: 'idle', results: [], error: null, query: '' };
            const usable = source.enabled && stock.configured;
            return (
              <div className="provider" key={source.id} data-testid={`provider-${source.id}`}>
                <h3>{source.label}</h3>
                <p>{source.blurb}</p>
                <p className="asset-meta">{source.license}</p>
                {!source.enabled ? (
                  <p className="notice" data-testid={`provider-note-${source.id}`}>
                    {source.disabledReason}
                  </p>
                ) : !stock.configured ? (
                  <p className="notice" data-testid={`provider-note-${source.id}`}>
                    Needs the <code>{source.keyName}</code> key on a key-holding endpoint ({source.rateLimit} limit). See
                    docs/SETUP-BROLL.md.
                  </p>
                ) : (
                  <p className="status" data-testid={`provider-note-${source.id}`}>
                    Ready — {source.rateLimit} limit.
                  </p>
                )}
                <div className="row">
                  <input
                    type="text"
                    className="picker-search"
                    data-testid={`provider-query-${source.id}`}
                    placeholder={`Search ${source.label}…`}
                    value={state.query ?? ''}
                    disabled={!usable}
                    onChange={(event) =>
                      setSearches((prev) => ({
                        ...prev,
                        [source.id]: { ...(prev[source.id] || { results: [], error: null }), query: event.target.value },
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="secondary"
                    data-testid={`provider-search-${source.id}`}
                    disabled={!usable || state.status === 'loading'}
                    onClick={() => runSearch(source.id, state.query ?? '')}
                  >
                    {state.status === 'loading' ? 'Searching…' : 'Search'}
                  </button>
                </div>
                {state.error ? (
                  <p className="error" data-testid={`provider-error-${source.id}`}>
                    {state.error}
                  </p>
                ) : null}
                {state.results.length ? (
                  <div className="asset-grid" data-testid={`provider-results-${source.id}`}>
                    {state.results.map((item, index) => (
                      <figure className="asset-card" key={item.id || index} data-testid={`provider-result-${source.id}-${index}`}>
                        <img src={item.previewUrl} alt="" loading="lazy" />
                        {item.kind === 'video' ? <span className="asset-flag">video</span> : null}
                        <figcaption>
                          <strong>{item.name}</strong>
                          <span className="asset-meta">
                            {item.width}×{item.height}
                            {item.photographer ? ` · ${item.photographer}` : ''}
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            data-testid={`provider-add-${source.id}-${index}`}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              add(
                                `Re-hosting ${item.name}…`,
                                () => ingestSearchResult(item, source),
                                (asset) => `${asset.name} re-hosted into the ephemeral bucket.`,
                              )
                            }
                          >
                            Re-host &amp; add
                          </button>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

    </div>
  );
}
