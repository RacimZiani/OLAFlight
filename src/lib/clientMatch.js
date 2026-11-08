// Identité client : normalisation des coordonnées et recherche de doublons.
//
// Un même client peut être saisi « 06 12 34 56 78 », « +33612345678 » ou
// « 0033 6 12 34 56 78 » ; son Instagram « @Marc.D », « marc.d » ou
// « https://instagram.com/marc.d/ ». On compare toujours les formes normalisées.

import { config } from "../config.js";
import { uid, uuidv4 } from "./ids.js";
import { normalizeRole, ROLES } from "./roles.js";

/** Téléphone → chiffres au format international sans « + » (FR par défaut). */
export function normalizePhone(v) {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 10 && d.startsWith("0")) d = "33" + d.slice(1); // 06… → 336…
  d = d.replace(/\D/g, "");
  return d.length >= 8 ? d : "";
}

/** Instagram → identifiant seul, en minuscules, sans @ ni URL. */
export function normalizeInstagram(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/[/?#].*$/, "");
  s = s.replace(/^@+/, "");
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : "";
}

export function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

/** Nom → minuscules sans accents ni espaces multiples (pour comparer). */
export function normalizeName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Coordonnées normalisées d'un lead, y compris l'ancien champ libre
 * client_contact (numéro ou @insta selon le canal).
 */
export function leadIdentity(lead) {
  const contact = String(lead?.client_contact || "");
  return {
    phone: normalizePhone(lead?.phone) || normalizePhone(contact),
    instagram: normalizeInstagram(lead?.instagram) || (contact.trim().startsWith("@") || lead?.canal === "instagram" ? normalizeInstagram(contact) : ""),
    email: normalizeEmail(lead?.email) || normalizeEmail(contact),
    name: normalizeName(lead?.client_name),
  };
}

/**
 * Leads qui correspondent à ces coordonnées (téléphone, Instagram ou email
 * identiques). Le nom seul ne suffit pas à conclure à un doublon.
 */
export function findMatchingLeads(leads, { phone, instagram, email }) {
  const p = normalizePhone(phone);
  const i = normalizeInstagram(instagram);
  const e = normalizeEmail(email);
  if (!p && !i && !e) return [];
  return leads.filter((l) => {
    const id = leadIdentity(l);
    return (p && id.phone === p) || (i && id.instagram === i) || (e && id.email === e);
  });
}

/**
 * Retrouve la fiche du client dans le portefeuille visible par l'utilisateur,
 * sinon la crée à son nom. Renvoie { lead, created }.
 */
export async function findOrCreateClient(store, user, client, visibleLeads) {
  const phone = normalizePhone(client.phone);
  const instagram = normalizeInstagram(client.instagram);
  const email = normalizeEmail(client.email);

  const [existing] = findMatchingLeads(visibleLeads, { phone, instagram, email });
  if (existing) {
    // Complète les coordonnées manquantes sans écraser l'existant.
    const patch = {};
    if (phone && !existing.phone) patch.phone = "+" + phone;
    if (instagram && !existing.instagram) patch.instagram = instagram;
    if (email && !existing.email) patch.email = email;
    const lead = Object.keys(patch).length ? (await store.leads.update(existing.id, patch)) || existing : existing;
    return { lead, created: false };
  }

  const isSupabase = config.storage.driver === "supabase";
  const now = Date.now();
  const role = normalizeRole(user.role);
  const lead = {
    id: isSupabase ? uuidv4() : uid(),
    client_name: String(client.name || "").trim() || "Client",
    client_contact: phone ? "+" + phone : instagram ? "@" + instagram : email || "",
    canal: instagram && !phone ? "instagram" : "whatsapp",
    phone: phone ? "+" + phone : null,
    instagram: instagram || null,
    email: email || null,
    destination: String(client.besoin || "").trim(),
    status: "qualification",
    closer_name: role === ROLES.CLOSER || role === ROLES.CONCIERGE ? user.email : null,
    apporteur_name: role === ROLES.PROSPECTEUR ? user.email : null,
    notes: "",
    value: 0,
    margin: 0,
    passagers: 1,
    created_at: isSupabase ? new Date(now).toISOString() : now,
    updated_at: isSupabase ? new Date(now).toISOString() : now,
  };
  const inserted = await store.leads.insert(lead);
  return { lead: inserted || lead, created: true };
}

/**
 * Recherche universelle : une seule saisie (nom, numéro, @instagram ou email).
 * Renvoie [{ lead, reasons: ["téléphone" | "instagram" | "email" | "nom"] }],
 * les correspondances de coordonnées d'abord (ce sont les vrais doublons).
 */
export function searchLeads(leads, rawQuery, { limit = 25 } = {}) {
  const q = String(rawQuery || "").trim();
  if (q.length < 2) return [];

  const digits = q.replace(/\D/g, "");
  const looksPhone = digits.length >= 4 && /^[\d\s+().-]+$/.test(q);
  // Numéro tapé partiellement : on compare sur la fin (sans l'indicatif ni le 0).
  let phoneNeedle = "";
  if (looksPhone) {
    const full = normalizePhone(q);
    phoneNeedle = full
      ? full.replace(/^33/, "")
      : /^\s*(\+|00)/.test(q) ? digits.replace(/^(00)?33/, "") : digits.replace(/^0/, "");
  }
  const insta = q.startsWith("@") || /instagram\.com/i.test(q) ? normalizeInstagram(q) : "";
  const instaLoose = /^[a-z0-9._@]{3,}$/i.test(q) ? q.toLowerCase().replace(/^@/, "") : "";
  const email = q.includes("@") && !q.startsWith("@") ? q.toLowerCase() : "";
  const nameTokens = looksPhone ? [] : normalizeName(q).split(" ").filter(Boolean);

  const out = [];
  for (const lead of leads) {
    const id = leadIdentity(lead);
    const reasons = [];
    if (phoneNeedle.length >= 3 && id.phone && id.phone.includes(phoneNeedle)) reasons.push("téléphone");
    if (insta && id.instagram === insta) reasons.push("instagram");
    else if (instaLoose && id.instagram && id.instagram.includes(instaLoose)) reasons.push("instagram");
    if (email && id.email && id.email.includes(email)) reasons.push("email");
    if (nameTokens.length && nameTokens.every((t) => id.name.includes(t))) reasons.push("nom");
    if (reasons.length) out.push({ lead, reasons });
  }
  const rank = (r) => (r.reasons.some((x) => x !== "nom") ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b));
  return out.slice(0, limit);
}
