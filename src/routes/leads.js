import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { leadCreateSchema, leadPatchSchema, idParamSchema, LEAD_STATUSES } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { uid, uuidv4 } from "../lib/ids.js";
import { HttpError } from "../middleware/errorHandler.js";
import { notifyDalsimOfNewLead } from "../lib/notifications.js";
import { notify } from "../lib/notifBus.js";
import { config } from "../config.js";
// pickCloserForLead / pickProspecteurForLead retirés : assignation manuelle par l'admin uniquement.
import {
  filterLeadsForUser,
  canAccessLead,
  normalizeRole,
  ROLES,
  prospecteurWantsNotif,
} from "../lib/roles.js";
import { summarizeLeadConversation } from "../lib/conversationSummary.js";
import { requireBackoffice } from "../middleware/auth.js";
import { createLogger } from "../logger.js";
import { coerceLeadRowForDb, parsePassagers, leadBoolForDb } from "../lib/dbCoerce.js";

const log = createLogger("leads");
const router = Router();

const DALSIM_TRIGGER_STATUSES = new Set(["devis_pending"]);

// Toutes les routes leads sont réservées au back-office (admin / dalsim / closeuse).
router.use(requireBackoffice);

function toIsoIfSupabase(v) {
  if (!v) return null;
  if (config.storage.driver !== "supabase") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  return v;
}

function normalizeLeadInput(body) {
  const now = Date.now();
  const isSupabase = config.storage.driver === "supabase";
  const tsNow = isSupabase ? new Date(now).toISOString() : now;
  return {
    id: body.id || (isSupabase ? uuidv4() : uid()),
    client_name: String(body.client_name || body.name || "").trim() || "Client",
    client_contact: String(body.client_contact || body.contact || "").trim(),
    canal: body.canal || (String(body.source || "").toLowerCase().includes("instagram") ? "instagram" : "whatsapp"),
    destination: String(body.destination || body.dest || "").trim(),
    dates: String(body.dates || "").trim(),
    classe: String(body.classe || body.type || "").trim(),
    passagers: parsePassagers(body.passagers ?? body.pax, 1),
    status: LEAD_STATUSES.safeParse(body.status).success ? body.status : "qualification",
    apporteur_name: body.apporteur_name || body.apporteuse || null,
    closer_name: body.closer_name || body.sdr || null,
    calendly_link: body.calendly_link || null,
    next_followup: toIsoIfSupabase(body.next_followup || body.followup || null),
    notes: body.notes || "",
    value: Number(body.value || 0) || 0,
    margin: Number(body.margin || 0) || 0,
    urgent: leadBoolForDb(body.urgent),
    created_at: tsNow,
    updated_at: tsNow,
  };
}

function notifyStatusChange({ before, updated }) {
  if (before.status === updated.status) return;
  const lname = updated.client_name || "Lead";
  const dest = updated.destination || "—";
  const targets = [{ role: "admin" }];
  if (updated.closer_name) targets.push({ email: updated.closer_name });
  if (updated.apporteur_name && prospecteurWantsNotif(updated.status)) {
    targets.push({ email: updated.apporteur_name });
  }
  if (updated.status === "won") {
    notify({
      recipients: targets,
      type: "lead_won",
      title: `🏆 Deal gagné · ${lname}`,
      body: `${dest} · ${updated.value ? `${updated.value} €` : ""}`.trim(),
      lead_id: updated.id,
    }).catch(() => {});
  } else if (updated.status === "nego") {
    notify({
      recipients: targets,
      type: "lead_nego",
      title: `Négociation en cours · ${lname}`,
      body: `${dest} — le client veut discuter.`,
      lead_id: updated.id,
    }).catch(() => {});
  } else if (updated.status === "lost") {
    notify({
      recipients: [{ role: "admin" }, ...(updated.closer_name ? [{ email: updated.closer_name }] : [])],
      type: "lead_lost",
      title: `Lead perdu · ${lname}`,
      body: dest,
      lead_id: updated.id,
    }).catch(() => {});
  }
}

router.get("/", async (req, res, next) => {
  try {
    const store = await getStore();
    let items = await store.leads.list();
    items = filterLeadsForUser(items, req.user);
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ items });
  } catch (e) { next(e); }
});

// Liste des closers actifs (pour le sélecteur admin/agent dans la modal lead).
router.get("/prospecteurs/list", async (_req, res, next) => {
  try {
    const store = await getStore();
    if (!store.users?.list) return res.json({ items: [] });
    const all = await store.users.list().catch(() => []);
    const items = all
      .filter((u) => normalizeRole(u.role) === ROLES.PROSPECTEUR && u.active !== false)
      .map((u) => ({ email: u.email, name: u.display_name || u.name || u.email, role: u.role }));
    res.json({ items });
  } catch (e) { next(e); }
});

router.get("/closers/list", async (_req, res, next) => {
  try {
    const store = await getStore();
    if (!store.users?.list) return res.json({ items: [] });
    const all = await store.users.list().catch(() => []);
    const items = all
      .filter((u) => {
        return normalizeRole(u.role) === ROLES.CLOSER && u.active !== false;
      })
      .map((u) => ({ email: u.email, name: u.name || u.email, role: u.role }));
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/", validate({ body: leadCreateSchema }), async (req, res, next) => {
  try {
    const lead = normalizeLeadInput(req.body);
    const role = normalizeRole(req.user.role);
    if (role === ROLES.CLOSER) lead.closer_name = req.user.email;
    if (role === ROLES.PROSPECTEUR) lead.apporteur_name = req.user.email;

    const store = await getStore();
    const inserted = await store.leads.insert(lead);
    if (DALSIM_TRIGGER_STATUSES.has(lead.status)) {
      notifyDalsimOfNewLead(lead).catch((e) => log.warn(`notif dalsim: ${e.message}`));
    }
    if (inserted?.closer_name) {
      notify({
        recipients: [{ email: inserted.closer_name }],
        type: "lead_assigned",
        title: `Nouveau lead assigné (closer) : ${inserted.client_name || "Client"}`,
        body: `${inserted.destination || "—"} · ${inserted.dates || "dates à confirmer"}`,
        lead_id: inserted.id,
      }).catch(() => {});
    }
    if (inserted?.apporteur_name) {
      notify({
        recipients: [{ email: inserted.apporteur_name }],
        type: "chatbot_lead",
        title: `Nouveau client chatbot · ${inserted.client_name || "Client"}`,
        body: `${inserted.destination || "—"} · ${inserted.dates || "dates à confirmer"}`,
        lead_id: inserted.id,
      }).catch(() => {});
    }
    res.json({ item: inserted || lead });
  } catch (e) { next(e); }
});

router.patch(
  "/:id",
  validate({ params: idParamSchema, body: leadPatchSchema }),
  async (req, res, next) => {
    try {
      if (req.body.status && !LEAD_STATUSES.safeParse(req.body.status).success) {
        throw new HttpError(400, "Statut invalide");
      }
      const store = await getStore();
      const before = await store.leads.findById(req.params.id);
      if (!before) throw new HttpError(404, "Lead introuvable");
      const role = normalizeRole(req.user.role);
      if (role === ROLES.CLOSER && !canAccessLead(req.user, before)) {
        throw new HttpError(403, "Lead non assigné à votre compte");
      }
      if (role === ROLES.PROSPECTEUR && !canAccessLead(req.user, before)) {
        throw new HttpError(403, "Lead hors périmètre prospecteur");
      }
      if (role === ROLES.CLOSER && req.body.closer_name && req.body.closer_name !== req.user.email) {
        throw new HttpError(403, "Réassignation réservée aux admins");
      }
      if (role === ROLES.PROSPECTEUR && req.body.apporteur_name && req.body.apporteur_name !== req.user.email) {
        throw new HttpError(403, "Réassignation réservée aux admins");
      }
      const updated = await store.leads.update(req.params.id, req.body);
      if (!updated) throw new HttpError(404, "Lead introuvable");

      const wasPending = before && DALSIM_TRIGGER_STATUSES.has(before.status);
      const nowPending = DALSIM_TRIGGER_STATUSES.has(updated.status);
      if (!wasPending && nowPending) {
        notifyDalsimOfNewLead(updated).catch((e) => log.warn(`notif dalsim: ${e.message}`));
      }

      notifyStatusChange({ before, updated });
      // Réassignation manuelle d'un closer → notif au nouveau closer.
      if (
        req.body.closer_name &&
        before.closer_name !== updated.closer_name &&
        updated.closer_name
      ) {
        notify({
          recipients: [{ email: updated.closer_name }],
          type: "lead_assigned",
          title: `Lead réassigné · ${updated.client_name || "Client"}`,
          body: `${updated.destination || "—"} · ${updated.dates || "dates à confirmer"}`,
          lead_id: updated.id,
        }).catch(() => {});
      }

      res.json({ item: updated });
    } catch (e) { next(e); }
  }
);

router.get("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.id);
    if (!lead) throw new HttpError(404, "Lead introuvable");
    if (!canAccessLead(req.user, lead)) {
      throw new HttpError(403, "Lead hors périmètre");
    }
    res.json({ item: lead });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/devis", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.id);
    if (!lead) throw new HttpError(404, "Lead introuvable");
    if (!canAccessLead(req.user, lead)) {
      throw new HttpError(403, "Lead hors périmètre");
    }
    const all = await store.devis.list();
    const items = all
      .filter((d) => String(d.lead_id || "") === String(req.params.id))
      .sort((a, b) => {
        const ta = typeof a.created_at === "number" ? a.created_at : Date.parse(a.created_at) || 0;
        const tb = typeof b.created_at === "number" ? b.created_at : Date.parse(b.created_at) || 0;
        return tb - ta;
      });
    res.json({ items });
  } catch (e) { next(e); }
});

router.get("/:id/conversation", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.id);
    if (!lead) throw new HttpError(404, "Lead introuvable");
    if (!canAccessLead(req.user, lead)) {
      throw new HttpError(403, "Lead hors périmètre");
    }
    if (!store.conversations_ola?.list) return res.json({ messages: [], conversation: null });
    const all = await store.conversations_ola.list().catch(() => []);
    const conv = all.find((c) => String(c.lead_id || "") === String(req.params.id)) || null;
    res.json({
      conversation: conv ? { id: conv.id, key: conv.key, channel: conv.channel, contact: conv.contact, lang: conv.lang } : null,
      messages: conv?.messages || [],
      total: (conv?.messages || []).length,
    });
  } catch (e) { next(e); }
});

router.get("/:id/summary", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.id);
    if (!lead) throw new HttpError(404, "Lead introuvable");
    if (!canAccessLead(req.user, lead)) {
      throw new HttpError(403, "Lead hors périmètre");
    }
    const out = await summarizeLeadConversation(req.params.id);
    res.json(out);
  } catch (e) { next(e); }
});

router.delete("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    if (normalizeRole(req.user.role) !== ROLES.ADMIN) {
      throw new HttpError(403, "Suppression réservée aux admins");
    }
    const store = await getStore();
    const removed = await store.leads.remove(req.params.id);
    res.json({ removed });
  } catch (e) { next(e); }
});

export default router;
