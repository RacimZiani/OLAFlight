-- Migration 011 : ajoute 'prospecteur' et 'closer' aux valeurs autorisées pour users.role
-- SQLite ne supporte pas ALTER COLUMN — on recrée la table.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','prospecteur','closer','dalsim','closeuse','agent')),
  display_name  TEXT,
  whatsapp      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

INSERT INTO users_new SELECT * FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_role_idx  ON users(role);

PRAGMA foreign_keys = ON;
