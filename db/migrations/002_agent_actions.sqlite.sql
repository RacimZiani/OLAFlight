-- ─────────────────────────────────────────────────────────────────────────
-- Agent audit trail (SQLite)
-- Enregistre chaque action effectuée par l'agent IA (tools) pour suivi CRM.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_actions (
  id              TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  actor           TEXT NOT NULL DEFAULT 'agent',  -- agent | user | system
  channel         TEXT NOT NULL DEFAULT 'web',    -- web | whatsapp | instagram | backoffice
  conversation_id TEXT,
  lead_id         TEXT,

  action          TEXT NOT NULL,                  -- tool name / action code
  status          TEXT NOT NULL DEFAULT 'ok',     -- ok | error
  input           TEXT,                           -- JSON
  output          TEXT,                           -- JSON
  error           TEXT
);

CREATE INDEX IF NOT EXISTS agent_actions_created_at_idx ON agent_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS agent_actions_lead_id_idx    ON agent_actions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_actions_conv_id_idx    ON agent_actions(conversation_id, created_at DESC);

