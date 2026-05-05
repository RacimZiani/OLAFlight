-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — align conversations_ola schema (Supabase / Postgres)
-- Adds missing columns used by the app (key/contact/name) for webhook + web chat.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.conversations_ola
  add column if not exists key text,
  add column if not exists contact text,
  add column if not exists name text;

-- Backfill a deterministic key when possible.
update public.conversations_ola
set key = coalesce(key, channel || ':' || coalesce(contact, id::text))
where key is null;

create unique index if not exists conversations_ola_key_uq on public.conversations_ola (key);

