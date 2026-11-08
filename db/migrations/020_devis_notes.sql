-- Migration 020 : colonne « notes » sur les devis (Supabase / Postgres).
-- Elle existait en SQLite mais pas en prod : les informations pour le client
-- saisies sur un devis (conciergerie ou vol) n'étaient pas enregistrées.
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS notes text;
