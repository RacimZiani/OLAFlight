// Suivi d'activité de l'équipe : temps actif, connexions, actions.
//
// Temps actif : le back-office envoie une pulsation par minute quand l'onglet
// est visible ET que la personne a touché la page dans les 2 dernières minutes.
// On ajoute le temps écoulé depuis la dernière pulsation active, plafonné à
// 90 s : une pause, un onglet oublié ou deux onglets ouverts ne gonflent pas
// le compteur.
//
// Rien ici ne doit casser une action métier : toutes les erreurs sont avalées.

import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { uid, uuidv4 } from "./ids.js";
import { createLogger } from "../logger.js";

const log = createLogger("activite");
const MAX_GAP_MS = 90 * 1000;
const isSupabase = () => config.storage.driver === "supabase";
const asDb = (ms) => (isSupabase() ? new Date(ms).toISOString() : ms);
export const toMs = (v) => (v == null || v === "" ? 0 : typeof v === "number" ? v : Date.parse(v) || 0);

/** Jour au format AAAA-MM-JJ, heure de Paris. */
export const parisDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

async function upsertDay(store, email, fn) {
  const day = parisDay();
  const id = `${email}|${day}`;
  const now = Date.now();
  const row = await store.activity_days.findById(id);
  if (!row) {
    const base = { id, user_email: email, day, first_seen: null, last_seen: null, last_active: null, active_seconds: 0, logins: 0 };
    const fresh = { ...base, ...fn(base, now) };
    try {
      return await store.activity_days.insert({ ...fresh, created_at: asDb(now), updated_at: asDb(now) });
    } catch {
      // Deux pulsations simultanées (deux onglets) : la ligne vient d'être créée, on met à jour.
      const again = await store.activity_days.findById(id);
      if (!again) throw new Error("ligne d'activité introuvable");
      return store.activity_days.update(id, fn(again, now));
    }
  }
  return store.activity_days.update(id, fn(row, now));
}

/** Pulsation du back-office. */
export async function recordPing(user, { active, page }) {
  if (!user?.email) return;
  try {
    const store = await getStore();
    if (!store.activity_days) return;
    await upsertDay(store, user.email, (row, now) => {
      const lastActive = toMs(row.last_active);
      const gain = active && lastActive ? Math.min(Math.max(now - lastActive, 0), MAX_GAP_MS) : 0;
      return {
        first_seen: row.first_seen || asDb(now),
        last_seen: asDb(now),
        ...(active ? { last_active: asDb(now) } : {}),
        active_seconds: (Number(row.active_seconds) || 0) + Math.round(gain / 1000),
        last_page: String(page || "").slice(0, 80) || row.last_page || null,
      };
    });
  } catch (e) {
    log.warn(`pulsation ${user.email} : ${e?.message || e}`);
  }
}

/** Connexion réussie. */
export async function recordLogin(user) {
  if (!user?.email) return;
  try {
    const store = await getStore();
    if (store.activity_days) {
      await upsertDay(store, user.email, (row, now) => ({
        first_seen: row.first_seen || asDb(now),
        last_seen: asDb(now),
        last_active: asDb(now),
        logins: (Number(row.logins) || 0) + 1,
      }));
    }
    await logAction(user, "login", "Connexion");
  } catch (e) {
    log.warn(`connexion ${user.email} : ${e?.message || e}`);
  }
}

/**
 * Action métier pour le journal de la direction.
 * types : login, client_cree, devis_cree, devis_modifie, devis_paye, echange, statut
 */
export async function logAction(user, type, label, lead_id = null) {
  if (!user?.email) return;
  try {
    const store = await getStore();
    if (!store.activity_log) return;
    const now = Date.now();
    await store.activity_log.insert({
      id: isSupabase() ? uuidv4() : uid(),
      user_email: user.email,
      type,
      label: String(label || "").slice(0, 200),
      lead_id: lead_id ? String(lead_id) : null,
      created_at: asDb(now),
      updated_at: asDb(now),
    });
  } catch (e) {
    log.warn(`journal ${type} ${user.email} : ${e?.message || e}`);
  }
}
