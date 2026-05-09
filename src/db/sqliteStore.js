// ─────────────────────────────────────────────────────────────────────────
// SQLite store — backend par défaut. Zéro setup, fichier unique data/ola-flight.db.
// Même interface que jsonStore : flights / leads / devis / apporteurs / conversations_ola / users
//
// Différences avec JSON :
//   - certains champs sont sérialisés en TEXT (JSON.stringify) :
//       services_inclus, route, meta, messages
//   - les booléens sont stockés en INTEGER (0/1)
//   - on auto-coerce à la lecture pour que l'API publique reste identique
// ─────────────────────────────────────────────────────────────────────────

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { uid } from "../lib/ids.js";

const log = createLogger("db:sqlite");

let _db;

// Champs "JSON" : on parse à la lecture, stringify à l'écriture.
const JSON_FIELDS = {
  flights: ["route", "meta"],
  leads: [],
  devis: ["services_inclus", "options", "hotels", "driver"],
  apporteurs: [],
  conversations_ola: ["messages"],
  agent_actions: ["input", "output"],
  users: [],
  notifications: ["meta"],
};

// Champs "boolean" stockés en INTEGER : on coerce à la lecture.
const BOOL_FIELDS = {
  flights: [],
  leads: ["urgent", "needs_hotel", "needs_driver"],
  devis: ["paiement_recu"],
  apporteurs: [],
  conversations_ola: [],
  agent_actions: [],
  users: ["active"],
  notifications: ["read"],
};

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(config.sqlite.dir, { recursive: true });
  _db = new Database(config.sqlite.path);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  log.info(`opened ${config.sqlite.path}`);
  return _db;
}

function decodeRow(table, row) {
  if (!row) return row;
  const jsonFields = JSON_FIELDS[table] || [];
  const boolFields = BOOL_FIELDS[table] || [];
  const out = { ...row };
  for (const f of jsonFields) {
    if (typeof out[f] === "string") {
      try { out[f] = JSON.parse(out[f]); } catch { out[f] = null; }
    }
  }
  for (const f of boolFields) {
    out[f] = Boolean(out[f]);
  }
  return out;
}

function encodeRow(table, row) {
  const jsonFields = JSON_FIELDS[table] || [];
  const boolFields = BOOL_FIELDS[table] || [];
  const out = { ...row };
  for (const f of jsonFields) {
    if (out[f] !== undefined && typeof out[f] !== "string") {
      out[f] = JSON.stringify(out[f] ?? null);
    }
  }
  for (const f of boolFields) {
    if (out[f] !== undefined) out[f] = out[f] ? 1 : 0;
  }
  return out;
}

// Liste blanche des colonnes par table (auto-générée à la 1ère utilisation).
const _columnsCache = new Map();
function getColumns(table) {
  if (_columnsCache.has(table)) return _columnsCache.get(table);
  const db = getDb();
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const cols = rows.map((r) => r.name);
  _columnsCache.set(table, cols);
  return cols;
}

function pickKnownColumns(table, row) {
  const cols = new Set(getColumns(table));
  const out = {};
  for (const [k, v] of Object.entries(row)) if (cols.has(k)) out[k] = v;
  return out;
}

function buildCollection(table, options = {}) {
  const { idField = "id", orderBy = "created_at DESC" } = options;
  const db = () => getDb();

  return {
    async list() {
      const rows = db().prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
      return rows.map((r) => decodeRow(table, r));
    },
    async findById(id) {
      const row = db().prepare(`SELECT * FROM ${table} WHERE ${idField} = ?`).get(id);
      return decodeRow(table, row || null);
    },
    async findByField(field, value) {
      const row = db().prepare(`SELECT * FROM ${table} WHERE ${field} = ?`).get(value);
      return decodeRow(table, row || null);
    },
    async insert(row) {
      const now = Date.now();
      const full = pickKnownColumns(table, encodeRow(table, {
        id: row[idField] || uid(),
        ...row,
        created_at: row.created_at || now,
        updated_at: now,
      }));
      const cols = Object.keys(full);
      const placeholders = cols.map((c) => `@${c}`).join(", ");
      const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
      db().prepare(sql).run(full);
      const row2 = db().prepare(`SELECT * FROM ${table} WHERE ${idField} = ?`).get(full[idField]);
      return decodeRow(table, row2);
    },
    async update(id, patch) {
      const known = pickKnownColumns(table, encodeRow(table, { ...patch, updated_at: Date.now() }));
      const cols = Object.keys(known).filter((c) => c !== idField);
      if (cols.length === 0) {
        const row = db().prepare(`SELECT * FROM ${table} WHERE ${idField} = ?`).get(id);
        return decodeRow(table, row || null);
      }
      const set = cols.map((c) => `${c} = @${c}`).join(", ");
      const sql = `UPDATE ${table} SET ${set} WHERE ${idField} = @__id`;
      db().prepare(sql).run({ ...known, __id: id });
      const row = db().prepare(`SELECT * FROM ${table} WHERE ${idField} = ?`).get(id);
      return decodeRow(table, row || null);
    },
    async remove(id) {
      const r = db().prepare(`DELETE FROM ${table} WHERE ${idField} = ?`).run(id);
      return r.changes;
    },
    /**
     * Réécriture en masse : DELETE-then-INSERT dans une transaction.
     * Utilisé par /api/admin/flights/purge — pas une opération courante.
     */
    async save(items) {
      const tx = db().transaction((rows) => {
        db().prepare(`DELETE FROM ${table}`).run();
        const insert = (row) => {
          const full = pickKnownColumns(table, encodeRow(table, {
            ...row,
            id: row.id || uid(),
            created_at: row.created_at || Date.now(),
            updated_at: row.updated_at || Date.now(),
          }));
          const cols = Object.keys(full);
          db()
            .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`)
            .run(full);
        };
        for (const r of rows) insert(r);
      });
      tx(items);
      return items.length;
    },
    /**
     * Filtre arbitraire : findAll({ status: 'devis_pending' }) → [...].
     */
    async findAll(filter = {}) {
      const cols = Object.keys(filter);
      const where = cols.length ? "WHERE " + cols.map((c) => `${c} = @${c}`).join(" AND ") : "";
      const rows = db().prepare(`SELECT * FROM ${table} ${where} ORDER BY ${orderBy}`).all(filter);
      return rows.map((r) => decodeRow(table, r));
    },
  };
}

export function createSqliteStore() {
  return {
    flights:           buildCollection("flights"),
    leads:             buildCollection("leads"),
    devis:             buildCollection("devis"),
    apporteurs:        buildCollection("apporteurs"),
    conversations_ola: buildCollection("conversations_ola"),
    agent_actions:     buildCollection("agent_actions"),
    notifications:     buildCollection("notifications"),
    users:             buildCollection("users", { orderBy: "created_at ASC" }),
    raw: getDb,
    async ready() {
      getDb(); // throw early si chemin inaccessible
    },
  };
}
