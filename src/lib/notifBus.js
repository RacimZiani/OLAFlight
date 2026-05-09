// Bus interne de notifications back-office. Persiste en DB (collection
// "notifications") + log + (futur) push mobile (FCM / Expo / WebPush /
// Telegram). Pour l'instant, on se contente de la persistance + logs.

import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { uid } from "./ids.js";
import { createLogger } from "../logger.js";

const log = createLogger("notif");

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "")
  );
}

/**
 * Crée une (ou plusieurs) notification(s).
 *
 * recipients : tableau de { email?, role? } — au moins l'un des deux.
 *   - email seul : personnel (cloche pour cet utilisateur)
 *   - role seul  : broadcast vers tous les users du rôle
 *   - email+role : ciblage user (le rôle est utilisé comme métadonnée)
 *
 * Si recipients omis : broadcast role=admin par défaut.
 */
export async function notify({
  recipients = [{ role: "admin" }],
  type,
  title,
  body = "",
  lead_id = null,
  devis_id = null,
  meta = {},
}) {
  if (!type || !title) return [];
  const store = await getStore();
  if (!store.notifications?.insert) {
    log.warn(`notifications collection unavailable, skipping (${type})`);
    return [];
  }
  const isSupabase = config.storage.driver === "supabase";
  const now = Date.now();
  const out = [];
  for (const r of recipients) {
    const row = {
      ...(isSupabase ? {} : { id: uid() }),
      user_email: r.email || null,
      user_role: r.role || null,
      type: String(type).slice(0, 60),
      title: String(title).slice(0, 200),
      body: String(body || "").slice(0, 4000),
      lead_id: lead_id && (isSupabase ? isUuid(lead_id) : true) ? String(lead_id) : null,
      devis_id: devis_id ? String(devis_id) : null,
      meta: meta && typeof meta === "object" ? meta : {},
      read: false,
      created_at: isSupabase ? new Date(now).toISOString() : now,
      updated_at: isSupabase ? new Date(now).toISOString() : now,
    };
    try {
      const inserted = await store.notifications.insert(row);
      out.push(inserted);
      log.info(`+notif ${row.type} → ${row.user_email || `role:${row.user_role}`}`);
    } catch (e) {
      // Si la table n'existe pas encore (Supabase), on silence pour ne pas casser
      // les flows business. L'utilisateur fera tourner la migration 006_notifications.
      const msg = e?.message || String(e);
      if (/Could not find the table|does not exist/i.test(msg)) {
        log.warn(`notifications table missing → skipping (run db/migrations/006_notifications.sql)`);
        break;
      }
      log.warn(`notify insert failed: ${msg}`);
    }
  }
  return out;
}

/**
 * Liste les notifications visibles par un utilisateur :
 *  - destinataire direct (user_email = u.email)
 *  - broadcast par rôle (user_role = u.role)
 */
export async function listForUser(user, { limit = 50, unread = false } = {}) {
  const store = await getStore();
  if (!store.notifications?.list) return [];
  let all = [];
  try {
    all = await store.notifications.list();
  } catch (e) {
    // Table pas encore créée (Supabase) → on dégrade silencieusement.
    log.warn(`notifications.list failed (likely table missing): ${e?.message || e}`);
    return [];
  }
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const filtered = all.filter((n) => {
    const matchEmail = n.user_email && user?.email && n.user_email === user.email;
    const matchRole = !n.user_email && n.user_role && user?.role && n.user_role === user.role;
    if (!(matchEmail || matchRole)) return false;
    if (unread && n.read) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const ta = typeof a.created_at === "number" ? a.created_at : Date.parse(a.created_at) || 0;
    const tb = typeof b.created_at === "number" ? b.created_at : Date.parse(b.created_at) || 0;
    return tb - ta;
  });
  return filtered.slice(0, lim);
}

export async function markRead(id) {
  const store = await getStore();
  if (!store.notifications?.update) return null;
  return store.notifications.update(id, { read: true });
}

export async function markAllReadForUser(user) {
  const store = await getStore();
  const all = await listForUser(user, { limit: 200, unread: true });
  let n = 0;
  for (const x of all) {
    try { await store.notifications.update(x.id, { read: true }); n++; } catch { /* ignore */ }
  }
  return n;
}
