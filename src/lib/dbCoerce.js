/**
 * Coercion sûre pour Postgres / Supabase / SQLite (booléens en INTEGER 0/1 côté SQLite).
 * z.coerce.boolean() traite la chaîne "false" comme true (Boolean("false") === true).
 */

export function parseBoolish(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "non", "n"].includes(s)) return false;
  if (["true", "1", "yes", "oui", "o", "y"].includes(s)) return true;
  return Boolean(v);
}

export function parsePassagers(v, defaultVal = 1) {
  if (v === undefined || v === null || v === "") return defaultVal;
  if (typeof v === "boolean") return v ? 1 : defaultVal;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["false", "non", "no", "n/a", "na"].includes(s)) return defaultVal;
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n >= 1) return n;
    return defaultVal;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.floor(n);
}

/** 0/1 — compatible SQLite INTEGER et Postgres boolean/integer. */
export function leadBoolForDb(v) {
  return parseBoolish(v) ? 1 : 0;
}

const LEAD_BOOL_FIELDS = ["urgent", "needs_hotel", "needs_driver"];

export function coerceLeadRowForDb(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const f of LEAD_BOOL_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = leadBoolForDb(out[f]);
    }
  }
  if (out.passagers !== undefined && out.passagers !== null) {
    out.passagers = parsePassagers(out.passagers, 1);
  }
  return out;
}

/** À la lecture : 0/1 ou bool → bool pour l'API. */
export function decodeLeadBools(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of LEAD_BOOL_FIELDS) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = parseBoolish(out[f]);
    }
  }
  return out;
}
