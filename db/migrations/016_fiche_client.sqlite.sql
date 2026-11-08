-- Migration 016 : fiche client complète (SQLite)
ALTER TABLE leads ADD COLUMN preferences TEXT;

CREATE TABLE IF NOT EXISTS client_events (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_email TEXT,
  type         TEXT NOT NULL DEFAULT 'note',
  channel      TEXT,
  body         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS client_events_lead_idx ON client_events (lead_id, created_at DESC);
