/**
 * Stock provider search adapter.
 *
 * Search cannot happen in the browser: Pexels/Pixabay keys are *not* public-safe
 * (unlike the Supabase anon key), and their APIs do not send permissive CORS
 * headers. So the one place this app needs a server is here, and it is exactly
 * one function: `POST /stock-search` in `supabase/functions/stock-search/`,
 * deployed on the Supabase project that already exists for storage.
 *
 * Until that endpoint is deployed the picker still works end to end through the
 * zero-key paths (studio library, upload, paste URL). This module only has to
 * fail clearly, not silently.
 */

import { keyedSources, sourceById } from './brollProviders.js';

const ENDPOINT = String(import.meta.env.VITE_STOCK_SEARCH_ENDPOINT || '').trim();

const isStockSearchConfigured = Boolean(ENDPOINT);

export class StockSearchNotConfiguredError extends Error {
  constructor(source) {
    super(
      `Searching ${source?.label || 'this provider'} needs a key-holding endpoint, because provider API keys must stay confidential. ` +
        'Deploy the stock-search function and set VITE_STOCK_SEARCH_ENDPOINT — see docs/SETUP-BROLL.md. ' +
        'The Studio library, uploads, and pasted URLs work right now with no keys.',
    );
    this.name = 'StockSearchNotConfiguredError';
    this.code = 'not-configured';
  }
}

export function stockSearchStatus() {
  return {
    configured: isStockSearchConfigured,
    endpoint: ENDPOINT,
    keyNames: [...new Set(keyedSources().map((source) => source.keyName).filter(Boolean))],
  };
}

/**
 * Search one provider. Resolves to normalised results already shaped for
 * `ingestSearchResult`:
 *
 *   { id, name, kind, previewUrl, downloadUrl, width, height, durationSeconds, photographer }
 *
 * Results are normalised server-side so this client never learns a key name's
 * quirks — adding a provider is a function change, not an app release.
 */
export async function searchStock(sourceId, query, { perPage = 12, orientation = 'landscape' } = {}) {
  const source = sourceById(sourceId);
  if (!source || !source.searchable) throw new Error(`"${sourceId}" is not a searchable source.`);
  if (!source.enabled) throw new Error(source.disabledReason || `${source.label} is unavailable.`);
  if (!isStockSearchConfigured) throw new StockSearchNotConfiguredError(source);

  const url = new URL(ENDPOINT, window.location.origin);
  url.searchParams.set('provider', source.id);
  url.searchParams.set('q', String(query || '').trim());
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('orientation', orientation);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status}). Check the stock-search function logs.`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  console.log('[stockSearch] results', { provider: source.id, query, count: results.length });
  return results.map((item) => ({ ...item, sourceId: source.id }));
}
