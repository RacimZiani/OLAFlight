-- Champs vol retour et villes pour la création de devis depuis dalsim.
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS ville_dep text DEFAULT '';
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS ville_arr text DEFAULT '';
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS horaire_dep_retour text DEFAULT '';
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS horaire_arr_retour text DEFAULT '';
