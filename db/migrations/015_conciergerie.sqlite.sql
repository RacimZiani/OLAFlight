-- Migration 015 : devis de conciergerie multi-prestations + coordonnées client (SQLite)
ALTER TABLE devis ADD COLUMN kind TEXT NOT NULL DEFAULT 'vol';
ALTER TABLE devis ADD COLUMN prestations TEXT;
ALTER TABLE devis ADD COLUMN validite_jours INTEGER;

ALTER TABLE leads ADD COLUMN phone TEXT;
ALTER TABLE leads ADD COLUMN instagram TEXT;
ALTER TABLE leads ADD COLUMN email TEXT;

CREATE INDEX IF NOT EXISTS leads_phone_idx     ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_instagram_idx ON leads (instagram);
CREATE INDEX IF NOT EXISTS leads_email_idx     ON leads (email);
