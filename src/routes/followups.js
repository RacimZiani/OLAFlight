// Relances et messages types.
//
//   GET    /api/followups                 → à relancer : en retard, aujourd'hui, à venir (7 j), froids
//   POST   /api/followups/:leadId/snooze  → reporter { days } ou fixer { date } (ou { date: null } = plus de relance)
//   GET    /api/followups/templates       → messages types (+ rendus pour ?lead_id=)
//   POST   /api/followups/templates       → admin : nouveau message
//   PATCH  /api/followups/templates/:id   → admin : modifier
//   DELETE /api/followups/templates/:id   → admin : supprimer

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireBackoffice, requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { uid, uuidv4 } from "../lib/ids.js";
import { canAccessLead, filterLeadsForUser, isAdmin } from "../lib/roles.js";
import { followupState, suggestedCategory, dayAt10, toMs, MAX_STEPS } from "../lib/followups.js";
import { CATEGORIES, renderTemplate, ensureDefaultTemplates } from "../lib/messageTemplates.js";
import { leadIdentity } from "../lib/clientMatch.js";
import { buildPublicDevisPdfUrl } from "../lib/publicUrl.js";

const router = Router();
router.use(requireBackoffice);

const isSupabase = () => config.storage.driver === "supabase";
const asDb = (ms) => (ms == null ? null : isSupabase() ? new Date(ms).toISOString() : ms);
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

async function conciergeName(store, user) {
  const u = user.email ? await store.users.findByField?.("email", user.email).catch(() => null) : null;
  return firstName(u?.display_name || user.name || String(user.email || "").split("@")[0]);
}

/** Variables de message pour un lead (prénom, besoin, lien du dernier devis). */
function varsFor(lead, lastDevis, concierge, req) {
  return {
    prenom: lead.client_name && lead.client_name !== "Client" ? firstName(lead.client_name) : "",
    besoin: lead.destination || "",
    concierge,
    devis: lastDevis ? buildPublicDevisPdfUrl(lastDevis.id, { req }) : "",
  };
}

// ─── Liste « à relancer » ───────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const store = await getStore();
    const [allLeads, allDevis, users] = await Promise.all([
      store.leads.list(), store.devis.list(), store.users.list().catch(() => []),
    ]);
    // Admin : toute l'équipe, ou une seule personne avec ?email= ; les autres : leur portefeuille.
    let leads = filterLeadsForUser(allLeads, req.user);
    if (isAdmin(req.user) && req.query.email) {
      leads = leads.filter((l) => l.closer_name === req.query.email || l.apporteur_name === req.query.email);
    }
    const names = new Map(users.map((u) => [u.email, u.display_name || u.email]));
    const lastDevisByLead = new Map();
    for (const d of allDevis) {
      if (!d.lead_id) continue;
      const cur = lastDevisByLead.get(String(d.lead_id));
      if (!cur || toMs(d.created_at) > toMs(cur.created_at)) lastDevisByLead.set(String(d.lead_id), d);
    }

    const now = Date.now();
    const horizon = dayAt10(7, now);
    const groups = { en_retard: [], aujourdhui: [], a_venir: [], froid: [] };
    for (const l of leads) {
      const state = followupState(l, now);
      if (!state) continue;
      if (state === "a_venir" && toMs(l.next_followup) > horizon) continue;
      const id = leadIdentity(l);
      const last = lastDevisByLead.get(String(l.id));
      groups[state].push({
        id: l.id,
        client_name: l.client_name,
        status: l.status,
        besoin: l.destination || "",
        next_followup: l.next_followup ?? null,
        followup_step: Number(l.followup_step) || 0,
        phone: id.phone ? "+" + id.phone : null,
        instagram: id.instagram || null,
        suggested_category: suggestedCategory(l),
        last_devis: last ? { id: last.id, prix_vente: Number(last.prix_vente) || 0 } : null,
        owner_name: names.get(l.closer_name || l.apporteur_name) || null,
      });
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => toMs(a.next_followup) - toMs(b.next_followup));
    res.json({ ...groups, max_steps: MAX_STEPS });
  } catch (e) { next(e); }
});

const snoozeSchema = z.object({
  days: z.coerce.number().int().min(0).max(365).optional(),
  date: z.string().nullable().optional(), // AAAA-MM-JJ
});

router.post("/:leadId/snooze", validate({ body: snoozeSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.leadId);
    if (!lead) throw new HttpError(404, "Client introuvable");
    if (!isAdmin(req.user) && !canAccessLead(req.user, lead)) throw new HttpError(403, "Client hors de votre portefeuille");
    let at;
    if (req.body.date === null) at = null;
    else if (req.body.date) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.body.date);
      if (!m) throw new HttpError(400, "Date invalide");
      const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(...todayParisYMD())) / 864e5);
      at = dayAt10(days);
    } else at = dayAt10(req.body.days ?? 1);
    const updated = await store.leads.update(lead.id, { next_followup: asDb(at) });
    res.json({ next_followup: updated?.next_followup ?? asDb(at) });
  } catch (e) { next(e); }
});

function todayParisYMD() {
  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }).split("-").map(Number);
  return [y, m - 1, d];
}

// ─── Messages types ─────────────────────────────────────────
router.get("/templates", async (req, res, next) => {
  try {
    const store = await getStore();
    const all = (await ensureDefaultTemplates(store)) || [];
    const items = all.filter((t) => isAdmin(req.user) || t.active !== false)
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));

    let rendered = null;
    if (req.query.lead_id) {
      const lead = await store.leads.findById(req.query.lead_id);
      if (!lead) throw new HttpError(404, "Client introuvable");
      if (!isAdmin(req.user) && !canAccessLead(req.user, lead)) throw new HttpError(403, "Client hors de votre portefeuille");
      const devis = (await store.devis.list()).filter((d) => String(d.lead_id) === String(lead.id))
        .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))[0];
      const vars = varsFor(lead, devis, await conciergeName(store, req.user), req);
      rendered = Object.fromEntries(items.map((t) => [t.id, renderTemplate(t.body, vars)]));
      res.json({ categories: CATEGORIES, items, rendered, suggested_category: suggestedCategory(lead) });
      return;
    }
    res.json({ categories: CATEGORIES, items, rendered });
  } catch (e) { next(e); }
});

const templateSchema = z.object({
  category: z.enum(CATEGORIES.map((c) => c.key)),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(2000),
  sort: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

router.post("/templates", requireAdmin, validate({ body: templateSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const now = Date.now();
    const item = await store.message_templates.insert({
      id: isSupabase() ? uuidv4() : uid(),
      ...req.body,
      sort: req.body.sort ?? 100,
      active: req.body.active ?? true,
      created_at: asDb(now),
      updated_at: asDb(now),
    });
    res.json({ item });
  } catch (e) { next(e); }
});

router.patch("/templates/:id", requireAdmin, validate({ body: templateSchema.partial() }), async (req, res, next) => {
  try {
    const store = await getStore();
    const item = await store.message_templates.update(req.params.id, req.body);
    if (!item) throw new HttpError(404, "Message introuvable");
    res.json({ item });
  } catch (e) { next(e); }
});

router.delete("/templates/:id", requireAdmin, async (req, res, next) => {
  try {
    const store = await getStore();
    await store.message_templates.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
