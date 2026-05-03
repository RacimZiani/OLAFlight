-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — Row Level Security policies
-- À exécuter APRÈS 001_init.sql.
-- Ces règles n'ont d'effet réel que quand l'app utilise des clients Supabase
-- créés avec le JWT utilisateur (pas la SERVICE ROLE KEY qui bypass RLS).
--
-- Règles S01-S05 (confidentialité / RLS).
-- ─────────────────────────────────────────────────────────────────────────

-- Helper : extrait le rôle depuis le JWT Supabase Auth (custom claim 'role').
create or replace function public.current_role_text()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
    'guest'
  );
$$;

create or replace function public.current_email()
returns text language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    ''
  );
$$;

-- ─── ENABLE RLS ─────────────────────────────────────────────────────────
alter table public.users          enable row level security;
alter table public.apporteurs     enable row level security;
alter table public.leads          enable row level security;
alter table public.devis          enable row level security;
alter table public.conversations_ola enable row level security;
alter table public.flights        enable row level security;

-- ─── USERS ──────────────────────────────────────────────────────────────
drop policy if exists users_admin_all      on public.users;
drop policy if exists users_self_select    on public.users;
create policy users_admin_all on public.users for all
  using (current_role_text() = 'admin');
create policy users_self_select on public.users for select
  using (email = current_email());

-- ─── APPORTEURS (S05) ──────────────────────────────────────────────────
drop policy if exists apporteurs_rw_admin_dalsim on public.apporteurs;
create policy apporteurs_rw_admin_dalsim on public.apporteurs for all
  using (current_role_text() in ('admin','dalsim'));

-- ─── LEADS (S02) ────────────────────────────────────────────────────────
drop policy if exists leads_admin_dalsim_all   on public.leads;
drop policy if exists leads_closeuse_own       on public.leads;
drop policy if exists leads_agent_read_active  on public.leads;
create policy leads_admin_dalsim_all on public.leads for all
  using (current_role_text() in ('admin','dalsim'));
create policy leads_closeuse_own on public.leads for all
  using (
    current_role_text() = 'closeuse'
    and closer_name = current_email()
  );
create policy leads_agent_read_active on public.leads for select
  using (
    current_role_text() = 'agent'
    and status not in ('won','lost','archived')
  );

-- ─── DEVIS (S01 — prix_revient confidentiel) ───────────────────────────
-- L'enforcement column-level (cacher prix_revient/marge/commissions à la
-- closeuse) se fait côté API via sanitizeDevisForRole() — Postgres ne
-- supporte pas les RLS au niveau colonne sans recourir à des vues. On
-- crée donc une VIEW publique pour les rôles non-admin/dalsim.

drop policy if exists devis_admin_dalsim_all on public.devis;
drop policy if exists devis_closeuse_select  on public.devis;
create policy devis_admin_dalsim_all on public.devis for all
  using (current_role_text() in ('admin','dalsim'));

create or replace view public.devis_public as
  select id, lead_id, compagnie, horaire_dep, horaire_arr,
         prix_vente, prix_marche, services_inclus, pdf_url,
         valide_jusqu_au, paiement_recu, created_at, updated_at
  from public.devis;

grant select on public.devis_public to authenticated;

create policy devis_closeuse_select on public.devis for select
  using (
    current_role_text() = 'closeuse'
    and exists (
      select 1 from public.leads l
      where l.id = devis.lead_id and l.closer_name = current_email()
    )
  );

-- ─── CONVERSATIONS_OLA ──────────────────────────────────────────────────
drop policy if exists convs_admin_dalsim on public.conversations_ola;
create policy convs_admin_dalsim on public.conversations_ola for all
  using (current_role_text() in ('admin','dalsim','agent'));

-- ─── FLIGHTS (cache scraping admin) ─────────────────────────────────────
drop policy if exists flights_admin on public.flights;
create policy flights_admin on public.flights for all
  using (current_role_text() = 'admin');
