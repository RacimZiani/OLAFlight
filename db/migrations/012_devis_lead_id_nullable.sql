-- Permet les devis libres (sans lead associé) créés depuis dalsim.
-- lead_id reste une FK valide vers leads.id quand elle est renseignée.
ALTER TABLE public.devis ALTER COLUMN lead_id DROP NOT NULL;
