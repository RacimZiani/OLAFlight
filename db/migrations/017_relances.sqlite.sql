-- Migration 017 : relances automatiques + messages types (SQLite)
ALTER TABLE leads ADD COLUMN followup_step INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS leads_next_followup_idx ON leads (next_followup);

CREATE TABLE IF NOT EXISTS message_templates (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
