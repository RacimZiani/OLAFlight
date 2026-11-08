-- Migration 016 : fiche client complète (Supabase / Postgres).
-- À exécuter dans le SQL Editor AVANT de déployer.
--
-- leads.preferences : goûts, tailles, marques, habitudes du client
-- client_events     : historique des échanges saisis par l'équipe
--                     (DM envoyé / reçu, appel, rendez-vous, note)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS preferences text;

CREATE TABLE IF NOT EXISTS public.client_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_email text,
  type         text NOT NULL DEFAULT 'note',   -- note | dm_out | dm_in | call | meeting
  channel      text,                            -- instagram | whatsapp | phone | email | autre
  body         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_events_lead_idx ON public.client_events (lead_id, created_at DESC);

-- Même politique que les autres tables : accès via la service role key du serveur uniquement.
ALTER TABLE public.client_events ENABLE ROW LEVEL SECURITY;
