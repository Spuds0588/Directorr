/**
 * Mock backend — the default data layer until Supabase is provisioned.
 *
 * It implements the exact same async surface as the Supabase backend so the app
 * (and the Playwright suite) never needs to know which one is live. Templates
 * and assets live in localStorage with the same 7-day TTL as the real bucket.
 */

const TEMPLATES_KEY = 'directorr.templates.v1';
const ASSETS_KEY = 'directorr.assets.v1';
export const EPHEMERAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('[mockBackend] failed to parse', key, error);
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Quota exceeded is expected for large media in the mock backend.
    console.warn('[mockBackend] persistence failed (quota?)', error);
  }
}

function isExpired(record) {
  return Date.now() - new Date(record.createdAt).getTime() > EPHEMERAL_TTL_MS;
}

function purgeExpired() {
  const templates = readJson(TEMPLATES_KEY);
  let changed = false;
  for (const [id, record] of Object.entries(templates)) {
    if (isExpired(record)) {
      delete templates[id];
      changed = true;
    }
  }
  if (changed) writeJson(TEMPLATES_KEY, templates);
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

export async function createTemplate(jsonData) {
  purgeExpired();
  const templates = readJson(TEMPLATES_KEY);
  const id = jsonData.id && jsonData.id !== 'uuid-1234' ? jsonData.id : uuid();
  const record = { id, createdAt: new Date().toISOString(), json_data: { ...jsonData, id } };
  templates[id] = record;
  writeJson(TEMPLATES_KEY, templates);
  console.log('[mockBackend] created template', id);
  return { id, record };
}

export async function fetchTemplate(id) {
  purgeExpired();
  const templates = readJson(TEMPLATES_KEY);
  const record = templates[id];
  if (!record) return null;
  return record.json_data;
}

export async function listTemplates() {
  purgeExpired();
  return Object.values(readJson(TEMPLATES_KEY))
    .map((r) => ({ id: r.id, createdAt: r.createdAt, title: r.json_data?.title, type: r.json_data?.type }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function uploadAsset(file, { folder = 'uploads' } = {}) {
  const id = uuid();
  const path = `${folder}/${id}-${file.name}`;
  let url;
  let inMemoryOnly = false;
  try {
    url = await fileToDataUrl(file);
  } catch {
    url = URL.createObjectURL(file);
    inMemoryOnly = true;
  }
  const asset = {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    path,
    url,
    inMemoryOnly,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + EPHEMERAL_TTL_MS).toISOString(),
  };

  purgeExpired();
  const assets = readJson(ASSETS_KEY);
  if (!inMemoryOnly) {
    assets[id] = asset;
    writeJson(ASSETS_KEY, assets);
  }
  console.log('[mockBackend] uploaded asset', { name: file.name, size: file.size, inMemoryOnly });
  return asset;
}

/** Test/debug helper: wipe the mock database. */
export function resetMockBackend() {
  localStorage.removeItem(TEMPLATES_KEY);
  localStorage.removeItem(ASSETS_KEY);
}
