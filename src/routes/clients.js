// Fiche client et recherche anti-doublon.
//
//   GET    /api/clients/search?q=…          → recherche universelle (nom, numéro, @insta, email)
//   POST   /api/clients/check               → doublons pour des coordonnées { phone, instagram, email }
//   GET    /api/clients/:id                 → fiche complète (coordonnées, devis, achats, historique)
//   PATCH  /api/clients/:id                 → coordonnées, préférences, notes
//   POST   /api/clients/:id/events          → ajoute un échange (DM, appel, note…)
//   DELETE /api/clients/:id/events/:eventId → retire un échange (auteur ou admin)
//
// La recherche porte sur TOUS les clients pour détecter un doublon, mais un
// client suivi par quelqu'un d'autre n'est jamais ouvert : on indique
// seulement qui le suit, sans ses coordonnées.

import { Router } from "express";
import { logAction } from "../lib/activity.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireBackoffice } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { uid, uuidv4 } from "../lib/ids.js";
import { canAccessLead, isAdmin } from "../lib/roles.js";
import { sanitizeDevisForRole } from "../lib/commissions.js";
import { followupPatch } from "../lib/followups.js";
import {
  searchLeads, findMatchingLeads, normalizePhone, normalizeInstagram, normalizeEmail,
} from "../lib/clientMatch.js";

const router = Router();
router.use(requireBackoffice);

const isSupabase = () => config.storage.driver === "supabase";
const toMs = (v) => (typeof v === "number" ? v : Date.parse(v) || 0);
const EVENT_TYPES = ["note", "dm_out", "dm_in", "call", "meeting"];
const CHANNELS = ["instagram", "whatsapp", "phone", "email", "autre"];

async function usersByEmail(store) {
  const users = (await store.users?.list?.().catch(() => [])) || [];
  return new Map(users.map((u) => [u.email, u.display_name || u.name || u.email]));
}

function ownerOf(lead, names) {
  const email = lead.closer_name || lead.apporteur_name;
  return email ? { email, name: names.get(email) || email } : null;
}

/** Résumé d'un résultat : complet si accessible, réduit sinon. */
function resultFor(user, lead, reasons, names) {
  const accessible = isAdmin(user) || canAccessLead(user, lead);
  const owner = ownerOf(lead, names);
  if (!accessible) {
    return {
      accessible: false,
      client_name: lead.client_name,
      owner_name: owner?.name || "un autre membre de l'équipe",
      reasons,
    };
  }
  return {
    accessible: true,
    id: lead.id,
    client_name: lead.client_name,
    phone: lead.phone || (normalizePhone(lead.client_contact) ? lead.client_contact : null),
    instagram: lead.instagram || (String(lead.client_contact || "").startsWith("@") ? lead.client_contact : null),
    email: lead.email || null,
    status: lead.status,
    value: Number(lead.value) || 0,
    owner_name: owner?.name || null,
    mine: owner?.email === user.email,
    reasons,
  };
}

async function loadAccessibleLead(store, req) {
  const lead = await store.leads.findById(req.params.id);
  if (!lead) throw new HttpError(404, "Client introuvable");
  if (!isAdmin(req.user) && !canAccessLead(req.user, lead)) throw new HttpError(403, "Client hors de votre portefeuille");
  return lead;
}

// ─── Recherche ──────────────────────────────────────────────
router.get("/search", async (req, res, next) => {
  try {
    const store = await getStore();
    const [leads, names] = await Promise.all([store.leads.list(), usersByEmail(store)]);
    const hits = searchLeads(leads, req.query.q, { limit: 30 });
    res.json({ items: hits.map((h) => resultFor(req.user, h.lead, h.reasons, names)) });
  } catch (e) { next(e); }
});

const checkSchema = z.object({
  phone: z.string().max(60).optional(),
  instagram: z.string().max(160).optional(),
  email: z.string().max(160).optional(),
  contact: z.string().max(160).optional(), // champ libre « @handle ou +33… »
});

router.post("/check", validate({ body: checkSchema }), async (req, res, next) => {
  try {
    const { phone, instagram, email, contact } = req.body;
    const store = await getStore();
    const [leads, names] = await Promise.all([store.leads.list(), usersByEmail(store)]);
    const matches = findMatchingLeads(leads, {
      phone: phone || contact,
      instagram: instagram || (String(contact || "").trim().startsWith("@") ? contact : ""),
      email: email || contact,
    });
    res.json({ duplicates: matches.slice(0, 5).map((l) => resultFor(req.user, l, ["coordonnées"], names)) });
  } catch (e) { next(e); }
});

// ─── Fiche ──────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await loadAccessibleLead(store, req);
    const [allDevis, allEvents, names] = await Promise.all([
      store.devis.list(),
      store.client_events?.list?.().catch(() => []) ?? [],
      usersByEmail(store),
    ]);
    const devis = allDevis
      .filter((d) => String(d.lead_id || "") === String(lead.id))
      .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
      .map((d) => sanitizeDevisForRole(d, req.user.role));
    const events = allEvents
      .filter((ev) => String(ev.lead_id) === String(lead.id))
      .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
      .map((ev) => ({ ...ev, author_name: names.get(ev.author_email) || ev.author_email || null }));

    const paid = devis.filter((d) => d.paiement_recu);
    res.json({
      client: {
        ...lead,
        owner: ownerOf(lead, names),
      },
      devis,
      events,
      stats: {
        devis_count: devis.length,
        achats_count: paid.length,
        achats_total: paid.reduce((s, d) => s + (Number(d.prix_vente) || 0), 0),
        dernier_echange: events[0]?.created_at || null,
      },
    });
  } catch (e) { next(e); }
});

const patchSchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  phone: z.string().max(60).nullable().optional(),
  instagram: z.string().max(160).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  preferences: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  destination: z.string().max(300).nullable().optional(),
  client_type: z.string().max(40).nullable().optional(),
});

router.patch("/:id", validate({ body: patchSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await loadAccessibleLead(store, req);
    const b = req.body;
    const patch = { ...b };

    // Coordonnées normalisées : c'est ce qui rend la détection de doublon fiable.
    if (b.phone !== undefined) {
      const p = normalizePhone(b.phone);
      if (b.phone && !p) throw new HttpError(400, "Numéro de téléphone invalide");
      patch.phone = p ? "+" + p : null;
    }
    if (b.instagram !== undefined) {
      const i = normalizeInstagram(b.instagram);
      if (b.instagram && !i) throw new HttpError(400, "Identifiant Instagram invalide");
      patch.instagram = i || null;
    }
    if (b.email !== undefined) {
      const e = normalizeEmail(b.email);
      if (b.email && !e) throw new HttpError(400, "Email invalide");
      patch.email = e || null;
    }

    // Une coordonnée déjà portée par un AUTRE client = doublon : on refuse.
    if (patch.phone || patch.instagram || patch.email) {
      const others = (await store.leads.list()).filter((l) => String(l.id) !== String(lead.id));
      const dup = findMatchingLeads(others, {
        phone: patch.phone, instagram: patch.instagram, email: patch.email,
      })[0];
      if (dup) {
        const names = await usersByEmail(store);
        const r = resultFor(req.user, dup, ["coordonnées"], names);
        return res.status(409).json({
          error: `Ces coordonnées appartiennent déjà à ${r.client_name}${r.accessible ? "" : ` (suivi par ${r.owner_name})`}.`,
          duplicate: r,
        });
      }
    }

    // Garde l'ancien champ libre cohérent (utilisé par le CRM et les envois).
    const next = { ...lead, ...patch };
    patch.client_contact = next.phone || (next.instagram ? "@" + next.instagram : next.email || lead.client_contact || "");
    if (next.phone || next.instagram) patch.canal = next.instagram && !next.phone ? "instagram" : (lead.canal || "whatsapp");

    const updated = await store.leads.update(lead.id, patch);
    res.json({ client: updated || next });
  } catch (e) { next(e); }
});

// ─── Historique des échanges ────────────────────────────────
const eventSchema = z.object({
  type: z.enum(EVENT_TYPES).default("note"),
  channel: z.enum(CHANNELS).nullable().optional(),
  body: z.string().max(4000).default(""),
}).refine((e) => e.type !== "note" || e.body.trim(), { message: "La note est vide", path: ["body"] });

router.post("/:id/events", validate({ body: eventSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await loadAccessibleLead(store, req);
    if (!store.client_events) throw new HttpError(503, "Historique indisponible (migration 016 manquante)");
    const now = Date.now();
    const ev = {
      id: isSupabase() ? uuidv4() : uid(),
      lead_id: lead.id,
      author_email: req.user.email,
      type: req.body.type,
      channel: req.body.channel || null,
      body: req.body.body.trim(),
      created_at: isSupabase() ? new Date(now).toISOString() : now,
      updated_at: isSupabase() ? new Date(now).toISOString() : now,
    };
    const inserted = await store.client_events.insert(ev);
    const EV_LABEL = { note: "Note", dm_out: "DM envoyé", dm_in: "DM reçu", call: "Appel", meeting: "Rendez-vous" };
    logAction(req.user, "echange", `${EV_LABEL[ev.type] || ev.type} · ${lead.client_name}`, lead.id);
    // Un échange fait avancer le statut d'un prospect jamais contacté et
    // programme la relance suivante (J+2 / J+7 / J+15, voir lib/followups.js).
    const leadPatch = { ...followupPatch(lead, ev.type) };
    if (["dm_out", "call", "meeting"].includes(ev.type) && ["qualification", "new"].includes(lead.status)) {
      leadPatch.status = "contacted";
    }
    const updatedLead = Object.keys(leadPatch).length
      ? (await store.leads.update(lead.id, leadPatch).catch(() => null)) || { ...lead, ...leadPatch }
      : lead;
    res.json({
      event: { ...(inserted || ev), author_name: req.user.name || req.user.email },
      lead: { status: updatedLead.status, next_followup: updatedLead.next_followup ?? null, followup_step: updatedLead.followup_step ?? 0 },
    });
  } catch (e) { next(e); }
});

router.delete("/:id/events/:eventId", async (req, res, next) => {
  try {
    const store = await getStore();
    await loadAccessibleLead(store, req);
    const ev = await store.client_events.findById(req.params.eventId);
    if (!ev || String(ev.lead_id) !== String(req.params.id)) throw new HttpError(404, "Échange introuvable");
    if (!isAdmin(req.user) && ev.author_email !== req.user.email) throw new HttpError(403, "Seul l'auteur peut retirer cet échange");
    await store.client_events.remove(ev.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
