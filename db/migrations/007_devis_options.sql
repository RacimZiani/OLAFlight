-- Devis multi-options (3 propositions par devis).
-- Run in Supabase SQL Editor.

alter table public.devis
  add column if not exists options jsonb not null default '[]'::jsonb;

comment on column public.devis.options is
  'Liste des propositions alternatives (compagnie, horaires, prix, services). UI affiche jusquà 3 options.';
