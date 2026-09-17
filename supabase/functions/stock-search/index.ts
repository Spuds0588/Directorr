// Directorr — stock-search edge function (Supabase / Deno).
//
// WHY THIS EXISTS
// ---------------
// Every other part of Directorr talks to the outside world with no server: the
// Supabase anon key is public by design and Row Level Security is the boundary.
// Stock provider keys are DIFFERENT — Pexels, Pixabay, and Unsplash all require
// API keys to stay confidential, and none of their APIs send permissive CORS
// headers. So search gets exactly one thin function, deployed on the Supabase
// project that already holds storage and the templates table. No new vendor, no
// Cloudflare Worker, no extra account.
//
// DEPLOY
//   supabase functions deploy stock-search --no-verify-jwt
//   supabase secrets set PEXELS_API_KEY=... PIXABAY_API_KEY=...
//   # then set the GitHub Actions variable VITE_STOCK_SEARCH_ENDPOINT to the
//   # deployed URL, e.g. https://<ref>.supabase.co/functions/v1/stock-search
//
// CONTRACT (stable — the app is normalised against this, never against a vendor)
//   GET ?provider=pexels|pixabay&q=<query>&per_page=12&orientation=landscape
//   200 { provider, query, results: [{
//          id, name, kind: 'image'|'video', previewUrl, downloadUrl,
//          width, height, durationSeconds, photographer, pageUrl
//        }] }
//   4xx/5xx { error: string }
//
// `previewUrl` is hotlinked for on-screen thumbnails only (which the licences
// permit). `downloadUrl` is what the app downloads into the ephemeral bucket, so
// nothing cross-origin is ever drawn to the recording canvas.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });

// Pixabay requires caching of its responses; 5 minutes is both polite and legal.
type Normalised = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  photographer: string;
  pageUrl: string;
};

async function searchPexels(query: string, perPage: number, orientation: string): Promise<Normalised[]> {
  const key = Deno.env.get('PEXELS_API_KEY');
  if (!key) throw new Error('PEXELS_API_KEY is not set on this function.');
  const headers = { Authorization: key };
  const params = new URLSearchParams({ query, per_page: String(perPage), orientation });

  const [photos, videos] = await Promise.all([
    fetch(`https://api.pexels.com/v1/search?${params}`, { headers }).then((r) => (r.ok ? r.json() : { photos: [] })),
    fetch(`https://api.pexels.com/videos/search?${params}`, { headers }).then((r) => (r.ok ? r.json() : { videos: [] })),
  ]);

  const photoResults: Normalised[] = (photos.photos || []).map((photo: any) => ({
    id: `pexels-photo-${photo.id}`,
    name: photo.alt || `Pexels photo ${photo.id}`,
    kind: 'image',
    previewUrl: photo.src?.medium || photo.src?.small,
    downloadUrl: photo.src?.large2x || photo.src?.original,
    width: photo.width,
    height: photo.height,
    durationSeconds: null,
    photographer: photo.photographer,
    pageUrl: photo.url,
  }));

  const videoResults: Normalised[] = (videos.videos || []).map((video: any) => {
    // Pick the smallest HD rendition — 4K would blow through storage and the
    // 7-day TTL for no visible gain in a 9:16 composite.
    const files = (video.video_files || []).filter((f: any) => f.file_type === 'video/mp4');
    const chosen = files.sort((a: any, b: any) => (b.width || 0) - (a.width || 0)).find((f: any) => (f.width || 0) <= 1920) || files[0];
    return {
      id: `pexels-video-${video.id}`,
      name: `Pexels video ${video.id}`,
      kind: 'video',
      previewUrl: video.image,
      downloadUrl: chosen?.link,
      width: chosen?.width ?? video.width,
      height: chosen?.height ?? video.height,
      durationSeconds: video.duration ?? null,
      photographer: video.user?.name || '',
      pageUrl: video.url,
    };
  });

  return [...videoResults, ...photoResults].filter((item) => item.previewUrl && item.downloadUrl);
}

async function searchPixabay(query: string, perPage: number): Promise<Normalised[]> {
  const key = Deno.env.get('PIXABAY_API_KEY');
  if (!key) throw new Error('PIXABAY_API_KEY is not set on this function.');
  const params = new URLSearchParams({
    key,
    q: query,
    per_page: String(perPage),
    safesearch: 'true',
  });

  const [photos, videos] = await Promise.all([
    fetch(`https://pixabay.com/api/?${params}`).then((r) => (r.ok ? r.json() : { hits: [] })),
    fetch(`https://pixabay.com/api/videos/?${params}`).then((r) => (r.ok ? r.json() : { hits: [] })),
  ]);

  const photoResults: Normalised[] = (photos.hits || []).map((hit: any) => ({
    id: `pixabay-image-${hit.id}`,
    name: hit.tags || `Pixabay image ${hit.id}`,
    kind: 'image',
    previewUrl: hit.previewURL,
    downloadUrl: hit.largeImageURL || hit.webformatURL,
    width: hit.imageWidth,
    height: hit.imageHeight,
    durationSeconds: null,
    photographer: hit.user,
    pageUrl: hit.pageURL,
  }));

  const videoResults: Normalised[] = (videos.hits || []).map((hit: any) => {
    const rendition = hit.videos?.medium || hit.videos?.small || hit.videos?.large;
    return {
      id: `pixabay-video-${hit.id}`,
      name: hit.tags || `Pixabay video ${hit.id}`,
      kind: 'video',
      previewUrl: rendition?.thumbnail,
      downloadUrl: rendition?.url,
      width: rendition?.width ?? hit.videos?.medium?.width,
      height: rendition?.height ?? hit.videos?.medium?.height,
      durationSeconds: rendition?.duration ?? null,
      photographer: hit.user,
      pageUrl: hit.pageURL,
    };
  });

  return [...videoResults, ...photoResults].filter((item) => item.previewUrl && item.downloadUrl);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') || 'pexels';
  const query = (url.searchParams.get('q') || '').trim();
  const perPage = Math.min(24, Math.max(1, Number(url.searchParams.get('per_page')) || 12));
  const orientation = url.searchParams.get('orientation') || 'landscape';

  if (!query) return json({ error: 'Provide ?q=<search terms>.' }, 400);

  // Unsplash is intentionally absent: its API terms require hotlinking and forbid
  // storing copies, while Directorr must store a copy to composite the frame.
  const adapters: Record<string, () => Promise<Normalised[]>> = {
    pexels: () => searchPexels(query, perPage, orientation),
    pixabay: () => searchPixabay(query, perPage),
  };
  const adapter = adapters[provider];
  if (!adapter) {
    return json({ error: `Unsupported provider "${provider}". Supported: ${Object.keys(adapters).join(', ')}.` }, 400);
  }

  try {
    const results = await adapter();
    console.log(`[stock-search] ${provider} "${query}" -> ${results.length}`);
    return json({ provider, query, results });
  } catch (error) {
    console.error('[stock-search] failed', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});
