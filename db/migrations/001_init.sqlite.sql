-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — schéma SQLite (équivalent de 001_init.sql pour Postgres)
-- Différences :
--   - pas d'enums (CHECK constraints)
--   - pas de gen_random_uuid (l'app génère les ids — uid() / makeId())
--   - pas de generated columns calculées (les calculs se font dans commissions.js)
--   - JSONB → TEXT (on JSON.stringify côté app)
-- ─────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ─── USERS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dalsim','closeuse','agent')),
  display_name  TEXT,
  whatsapp      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_role_idx  ON users(role);

-- ─── APPORTEURS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apporteurs (
  id              TEXT PRIMARY KEY,
  nom             TEXT NOT NULL,
  instagram       TEXT,
  phone           TEXT,
  email           TEXT,
  reseau          TEXT,
  type_reseau     TEXT,
  taille_reseau   TEXT,
  taux_commission REAL NOT NULL DEFAULT 10.0,
  code            TEXT UNIQUE,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── LEADS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL,
  client_contact TEXT,
  canal          TEXT NOT NULL DEFAULT 'whatsapp'
                 CHECK (canal IN ('whatsapp','instagram')),
  destination    TEXT,
  dates          TEXT,
  classe         TEXT,
  passagers      INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'qualification'
                 CHECK (status IN (
                   'qualification','devis_pending','devis_sent','interested',
                   'call_booked','won','lost','archived',
                   'new','contacted','offer','nego'
                 )),
  apporteur_id   TEXT REFERENCES apporteurs(id) ON DELETE SET NULL,
  apporteur_name TEXT,
  closer_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  closer_name    TEXT,
  calendly_link  TEXT,
  next_followup  INTEGER,
  notes          TEXT,
  value          REAL NOT NULL DEFAULT 0,
  margin         REAL NOT NULL DEFAULT 0,
  urgent         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads(status);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS leads_closer_idx     ON leads(closer_name);

-- ─── DEVIS ──────────────────────────────────────────────────────────────
-- prix_revient = CONFIDENTIEL (admin/dalsim only). marge / commissions calculées
-- côté app dans commissions.js, persistées tel quel (snapshot historique).
CREATE TABLE IF NOT EXISTS devis (
  id                  TEXT PRIMARY KEY,
  lead_id             TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  compagnie           TEXT,
  horaire_dep         TEXT,
  horaire_arr         TEXT,
  prix_revient        REAL NOT NULL DEFAULT 0,
  prix_vente          REAL NOT NULL DEFAULT 0,
  prix_marche         REAL NOT NULL DEFAULT 0,
  marge               REAL NOT NULL DEFAULT 0,
  closer_commission   REAL NOT NULL DEFAULT 0,
  apporteur_commission REAL NOT NULL DEFAULT 0,
  apporteur_name      TEXT,
  services_inclus     TEXT NOT NULL DEFAULT '[]', -- JSON array
  pdf_url             TEXT,
  valide_jusqu_au     INTEGER,
  paiement_recu       INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devis_lead_id_idx ON devis(lead_id);

-- ─── CONVERSATIONS_OLA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations_ola (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE, -- "{canal}:{contact}"
  channel     TEXT NOT NULL,
  contact     TEXT NOT NULL,
  name        TEXT,
  lang        TEXT NOT NULL DEFAULT 'fr',
  lead_id     TEXT,
  messages    TEXT NOT NULL DEFAULT '[]', -- JSON array
  summary     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_key_idx ON conversations_ola(key);

-- ─── FLIGHTS (cache scraping admin) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS flights (
  id           TEXT PRIMARY KEY,
  external_id  TEXT UNIQUE,
  title        TEXT,
  url          TEXT,
  price        REAL,
  currency     TEXT,
  source       TEXT,
  status       TEXT NOT NULL DEFAULT 'scraped',
  route        TEXT, -- JSON
  meta         TEXT, -- JSON
  location     TEXT,
  image_url    TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flights_status_idx     ON flights(status);
CREATE INDEX IF NOT EXISTS flights_created_at_idx ON flights(created_at DESC);
