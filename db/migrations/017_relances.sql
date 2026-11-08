-- Migration 017 : relances automatiques + messages types (Supabase / Postgres).
-- À exécuter dans le SQL Editor AVANT de déployer.
--
-- leads.followup_step : nombre de relances envoyées sans réponse (0 = pas encore relancé)
-- message_templates   : bibliothèque de messages DM, éditable par l'admin

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS followup_step integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS leads_next_followup_idx ON public.leads (next_followup);

CREATE TABLE IF NOT EXISTS public.message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category   text NOT NULL,          -- premier_contact | relance_1 | relance_2 | relance_3 | devis | apres_vente | autre
  title      text NOT NULL,
  body       text NOT NULL,
  sort       integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
