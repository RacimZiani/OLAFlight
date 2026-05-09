-- Notifications (cloche CRM + push mobile futur).
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,

  user_email  TEXT,
  user_role   TEXT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  lead_id     TEXT,
  devis_id    TEXT,
  meta        TEXT,
  read        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (user_email, user_role, read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_lead_idx ON notifications (lead_id);
