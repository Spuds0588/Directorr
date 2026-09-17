/**
 * Single seam between the app and its data layer.
 *
 * Until Supabase is provisioned the app runs on the localStorage mock, so the
 * product is fully usable and testable today. Dropping two env vars in the
 * deploy switches every call below to the real Supabase backend — no component
 * changes required.
 */
import * as mock from './mockBackend';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const backendName = isSupabaseConfigured ? 'supabase' : 'mock';

let supabaseModulePromise = null;
function supabase() {
  if (!supabaseModulePromise) supabaseModulePromise = import('./supabaseBackend');
  return supabaseModulePromise;
}

console.log(`[dataSource] using "${backendName}" backend`);

export async function createTemplate(jsonData) {
  if (isSupabaseConfigured) return (await supabase()).createTemplate(jsonData);
  return mock.createTemplate(jsonData);
}

export async function fetchTemplate(id) {
  if (isSupabaseConfigured) return (await supabase()).fetchTemplate(id);
  return mock.fetchTemplate(id);
}

export async function listTemplates() {
  if (isSupabaseConfigured) return (await supabase()).listTemplates();
  return mock.listTemplates();
}

export async function uploadAsset(file, options) {
  if (isSupabaseConfigured) return (await supabase()).uploadAsset(file, options);
  return mock.uploadAsset(file, options);
}

/** Build the Magic Link that end-users open to record. */
export function buildMagicLink(id) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/record/${id}`;
}
