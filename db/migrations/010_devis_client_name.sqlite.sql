-- Devis libre (sans lead) : stocke le nom du client directement sur le devis
ALTER TABLE devis ADD COLUMN client_name TEXT;
