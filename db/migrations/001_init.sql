-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — schéma initial Supabase
-- À exécuter dans Supabase SQL editor (project → SQL → New query).
-- Spec interne Ola Flight (rôles & CRM).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── ENUMS ──────────────────────────────────────────────────────────────
do $$ begin
  create type lead_status as enum (
    'qualification','devis_pending','devis_sent','interested',
    'call_booked','won','lost','archived',
    'new','contacted','offer','nego'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_canal as enum ('whatsapp','instagram');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('admin','dalsim','closeuse','agent','client');
exception when duplicate_object then null; end $$;

-- ─── USERS (référence simplifiée — Supabase Auth gère le reste) ─────────
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role user_role not null default 'closeuse',
  display_name text,
  created_at timestamptz not null default now()
);

-- ─── APPORTEUSES ────────────────────────────────────────────────────────
create table if not exists public.apporteurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  instagram text,
  phone text,
  email text,
  reseau text,
  type_reseau text,
  taille_reseau text,
  taux_commission numeric(5,2) not null default 10.00,
  code text unique,
  notes text,
  created_at timestamptz not null default now()
);

-- ─── LEADS ──────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_contact text,
  canal lead_canal not null default 'whatsapp',
  destination text,
  dates text,
  classe text,
  passagers integer not null default 1,
  status lead_status not null default 'qualification',
  apporteur_id uuid references public.apporteurs(id) on delete set null,
  apporteur_name text,
  closer_id uuid references public.users(id) on delete set null,
  closer_name text,
  calendly_link text,
  next_followup timestamptz,
  notes text,
  value numeric(12,2) not null default 0,
  margin numeric(12,2) not null default 0,
  urgent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ─── DEVIS ──────────────────────────────────────────────────────────────
create table if not exists public.devis (
  id text primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  compagnie text,
  horaire_dep text,
  horaire_arr text,
  prix_revient numeric(12,2) not null default 0, -- CONFIDENTIEL — admin/dalsim only
  prix_vente numeric(12,2) not null default 0,
  prix_marche numeric(12,2) not null default 0,
  marge numeric(12,2) generated always as (prix_vente - prix_revient) stored,
  closer_commission numeric(12,2) generated always as
    (greatest(prix_vente - prix_revient, 0) * 0.10) stored,
  apporteur_commission numeric(12,2) generated always as
    (case when apporteur_name is not null then greatest(prix_vente - prix_revient, 0) * 0.20
          else 0 end) stored,
  apporteur_name text,
  services_inclus text[] not null default '{}',
  pdf_url text,
  valide_jusqu_au timestamptz,
  paiement_recu boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists devis_lead_id_idx on public.devis (lead_id);

-- Verrouillage des montants une fois le deal gagné (règle S03 du brief).
create or replace function public.lock_won_devis()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.leads l
    where l.id = new.lead_id and l.status = 'won'
  ) then
    if new.prix_vente is distinct from old.prix_vente
       or new.prix_revient is distinct from old.prix_revient then
      raise exception 'Devis verrouillé : le lead lié est en statut won.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists devis_lock_won on public.devis;
create trigger devis_lock_won
  before update on public.devis
  for each row execute function public.lock_won_devis();

-- ─── CONVERSATIONS (chatbot Ola) ────────────────────────────────────────
create table if not exists public.conversations_ola (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  channel text not null default 'web',     -- web | whatsapp | instagram
  lang text not null default 'fr',
  messages jsonb not null default '[]'::jsonb,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── FLIGHTS (cache scraping admin) ─────────────────────────────────────
create table if not exists public.flights (
  id text primary key,
  external_id text unique,
  title text,
  url text,
  price numeric(12,2),
  currency text,
  source text,
  status text not null default 'scraped',
  route jsonb,
  meta jsonb,
  location text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flights_status_idx on public.flights (status);
create index if not exists flights_created_at_idx on public.flights (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — à activer dans une migration 002 quand l'auth réelle sera branchée.
--   alter table public.devis enable row level security;
--   create policy "prix_revient_admin_dalsim" on public.devis ...
--   (règles S01 → S05)
-- ─────────────────────────────────────────────────────────────────────────
