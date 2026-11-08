-- Migration 018 : suivi d'activité de l'équipe (SQLite)
CREATE TABLE IF NOT EXISTS user_activity_days (
  id             TEXT PRIMARY KEY,
  user_email     TEXT NOT NULL,
  day            TEXT NOT NULL,
  first_seen     INTEGER,
  last_seen      INTEGER,
  last_active    INTEGER,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  logins         INTEGER NOT NULL DEFAULT 0,
  last_page      TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_activity_days_day_idx ON user_activity_days (day, user_email);

CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  lead_id    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log (user_email, created_at DESC);
