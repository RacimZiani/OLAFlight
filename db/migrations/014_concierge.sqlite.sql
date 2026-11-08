-- Migration 014 : compte Concierge (SQLite)
-- SQLite ne sait pas modifier un CHECK : on recrée la table users.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','prospecteur','closer','concierge','dalsim','closeuse','agent')),
  display_name    TEXT,
  whatsapp        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  commission_rate REAL,
  monthly_goal    REAL
);

INSERT INTO users_new (id, email, password_hash, role, display_name, whatsapp, active, created_at, updated_at)
  SELECT id, email, password_hash, role, display_name, whatsapp, active, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_role_idx  ON users(role);

PRAGMA foreign_keys = ON;

ALTER TABLE devis ADD COLUMN concierge_name TEXT;
ALTER TABLE devis ADD COLUMN concierge_commission REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS devis_concierge_name_idx ON devis (concierge_name);
