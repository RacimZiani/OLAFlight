-- Devis libre (sans lead) : stocke le nom du client directement sur le devis
ALTER TABLE devis ADD COLUMN IF NOT EXISTS client_name TEXT;
