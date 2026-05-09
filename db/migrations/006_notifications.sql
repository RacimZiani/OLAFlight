-- Migration : table notifications (CRM bell + mobile push later)
-- Run in Supabase SQL Editor.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_email   text,                     -- destinataire (null = broadcast par rôle)
  user_role    text,                     -- "admin" | "closeuse" | "dalsim" | null
  type         text not null,            -- "devis_created" | "lead_won" | "lead_nego" | "lead_assigned" | "lead_lost" | "info"
  title        text not null,
  body         text,
  lead_id      uuid,
  devis_id     text,
  meta         jsonb default '{}'::jsonb,
  read         boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (user_email, user_role, read, created_at desc);
create index if not exists notifications_lead_idx on public.notifications (lead_id);
create index if not exists notifications_type_idx on public.notifications (type);
