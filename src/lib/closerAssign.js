// Auto-dispatch d'un lead vers un closer.
// Stratégie : "least loaded round-robin" — on prend la closeuse active avec
// le moins de leads ouverts (pas won/lost/archived). À égalité, on prend la
// plus ancienne (created_at ASC) pour répartir au démarrage.

import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("dispatch");

const OPEN_STATUSES = new Set([
  "qualification",
  "new",
  "contacted",
  "devis_pending",
  "devis_sent",
  "interested",
  "call_booked",
  "offer",
  "nego",
]);

/**
 * Choisit un closer pour un nouveau lead. Renvoie son email ou null.
 */
export async function pickCloserForLead({ excludeEmail = null } = {}) {
  const store = await getStore();
  if (!store.users?.list) return null;

  let users = [];
  try {
    users = await store.users.list();
  } catch (e) {
    log.warn(`users.list failed: ${e?.message || e}`);
    return null;
  }
  const closers = users.filter((u) => {
    const role = String(u.role || "").toLowerCase();
    if (role !== "closeuse" && role !== "closer") return false;
    if (u.active === false) return false;
    if (excludeEmail && u.email === excludeEmail) return false;
    return true;
  });
  if (closers.length === 0) return null;

  let leads = [];
  try {
    leads = await store.leads.list();
  } catch (e) {
    log.warn(`leads.list failed: ${e?.message || e}`);
  }

  const loadByEmail = new Map();
  for (const c of closers) loadByEmail.set(c.email, 0);
  for (const l of leads) {
    if (!l.closer_name || !OPEN_STATUSES.has(String(l.status || ""))) continue;
    if (loadByEmail.has(l.closer_name)) {
      loadByEmail.set(l.closer_name, loadByEmail.get(l.closer_name) + 1);
    }
  }

  closers.sort((a, b) => {
    const la = loadByEmail.get(a.email) || 0;
    const lb = loadByEmail.get(b.email) || 0;
    if (la !== lb) return la - lb;
    const ta = typeof a.created_at === "number" ? a.created_at : Date.parse(a.created_at) || 0;
    const tb = typeof b.created_at === "number" ? b.created_at : Date.parse(b.created_at) || 0;
    return ta - tb;
  });
  const chosen = closers[0];
  log.info(`auto-assign lead → ${chosen.email} (load=${loadByEmail.get(chosen.email) || 0})`);
  return chosen.email;
}
