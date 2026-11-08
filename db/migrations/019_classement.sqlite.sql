-- Migration 019 : dashboard et classement de l'équipe (SQLite)
ALTER TABLE devis ADD COLUMN paid_at INTEGER;
UPDATE devis SET paid_at = updated_at WHERE paiement_recu = 1 AND paid_at IS NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  id         TEXT PRIMARY KEY,
  value      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
