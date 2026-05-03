import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { leadCreateSchema, leadPatchSchema, idParamSchema, LEAD_STATUSES } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { uid } from "../lib/ids.js";
import { HttpError } from "../middleware/errorHandler.js";
import { notifyDalsimOfNewLead } from "../lib/notifications.js";
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

router.post("/", validate({ body: leadCreateSchema }), async (req, res, next) => {
  try {
    const lead = normalizeLeadInput(req.body);
    // Closeuse : on force closer_name à son propre email (pas de leads pour autrui).
    if (req.user.role === "closeuse") lead.closer_name = req.user.email;
    const store = await getStore();
    await store.leads.insert(lead);
    if (DALSIM_TRIGGER_STATUSES.has(lead.status)) {
      notifyDalsimOfNewLead(lead).catch((e) => log.warn(`notif dalsim: ${e.message}`));
    }
    res.json({ item: lead });
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
      // Closeuse : ne peut update que ses leads.
      if (req.user.role === "closeuse" && before.closer_name !== req.user.email) {
        throw new HttpError(403, "Lead non assigné à votre compte");
      }
      const updated = await store.leads.update(req.params.id, req.body);
      if (!updated) throw new HttpError(404, "Lead introuvable");

      const wasPending = before && DALSIM_TRIGGER_STATUSES.has(before.status);
      const nowPending = DALSIM_TRIGGER_STATUSES.has(updated.status);
      if (!wasPending && nowPending) {
        notifyDalsimOfNewLead(updated).catch((e) => log.warn(`notif dalsim: ${e.message}`));
      }
      res.json({ item: updated });
    } catch (e) { next(e); }
  }
);

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
