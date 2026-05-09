-- Champs métier supplémentaires : type client + besoins hôtel/chauffeur.
-- Run in Supabase SQL Editor.

alter table public.leads
  add column if not exists client_type      text,                  -- "particulier" | "pro" | "corporate"
  add column if not exists needs_hotel      boolean default false,
  add column if not exists hotel_preference text,                  -- nom, gamme (4*, 5*), zone, marques
  add column if not exists needs_driver     boolean default false,
  add column if not exists driver_pickup    text,                  -- ex: "CDG terminal 2E → Hôtel Plaza"
  add column if not exists driver_dropoff   text,
  add column if not exists extras_notes     text;

alter table public.devis
  add column if not exists hotels  jsonb not null default '[]'::jsonb, -- [{ name, stars, area, nights, total_price, notes }]
  add column if not exists driver  jsonb;                              -- { pickup, dropoff, vehicle, hours, total_price, notes }

comment on column public.leads.client_type is
  'Type de client : particulier (vol seul) → pas de comparatif marché dans le PDF. Pro / corporate → comparatif autorisé.';
comment on column public.devis.hotels is
  'Liste d\'hôtels proposés (1+) avec nuit/total. Affichés dans le PDF si présents.';
comment on column public.devis.driver is
  'Forfait chauffeur privé (pickup/dropoff/véhicule/durée/total). Affiché dans le PDF si présent.';
