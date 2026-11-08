-- Migration 014 : compte Concierge (Supabase / Postgres)
-- À exécuter dans le SQL Editor Supabase AVANT de déployer le code.
--
-- • nouveau rôle 'concierge' (fait tout de A à Z : prospection, devis, closing)
-- • taux de commission et objectif mensuel réglables par utilisateur
-- • commission concierge stockée sur le devis (calculée côté app, pas en
--   colonne GENERATED : le taux varie d'une concierge à l'autre)

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'concierge';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2),          -- % de la marge, null = taux par défaut (15)
  ADD COLUMN IF NOT EXISTS monthly_goal    numeric(12,2);          -- objectif de commissions du mois (€)

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS concierge_name       text,              -- email de la concierge
  ADD COLUMN IF NOT EXISTS concierge_commission numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS devis_concierge_name_idx ON public.devis (concierge_name);
