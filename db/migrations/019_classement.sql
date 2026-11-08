-- Migration 019 : dashboard et classement de l'équipe (Supabase / Postgres).
-- À exécuter dans le SQL Editor AVANT de déployer.
--
-- devis.paid_at : date du paiement (une vente compte dans la période où elle est payée)
-- app_settings  : réglages modifiables par la direction (visibilité du classement…)

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Devis déjà payés : on prend la dernière mise à jour comme date de paiement.
UPDATE public.devis SET paid_at = updated_at WHERE paiement_recu = true AND paid_at IS NULL;

CREATE TABLE IF NOT EXISTS public.app_settings (
  id         text PRIMARY KEY,           -- nom du réglage
  value      jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
