// ─────────────────────────────────────────────────────────────────────────
// Adapter Supabase — même interface que jsonStore (collections.list/insert/update/remove/findById).
//
// Pré-requis :
//   1. Créer le projet Supabase
//   2. Exécuter db/migrations/001_init.sql (et 002_rls.sql plus tard)
//   3. Renseigner SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env
//   4. STORAGE_DRIVER=supabase
//
// On utilise la SERVICE ROLE KEY (server-only, bypass RLS) — l'enforcement
// des règles métier (sanitize devis, filter leads par closeuse) reste appliqué
// côté Express (commissions.js, middlewares). Quand on aura un vrai JWT user,
// on pourra créer des clients Supabase avec le token utilisateur pour bénéficier
// du RLS natif.
// ─────────────────────────────────────────────────────────────────────────

import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { coerceLeadRowForDb, decodeLeadBools } from "../lib/dbCoerce.js";

const log = createLogger("db:supabase");

let _client;
async function getClient() {
  if (_client) return _client;
  if (!config.storage.supabaseUrl || !config.storage.supabaseServiceKey) {
    throw new Error("Supabase non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  }
  let createClient;
  try {
    ({ createClient } = await import("@supabase/supabase-js"));
  } catch {
    throw new Error("@supabase/supabase-js non installé. `npm install @supabase/supabase-js`.");
  }
  _client = createClient(config.storage.supabaseUrl, config.storage.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  log.info("supabase client initialisé");
  return _client;
}

// Map application-level "id" (string aléatoire pour leads/devis JSON) → uuid
// Postgres : on stocke l'id existant côté JSON dans la PK (devis.id est un text,
// leads.id est uuid → on génère un uuid si absent).
function normalizeRow(table, row, { forWrite = false } = {}) {
  if (table !== "leads" || !row) return row;
  return forWrite ? coerceLeadRowForDb(row) : decodeLeadBools(row);
}

function buildCollection(table, options = {}) {
  const { idField = "id", autoTimestamps = true } = options;
  return {
    async list() {
      const supabase = await getClient();
      const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((r) => normalizeRow(table, r));
    },
    async findById(id) {
      const supabase = await getClient();
      const { data, error } = await supabase.from(table).select("*").eq(idField, id).maybeSingle();
      if (error) throw error;
      return normalizeRow(table, data || null);
    },
    async findByField(field, value) {
      const supabase = await getClient();
      const { data, error } = await supabase.from(table).select("*").eq(field, value).maybeSingle();
      if (error) throw error;
      return normalizeRow(table, data || null);
    },
    async insert(row) {
      const supabase = await getClient();
      const base = normalizeRow(table, row, { forWrite: true });
      const toIso = (v) => typeof v === "number" ? new Date(v).toISOString() : (v || new Date().toISOString());
      const payload = autoTimestamps
        ? { ...base, created_at: toIso(base.created_at), updated_at: new Date().toISOString() }
        : base;
      const { data, error } = await supabase.from(table).insert(payload).select().single();
      if (error) throw error;
      return normalizeRow(table, data);
    },
    async update(id, patch) {
      const supabase = await getClient();
      const base = normalizeRow(table, patch, { forWrite: true });
      const payload = autoTimestamps ? { ...base, updated_at: new Date().toISOString() } : base;
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq(idField, id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return normalizeRow(table, data || null);
    },
    async remove(id) {
      const supabase = await getClient();
      const { error, count } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .eq(idField, id);
      if (error) throw error;
      return count || 0;
    },
    // jsonStore expose `save(items)` pour réécriture en masse (utilisé par /api/admin/flights/purge).
    // Côté Postgres : delete-then-insert n'est pas safe. On expose l'opération via une fonction
    // dédiée (deleteWhere) que les routes peuvent appeler explicitement.
    async save() {
      throw new Error(
        `${table}.save() non supporté en Supabase — utiliser deleteWhere() / insert() de manière atomique.`
      );
    },
    async deleteWhere(filter = {}) {
      const supabase = await getClient();
      let q = supabase.from(table).delete({ count: "exact" });
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { error, count } = await q;
      if (error) throw error;
      return count || 0;
    },
  };
}

export function createSupabaseStore() {
  const store = {
    flights: buildCollection("flights"),
    leads: buildCollection("leads"),
    devis: buildCollection("devis"),
    apporteurs: buildCollection("apporteurs"),
    conversations_ola: buildCollection("conversations_ola"),
    agent_actions: buildCollection("agent_actions"),
    notifications: buildCollection("notifications"),
    users: buildCollection("users"),
    async ready() {
      await getClient(); // throw early si conf manquante
    },
  };
  return store;
}
