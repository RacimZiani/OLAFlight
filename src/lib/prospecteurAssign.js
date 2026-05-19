// Auto-dispatch d'un lead vers un prospecteur (apporteur_name = email user).

import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";
import { normalizeRole, ROLES } from "./roles.js";

const log = createLogger("dispatch:prospecteur");

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

export async function pickProspecteurForLead({ excludeEmail = null } = {}) {
  const store = await getStore();
  if (!store.users?.list) return null;

  let users = [];
  try {
    users = await store.users.list();
  } catch (e) {
    log.warn(`users.list failed: ${e?.message || e}`);
    return null;
  }

  const prospecteurs = users.filter((u) => {
    const role = normalizeRole(u.role);
    if (role !== ROLES.PROSPECTEUR) return false;
    if (u.active === false) return false;
    if (excludeEmail && u.email === excludeEmail) return false;
    return true;
  });
  if (prospecteurs.length === 0) return null;

  let leads = [];
  try {
    leads = await store.leads.list();
  } catch {
    /* best effort */
  }

  const loadByEmail = new Map();
  for (const p of prospecteurs) loadByEmail.set(p.email, 0);
  for (const l of leads) {
    if (!l.apporteur_name || !OPEN_STATUSES.has(String(l.status || ""))) continue;
    if (loadByEmail.has(l.apporteur_name)) {
      loadByEmail.set(l.apporteur_name, loadByEmail.get(l.apporteur_name) + 1);
    }
  }

  prospecteurs.sort((a, b) => {
    const la = loadByEmail.get(a.email) || 0;
    const lb = loadByEmail.get(b.email) || 0;
    if (la !== lb) return la - lb;
    const ta = typeof a.created_at === "number" ? a.created_at : Date.parse(a.created_at) || 0;
    const tb = typeof b.created_at === "number" ? b.created_at : Date.parse(b.created_at) || 0;
    return ta - tb;
  });

  const chosen = prospecteurs[0];
  log.info(`auto-assign prospecteur → ${chosen.email} (load=${loadByEmail.get(chosen.email) || 0})`);
  return chosen.email;
}
