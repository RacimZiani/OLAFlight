-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — users auth fields (Supabase / Postgres)
-- Align with server auth (src/routes/auth.js) + seed (src/seeds/admin.js)
-- ─────────────────────────────────────────────────────────────────────────

alter table public.users
  add column if not exists password_hash text,
  add column if not exists whatsapp text,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill updated_at if needed
update public.users set updated_at = now() where updated_at is null;

