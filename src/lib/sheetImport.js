// Import du Google Sheet « CRM Prospection » (export .xlsx).
//
// Format attendu : un onglet par concierge (le nom de l'onglet = son prénom),
// colonnes : Nom · Canal · Coordonnées (@/tel) · Service(s) d'intérêt · Statut ·
// Température · Date contact · Date relance prévue · Notes. L'onglet « Récap »
// (formules) est ignoré. Les colonnes sont retrouvées par leur titre, pas par
// leur position.
//
// Étapes : parseWorkbook() lit le fichier → planImport() nettoie, dédoublonne et
// prépare les fiches (aucune écriture) → commitImport() écrit en base.

import ExcelJS from "exceljs";
import { config } from "../config.js";
import { uid, uuidv4 } from "./ids.js";
import { normalizePhone, normalizeInstagram, normalizeEmail, normalizeName, findMatchingLeads } from "./clientMatch.js";
import { dayAt10 } from "./followups.js";

const isSupabase = () => config.storage.driver === "supabase";
const asDb = (ms) => (ms == null ? null : isSupabase() ? new Date(ms).toISOString() : ms);
const DAY = 864e5;

// ─── Lecture ────────────────────────────────────────────────
const HEADERS = {
  nom: /^nom/i,
  canal: /^canal/i,
  coord: /coordonn/i,
  services: /service/i,
  statut: /^statut/i,
  temperature: /temp[ée]rature/i,
  date_contact: /date\s*contact/i,
  date_relance: /relance/i,
  notes: /^notes?/i,
};

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.result !== undefined) return cellValue(v.result);         // formule
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text !== undefined) return String(v.text);                 // lien
    return null;
  }
  return v;
}

export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const tabs = [];
  wb.eachSheet((ws) => {
    const header = ws.getRow(1).values.map((v) => String(cellValue(v) ?? "").trim());
    const col = {};
    for (const [key, re] of Object.entries(HEADERS)) {
      const idx = header.findIndex((h) => h && re.test(h));
      if (idx > 0) col[key] = idx;
    }
    // Onglet de prospection = au moins Nom + Coordonnées + Statut.
    if (!col.nom || !col.coord || !col.statut) return;
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const get = (k) => (col[k] ? cellValue(row.getCell(col[k]).value) : null);
      const raw = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, get(k)]));
      if (Object.values(raw).every((v) => v == null || String(v).trim() === "")) return;
      rows.push({ line: n, ...raw });
    });
    tabs.push({ name: ws.name.trim(), rows });
  });
  return tabs;
}

// ─── Nettoyage d'une ligne ──────────────────────────────────
const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Plateforme d'après la colonne Canal (fautes de frappe comprises). */
export function platformOf(canal) {
  const c = stripAccents(txt(canal).toLowerCase());
  if (!c) return "";
  if (/^ins|insta|^ig$/.test(c)) return "instagram";
  if (/tik/.test(c)) return "tiktok";
  if (/snap/.test(c)) return "snapchat";
  if (/whats|wa\b/.test(c)) return "whatsapp";
  if (/mail/.test(c)) return "email";
  if (/conna|perso|famil|ami|frere|soeur|cousin|contact|via|barber|reco/.test(c)) return "recommandation";
  return "autre";
}
const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", snapchat: "Snapchat", whatsapp: "WhatsApp", email: "Email", recommandation: "Recommandation", autre: "Autre" };

const STATUS = [
  [/^envoy/, "contacted", 1],
  [/relance/, "contacted", 1],
  [/^r[ée]pondu/, "interested", 0],
  [/qualifi/, "interested", 0],
  [/rdv|rendez/, "call_booked", 0],
  [/closing|n[ée]go/, "nego", 0],
  [/^deal|gagn|vendu/, "won", 0],
  [/perdu|refus/, "lost", 0],
];
function mapStatus(v) {
  const s = txt(v).toLowerCase();
  for (const [re, status, step] of STATUS) if (re.test(s)) return { status, step, label: txt(v) };
  return { status: "qualification", step: 0, label: s ? txt(v) : "" };
}

function mapServices(v) {
  const s = txt(v);
  if (!s) return "";
  const k = stripAccents(s.toLowerCase());
  if (/^(pre[sz]?[ea]?n?[st]ation|all$|global)/.test(k)) return "Présentation globale";
  return cap(s.replace(/\bbuisness\b/gi, "business").replace(/\bconciergeie\b/gi, "conciergerie"));
}

function toDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  const s = txt(v).replace(/\s/g, "");
  const m = /^(\d{1,2})\/(\d{1,2})\/?(\d{4})$/.exec(s) || /^(\d{1,2})\/(\d{2})(\d{4})$/.exec(s); // 14/10/2026 ou 14/102026
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], 10);
  return null;
}

const NOTE_WORDS = /\b(via|son|sa|fr[eè]re|s[oœ]eur|ami|amie|cousin|femme|mari|pote)\b/i;

/** Ligne brute → client nettoyé (sans propriétaire ni dédoublonnage). */
export function cleanRow(raw) {
  const warnings = [];
  const notes = [];
  let platform = platformOf(raw.canal);
  const coord = txt(raw.coord);
  let phone = "", instagram = "", email = "", otherHandle = "";

  if (coord) {
    const p = /^[\d\s+().-]+$/.test(coord) ? normalizePhone(coord) : "";
    const e = normalizeEmail(coord);
    if (p) phone = p;
    else if (e) email = e;
    else if (/^(insta(gram)?|snap(chat)?|tiktok|whatsapp|perso|dm)$/i.test(coord)) {
      if (!platform) platform = platformOf(coord);
    } else {
      // « @Line.biard (insta) », « Raphoupeps », « amal.touré »…
      const handle = (/@([\p{L}0-9._]{2,30})/u.exec(coord) || (/^[\p{L}0-9._]{2,30}$/u.test(coord) ? [null, coord] : null))?.[1];
      if (handle) {
        const clean = stripAccents(handle).toLowerCase();
        if (clean !== handle.toLowerCase()) warnings.push(`identifiant « ${handle} » corrigé en « ${clean} »`);
        if (!platform && /\(insta/i.test(coord)) platform = "instagram";
        if (platform === "tiktok" || platform === "snapchat") otherHandle = clean;
        else {
          instagram = normalizeInstagram(clean);
          if (!instagram) { warnings.push(`identifiant « ${handle} » illisible, gardé en note`); notes.push(`Coordonnées : ${coord}`); }
          else if (!platform || platform === "autre") platform = "instagram"; // canal vide : Instagram par défaut (cas largement majoritaire)
        }
      } else {
        notes.push(`Coordonnées : ${coord}`);
      }
    }
  }

  let name = txt(raw.nom);
  if (!name && coord && !instagram && !phone && !email && !otherHandle && !NOTE_WORDS.test(coord) && /^[\p{L} '-]{3,40}$/u.test(coord)) {
    name = cap(coord); // « Meret Manon » saisi dans les coordonnées
  }
  if (!name) name = instagram ? "@" + instagram : otherHandle ? "@" + otherHandle : phone ? "+" + phone : email || "";

  const st = mapStatus(raw.statut);
  const temperature = txt(raw.temperature).toLowerCase();
  const contactedAt = toDate(raw.date_contact);
  const relanceAt = toDate(raw.date_relance);
  if (raw.date_contact && !contactedAt) warnings.push(`date de contact illisible « ${txt(raw.date_contact)} »`);

  const sourceLabel = platform === "recommandation" ? `Recommandation (${txt(raw.canal)})` : PLATFORM_LABEL[platform] || txt(raw.canal);
  return {
    name,
    phone, instagram, email, otherHandle, platform,
    besoin: mapServices(raw.services),
    status: st.status,
    followup_step: st.step,
    statusLabel: st.label,
    temperature: ["chaud", "tiède", "tiede", "froid"].includes(temperature) ? temperature.replace("tiede", "tiède") : "",
    contactedAt,
    relanceAt,
    sheetNotes: txt(raw.notes),
    extraNotes: notes,
    sourceLabel,
    warnings,
  };
}

/** Clé d'identité pour le dédoublonnage. */
function identityKeys(c, owner) {
  const keys = [];
  if (c.phone) keys.push("tel:" + c.phone);
  if (c.instagram) keys.push("ig:" + c.instagram);
  if (c.email) keys.push("mail:" + c.email);
  if (c.otherHandle) keys.push(`${c.platform}:${c.otherHandle}`);
  if (!keys.length && c.name) keys.push(`nom:${owner || "?"}:${normalizeName(c.name)}`);
  return keys;
}

// ─── Plan d'import ──────────────────────────────────────────
const PRIORITY = (c) => {
  if (c.status === "won" || c.status === "lost") return 9;
  const hot = c.temperature === "chaud", warm = c.temperature === "tiède";
  if (["interested", "call_booked", "nego"].includes(c.status)) return hot ? 0 : warm ? 1 : 2;
  if (c.status === "qualification") return 3;
  return c.temperature === "froid" ? 5 : 4; // contacté sans réponse
};

/** Jours ouvrés à partir d'aujourd'hui (0 = aujourd'hui, ou lundi si week-end). */
function businessDayOffset(n) {
  let d = 0, count = -1;
  for (;;) {
    const wd = new Date(dayAt10(d)).toLocaleDateString("en-US", { timeZone: "Europe/Paris", weekday: "short" });
    if (wd !== "Sat" && wd !== "Sun") count++;
    if (count === n) return d;
    d++;
  }
}

/**
 * @param tabs        résultat de parseWorkbook
 * @param mapping     { [nomOnglet]: emailConcierge | "" }  ("" = onglet ignoré)
 * @param existing    leads déjà en base
 * @param perDay      relances étalées par jour et par concierge
 */
export function planImport(tabs, mapping, existing, { perDay = 10, userNames = new Map() } = {}) {
  const skipped = [];
  const candidates = [];
  for (const tab of tabs) {
    const owner = mapping[tab.name] || "";
    for (const raw of tab.rows) {
      if (!owner) { skipped.push({ tab: tab.name, line: raw.line, reason: "onglet non attribué" }); continue; }
      const c = cleanRow(raw);
      if (!c.name && !c.phone && !c.instagram && !c.email && !c.otherHandle) {
        skipped.push({ tab: tab.name, line: raw.line, reason: "ni nom ni coordonnées" });
        continue;
      }
      candidates.push({ ...c, owner, tab: tab.name, line: raw.line });
    }
  }

  // 1) Doublons dans le fichier : le premier contact (date la plus ancienne) garde le client.
  candidates.sort((a, b) => (a.contactedAt || Infinity) - (b.contactedAt || Infinity) || a.tab.localeCompare(b.tab) || a.line - b.line);
  const byKey = new Map();
  const kept = [];
  const merged = [];
  for (const c of candidates) {
    const keys = identityKeys(c, c.owner);
    const hit = keys.map((k) => byKey.get(k)).find(Boolean);
    if (hit) {
      const who = userNames.get(c.owner) || c.tab;
      const when = c.contactedAt ? ` le ${new Date(c.contactedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}` : "";
      hit.extraNotes.push(`Également contacté par ${who}${when} (onglet ${c.tab}, ligne ${c.line})${c.sheetNotes ? ` : ${c.sheetNotes}` : ""}`);
      merged.push({ tab: c.tab, line: c.line, name: c.name, kept: { tab: hit.tab, line: hit.line, owner: hit.owner } });
      continue;
    }
    keys.forEach((k) => byKey.set(k, c));
    kept.push(c);
  }

  // 2) Déjà dans le CRM : on ne recrée pas (import relançable sans risque).
  const existingNames = new Set(existing.map((l) => `nom:${l.closer_name || l.apporteur_name || "?"}:${normalizeName(l.client_name)}`));
  const toCreate = [];
  const alreadyThere = [];
  for (const c of kept) {
    const match = findMatchingLeads(existing, { phone: c.phone, instagram: c.instagram, email: c.email })[0];
    const otherMatch = c.otherHandle && existing.find((l) => String(l.client_contact || "").toLowerCase() === `${PLATFORM_LABEL[c.platform]} : ${c.otherHandle}`.toLowerCase());
    const nameMatch = !c.phone && !c.instagram && !c.email && !c.otherHandle && existingNames.has(`nom:${c.owner}:${normalizeName(c.name)}`);
    if (match || otherMatch || nameMatch) {
      const m = match || otherMatch;
      alreadyThere.push({ tab: c.tab, line: c.line, name: c.name, existing: m ? m.client_name : c.name });
      continue;
    }
    toCreate.push(c);
  }

  // 3) Relances : date prévue si elle est à venir, sinon étalées par concierge.
  const today = dayAt10(0);
  const byOwner = new Map();
  for (const c of toCreate) {
    if (["won", "lost"].includes(c.status)) { c.nextFollowup = null; continue; }
    if (c.relanceAt && c.relanceAt >= today - DAY) { c.nextFollowup = Math.max(c.relanceAt, today); continue; }
    (byOwner.get(c.owner) || byOwner.set(c.owner, []).get(c.owner)).push(c);
  }
  for (const list of byOwner.values()) {
    list.sort((a, b) => PRIORITY(a) - PRIORITY(b) || (a.contactedAt || 0) - (b.contactedAt || 0));
    list.forEach((c, i) => { c.nextFollowup = dayAt10(businessDayOffset(Math.floor(i / Math.max(1, perDay)))); });
  }

  const perTab = {};
  for (const tab of tabs) perTab[tab.name] = { lignes: tab.rows.length, a_creer: 0, deja_la: 0, fusionnes: 0, ignores: 0, owner: mapping[tab.name] || "" };
  toCreate.forEach((c) => perTab[c.tab].a_creer++);
  alreadyThere.forEach((c) => perTab[c.tab].deja_la++);
  merged.forEach((c) => perTab[c.tab].fusionnes++);
  skipped.forEach((c) => perTab[c.tab] && perTab[c.tab].ignores++);
  const lastDay = Math.max(0, ...toCreate.map((c) => c.nextFollowup || 0));

  return {
    toCreate, alreadyThere, merged, skipped, perTab,
    warnings: toCreate.flatMap((c) => c.warnings.map((w) => ({ tab: c.tab, line: c.line, name: c.name, warning: w }))),
    relances_jusquau: lastDay || null,
  };
}

// ─── Écriture ───────────────────────────────────────────────
function leadFrom(c, now) {
  const lines = [
    `Import Google Sheet · onglet ${c.tab}, ligne ${c.line}`,
    c.sourceLabel && `Source : ${c.sourceLabel}`,
    c.temperature && `Température : ${cap(c.temperature)}`,
    c.statusLabel && `Statut dans le Sheet : ${c.statusLabel}`,
    c.sheetNotes && `Notes : ${c.sheetNotes}`,
    ...c.extraNotes,
  ].filter(Boolean);
  const created = c.contactedAt || now;
  const contact = c.phone ? "+" + c.phone : c.instagram ? "@" + c.instagram : c.email
    || (c.otherHandle ? `${PLATFORM_LABEL[c.platform]} : ${c.otherHandle}` : "");
  return {
    id: isSupabase() ? uuidv4() : uid(),
    client_name: c.name.slice(0, 120),
    client_contact: contact,
    canal: c.phone && !c.instagram ? "whatsapp" : "instagram",
    phone: c.phone ? "+" + c.phone : null,
    instagram: c.instagram || null,
    email: c.email || null,
    destination: c.besoin,
    status: c.status,
    closer_name: c.owner,
    apporteur_name: null,
    notes: lines.join("\n"),
    value: 0,
    margin: 0,
    passagers: 1,
    urgent: c.temperature === "chaud",
    next_followup: asDb(c.nextFollowup),
    followup_step: c.followup_step,
    created_at: asDb(created),
    updated_at: asDb(now),
  };
}

export async function commitImport(store, plan, { onProgress } = {}) {
  const now = Date.now();
  let created = 0, events = 0;
  const errors = [];
  for (const [i, c] of plan.toCreate.entries()) {
    try {
      const lead = await store.leads.insert(leadFrom(c, now));
      created++;
      // Historique : le premier DM (et la réponse) à leur date d'origine.
      if (store.client_events && c.contactedAt && c.status !== "qualification") {
        const ev = (type, at, body) => store.client_events.insert({
          id: isSupabase() ? uuidv4() : uid(), lead_id: lead.id, author_email: c.owner, type,
          channel: c.platform === "instagram" ? "instagram" : c.platform === "whatsapp" ? "whatsapp" : "autre",
          body, created_at: asDb(at), updated_at: asDb(now),
        }).then(() => events++);
        await ev("dm_out", c.contactedAt, "Premier message (repris du Google Sheet)");
        if (!["contacted", "qualification"].includes(c.status)) await ev("dm_in", c.contactedAt + 60 * 1000, "Le client a répondu (repris du Google Sheet)");
      }
    } catch (e) {
      errors.push({ tab: c.tab, line: c.line, name: c.name, error: e?.message || String(e) });
    }
    if (onProgress && i % 25 === 0) onProgress(i);
  }
  return { created, events, errors };
}
