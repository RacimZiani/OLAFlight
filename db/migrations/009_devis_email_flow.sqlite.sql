-- Flux devis email (Agent Ola web)
ALTER TABLE devis ADD COLUMN pricing_status TEXT DEFAULT 'pending_admin';
ALTER TABLE devis ADD COLUMN email_sent_at INTEGER;
ALTER TABLE devis ADD COLUMN client_decision TEXT;
ALTER TABLE devis ADD COLUMN client_decision_at INTEGER;
