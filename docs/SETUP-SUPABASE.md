# Directorr — Supabase & Keys Setup

Everything below is written but **not yet applied**. Until you run it, Directorr runs on the local
mock backend (templates live in the visitor's browser with a 7-day TTL) and needs no keys at all.

---

## 0. Recommended architecture: how many layers?

You asked for the fewest layers possible. Here is the honest tradeoff.

| Option | Layers | Verdict |
| --- | --- | --- |
| **Browser → Supabase directly** (anon key + Row Level Security) | **1** | ✅ **Use this.** |
| Browser → Cloudflare Worker → Supabase | 2 | ❌ Unnecessary here. |
| Browser → your own server | 3 | ❌ Off-spec. |

The Supabase **anon/publishable key is designed to be public** — it ships inside every Supabase web app
that exists. It is not a secret. The security boundary is **Row Level Security (RLS)**, which we enable
below. A Cloudflare Worker would only re-hide a value that is already safe to expose, while adding a
deploy target, a second origin to maintain, CORS config, and a failure point. That directly contradicts
the "lowest number of layers" goal.

**So: no Cloudflare Workers. No server. The frontend talks to Supabase directly.**

What *must* stay secret is the **`service_role` key**. It is never used by this app, never placed in the
frontend, and never committed. The `pg_cron` cleanup below runs inside Postgres, so not even a Worker is
needed for the 7-day purge.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name it `directorr`, pick a region close to your users, set a strong database password (save it in
   your password manager — the app never needs it).
3. Wait for provisioning (~2 min).

## 2. Run the schema

Open **SQL Editor → New query**, paste this, and click **Run**.

```sql
-- 1. Templates: one row per Magic Link, the whole JSON config lives in json_data.
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  json_data   jsonb not null
);

create index if not exists templates_created_at_idx on public.templates (created_at desc);

alter table public.templates enable row level security;

-- Anyone holding a Magic Link may read the template (it is public by design).
create policy "templates are publicly readable"
  on public.templates for select
  using (true);

-- Anyone may create a template, but cannot rewrite or delete existing ones.
create policy "templates are insert-only"
  on public.templates for insert
  with check (true);

-- 2. Ephemeral asset metadata is not stored in Postgres; the bucket holds files
--    and pg_cron deletes them. Nothing else to do here.
```

> **Security note.** `insert-only` + `select` with no `update`/`delete` policy means the public anon key
> cannot tamper with or destroy data. If you later want to stop anonymous template creation, add an
> auth check or a rate limiter — but per YAGNI we accept anonymous create for v1.

## 3. Create the ephemeral bucket

1. **Storage → New bucket**.
2. Name: `ephemeral_assets` (exactly — `supabaseBackend.js` hardcodes this).
3. Toggle **Public bucket** ON (needed so `<canvas>` can draw assets without CORS tainting).
4. **Save**.

Then add the storage policies (Storage → Policies → on `ephemeral_assets`):

```sql
-- Public read
create policy "ephemeral assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'ephemeral_assets');

-- Anonymous upload into the bucket only
create policy "ephemeral assets allow anonymous upload"
  on storage.objects for insert
  with check (bucket_id = 'ephemeral_assets');
```

Also set the bucket's allowed MIME types to `image/*, video/*, audio/*` (print only what the canvas can
actually draw — never `text/html`, which would be an XSS vector).

## 4. 7-day auto-delete (the `pg_cron` TTL)

Run this in the SQL Editor. It deletes both the storage objects and their metadata rows every night.

```sql
create extension if not exists pg_cron;

create or replace function public.purge_ephemeral_assets()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'ephemeral_assets'
    and created_at < now() - interval '7 days';
end;
$$;

-- Nightly at 03:15 UTC.
select cron.schedule('purge-ephemeral-assets', '15 3 * * *', $$select public.purge_ephemeral_assets();$$);
```

Optionally also expire stale templates with the same discipline:

```sql
select cron.schedule('purge-old-templates', '30 3 * * *',
  $$delete from public.templates where created_at < now() - interval '30 days';$$);
```

## 5. Grab the two public values

**Project Settings → API**:

- `Project URL` → this is `VITE_SUPABASE_URL` (looks like `https://abcdefg.supabase.co`).
- `anon` / `publishable` key → this is `VITE_SUPABASE_ANON_KEY`. **Copy the anon key, never
  `service_role`.**

That is the complete set of values this app needs. Two.

---

## 6. Where the keys go

The frontend is a static bundle, so these values are **baked in at build time**. They are public-safe,
which is exactly why no extra layer is needed.

### Local development

Copy `.env.example` to `.env` (already gitignored) and paste the two values:

```bash
cp .env.example .env
```

Then restart `npm run dev`. The nav badge flips from **Local mock** to **Supabase**.

> Leave `.env` empty (or absent) and you are back on the mock backend. Nothing breaks.

### GitHub Actions → GitHub Pages

Add the values under **Settings → Secrets and variables → Actions**:

| Name | Type | Why |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | **Variable** | Public by design — a Variable is fine and visible. |
| `VITE_SUPABASE_ANON_KEY` | **Variable** | Public by design — safe as a Variable. |
| *(never add `SUPABASE_SERVICE_ROLE_KEY`)* | — | The app must never see it. |

Use **Variables** (not Secrets) for these two so they are greppable and auditable — treating a public
value as a secret creates a false sense of safety. The deploy workflow reads them and passes them to
`vite build`. If they are absent, the workflow still deploys and the site simply runs on the mock backend.

### GitHub Pages enablement (one-time, manual)

**Settings → Pages → Build and deployment → Source: GitHub Actions.** The bundled
`.github/workflows/deploy.yml` then publishes on every push to `main`.

### What NOT to do

- ❌ Do not commit `.env` (it is gitignored).
- ❌ Do not put the `service_role` key anywhere in this repo.
- ❌ Do not add a Cloudflare Worker to "hide" the anon key — it is not a secret.
- ❌ Do not build a custom upload endpoint; RLS already constrains the bucket.

---

## 7. Verify the switch

1. Push with the variables set.
2. Open the deployed site — the nav badge should read **Supabase**.
3. Create a template → check **Table Editor → templates** and **Storage → ephemeral_assets**.
4. Open the Magic Link in a fresh browser profile — it should record normally.

If the badge still says **Local mock**, the build ran without the variables: re-check the exact names
(they must start with `VITE_`) and re-run the workflow.
