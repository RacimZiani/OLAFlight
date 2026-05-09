import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { leadCreateSchema, leadPatchSchema, idParamSchema, LEAD_STATUSES } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { uid } from "../lib/ids.js";
import { HttpError } from "../middleware/errorHandler.js";
import { notifyDalsimOfNewLead } from "../lib/notifications.js";
import { notify } from "../lib/notifBus.js";
import { pickCloserForLead } from "../lib/closerAssign.js";
import { summarizeLeadConversation } from "../lib/conversationSummary.js";
import { requireBackoffice } from "../middleware/auth.js";
import { createLogger } from "../logger.js";

const log = createLogger("leads");
const router = Router();

const DALSIM_TRIGGER_STATUSES = new Set(["devis_pending"]);

// Toutes les routes leads sont réservées au back-office (admin / dalsim / closeuse).
router.use(requireBackoffice);

function normalizeLeadInput(body) {
  const now = Date.now();
  return {
    id: body.id || uid(),
    client_name: String(body.client_name || body.name || "").trim() || "Client",
    client_contact: String(body.client_contact || body.contact || "").trim(),
    canal: body.canal || (String(body.source || "").toLowerCase().includes("instagram") ? "instagram" : "whatsapp"),
    destination: String(body.destination || body.dest || "").trim(),
    dates: String(body.dates || "").trim(),
    classe: String(body.classe || body.type || "").trim(),
    passagers: Number(body.passagers || body.pax || 1) || 1,
    status: LEAD_STATUSES.safeParse(body.status).success ? body.status : "qualification",
    apporteur_name: body.apporteur_name || body.apporteuse || null,
    closer_name: body.closer_name || body.sdr || null,
    calendly_link: body.calendly_link || null,
    next_followup: body.next_followup || body.followup || null,
    notes: body.notes || "",
    value: Number(body.value || 0) || 0,
    margin: Number(body.margin || 0) || 0,
    urgent: Boolean(body.urgent),
    created_at: now,
    updated_at: now,
  };
}

// Filtre selon le rôle : closeuse ne voit que ses leads (rule S02).
function filterForRole(items, user) {
  if (user.role === "closeuse") {
    return items.filter((l) => l.closer_name && l.closer_name === user.email);
  }
  return items;
}

router.get("/", async (req, res, next) => {
  try {
    const store = await getStore();
    let items = await store.leads.list();
    items = filterForRole(items, req.user);
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ items });
  } catch (e) { next(e); }
});

// Liste des closers actifs (pour le sélecteur admin/agent dans la modal lead).
router.get("/closers/list", async (_req, res, next) => {
  try {
    const store = await getStore();
    if (!store.users?.list) return res.json({ items: [] });
    const all = await store.users.list().catch(() => []);
    const items = all
      .filter((u) => {
        const r = String(u.role || "").toLowerCase();
        return (r === "closeuse" || r === "closer") && u.active !== false;
      })
      .map((u) => ({ email: u.email, name: u.name || u.email, role: u.role }));
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/", validate({ body: leadCreateSchema }), async (req, res, next) => {
  try {
    const lead = normalizeLeadInput(req.body);
    // Closeuse : on force closer_name à son propre email (pas de leads pour autrui).
    if (req.user.role === "closeuse") lead.closer_name = req.user.email;
    // Auto-dispatch si admin/dalsim ne précise pas de closer.
    if (!lead.closer_name && req.user.role !== "closeuse") {
      try { lead.closer_name = await pickCloserForLead(); } catch (e) {
        log.warn(`auto-dispatch failed: ${e?.message || e}`);
      }
    }
    const store = await getStore();
    const inserted = await store.leads.insert(lead);
    if (DALSIM_TRIGGER_STATUSES.has(lead.status)) {
      notifyDalsimOfNewLead(lead).catch((e) => log.warn(`notif dalsim: ${e.message}`));
    }
    if (inserted?.closer_name) {
      notify({
        recipients: [{ email: inserted.closer_name }],
        type: "lead_assigned",
        title: `Nouveau lead assigné : ${inserted.client_name || "Client"}`,
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
      // Closeuse : ne peut update que ses leads, et ne peut pas réassigner closer_name.
      if (req.user.role === "closeuse") {
        if (before.closer_name !== req.user.email) {
          throw new HttpError(403, "Lead non assigné à votre compte");
        }
        if (req.body.closer_name && req.body.closer_name !== req.user.email) {
          throw new HttpError(403, "Réassignation réservée aux admins");
        }
      }
      const updated = await store.leads.update(req.params.id, req.body);
      if (!updated) throw new HttpError(404, "Lead introuvable");

      const wasPending = before && DALSIM_TRIGGER_STATUSES.has(before.status);
      const nowPending = DALSIM_TRIGGER_STATUSES.has(updated.status);
      if (!wasPending && nowPending) {
        notifyDalsimOfNewLead(updated).catch((e) => log.warn(`notif dalsim: ${e.message}`));
      }

      // Notifications cloche : transitions importantes.
      if (before.status !== updated.status) {
        const lname = updated.client_name || "Lead";
        const dest = updated.destination || "—";
        const targets = [{ role: "admin" }];
        if (updated.closer_name) targets.push({ email: updated.closer_name });
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
            recipients: [{ role: "admin" }],
            type: "lead_lost",
            title: `Lead perdu · ${lname}`,
            body: dest,
            lead_id: updated.id,
          }).catch(() => {});
        }
      }
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

router.get("/:id/devis", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const lead = await store.leads.findById(req.params.id);
    if (!lead) throw new HttpError(404, "Lead introuvable");
    if (req.user.role === "closeuse" && lead.closer_name !== req.user.email) {
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
    if (req.user.role === "closeuse" && lead.closer_name !== req.user.email) {
      throw new HttpError(403, "Lead non assigné à votre compte");
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
    if (req.user.role === "closeuse" && lead.closer_name !== req.user.email) {
      throw new HttpError(403, "Lead non assigné à votre compte");
    }
    const out = await summarizeLeadConversation(req.params.id);
    res.json(out);
  } catch (e) { next(e); }
});

router.delete("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    if (!["admin", "dalsim"].includes(req.user.role)) {
      throw new HttpError(403, "Suppression réservée aux admins");
    }
    const store = await getStore();
    const removed = await store.leads.remove(req.params.id);
    res.json({ removed });
  } catch (e) { next(e); }
});

export default router;
