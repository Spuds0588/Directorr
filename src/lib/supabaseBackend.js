/**
 * Supabase backend — identical surface to mockBackend, activated only when
 * VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are present (see dataSource.js).
 *
 * The client is imported lazily so the mock path never pulls Supabase into the
 * dev/test bundle. Schema + bucket + 7-day pg_cron cleanup are documented in
 * docs/SETUP-SUPABASE.md.
 */

export const BUCKET = 'ephemeral_assets';
export const TEMPLATES_TABLE = 'templates';

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
      console.log('[supabaseBackend] creating client for', url);
      return createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    });
  }
  return clientPromise;
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createTemplate(jsonData) {
  const supabase = await getClient();
  const id = jsonData.id || uuid();
  const { data, error } = await supabase
    .from(TEMPLATES_TABLE)
    .insert({ id, json_data: { ...jsonData, id } })
    .select()
    .single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  console.log('[supabaseBackend] created template', id);
  return { id, record: data };
}

export async function fetchTemplate(id) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from(TEMPLATES_TABLE)
    .select('json_data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return data?.json_data ?? null;
}

export async function listTemplates() {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from(TEMPLATES_TABLE)
    .select('id, created_at, json_data')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Supabase list failed: ${error.message}`);
  return (data || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    title: row.json_data?.title,
    type: row.json_data?.type,
  }));
}

export async function uploadAsset(file, { folder = 'uploads' } = {}) {
  const supabase = await getClient();
  const id = uuid();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${id}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log('[supabaseBackend] uploaded asset', { path, size: file.size });
  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    path,
    url: data.publicUrl,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
