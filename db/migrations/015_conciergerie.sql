-- Migration 015 : devis de conciergerie multi-prestations + coordonnées client
-- (Supabase / Postgres). À exécuter dans le SQL Editor AVANT de déployer.
--
-- devis.kind        : 'vol' (devis historique) | 'conciergerie' (multi-prestations)
-- devis.prestations : [{ type, titre, details{}, description, quantite,
--                        prix_unitaire, prix_achat_unitaire, sur_devis }]
--                     prix_achat_unitaire est CONFIDENTIEL (retiré avant PDF / closers)
-- devis.validite_jours : durée de validité affichée sur le PDF conciergerie
-- leads.phone / instagram / email : coordonnées séparées (fiche client, anti-doublon)

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS kind           text NOT NULL DEFAULT 'vol',
  ADD COLUMN IF NOT EXISTS prestations    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validite_jours integer;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone     text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS email     text;

CREATE INDEX IF NOT EXISTS leads_phone_idx     ON public.leads (phone);
CREATE INDEX IF NOT EXISTS leads_instagram_idx ON public.leads (lower(instagram));
CREATE INDEX IF NOT EXISTS leads_email_idx     ON public.leads (lower(email));
