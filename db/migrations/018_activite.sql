-- Migration 018 : suivi d'activité de l'équipe (Supabase / Postgres).
-- À exécuter dans le SQL Editor AVANT de déployer.
--
-- user_activity_days : une ligne par personne et par jour (heure de Paris)
--   id = "<email>|<AAAA-MM-JJ>", temps actif mesuré par le back-office
--   (une pulsation par minute quand l'onglet est visible et utilisé).
-- activity_log : journal des actions (connexion, client créé, devis, DM, statut…)
--
-- Les concierges doivent être informées de ce suivi (RGPD / CNIL).

CREATE TABLE IF NOT EXISTS public.user_activity_days (
  id             text PRIMARY KEY,
  user_email     text NOT NULL,
  day            text NOT NULL,
  first_seen     timestamptz,
  last_seen      timestamptz,
  last_active    timestamptz,
  active_seconds integer NOT NULL DEFAULT 0,
  logins         integer NOT NULL DEFAULT 0,
  last_page      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_activity_days_day_idx ON public.user_activity_days (day, user_email);

CREATE TABLE IF NOT EXISTS public.activity_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  type       text NOT NULL,
  label      text NOT NULL DEFAULT '',
  lead_id    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_user_idx ON public.activity_log (user_email, created_at DESC);

ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
