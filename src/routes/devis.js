import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { devisCreateSchema, devisQuerySchema, idParamSchema } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { uid } from "../lib/ids.js";
import { computeCommissions, sanitizeDevisForRole } from "../lib/commissions.js";
import { generateDevisPdf } from "../lib/pdf.js";
import { sendMessage } from "../lib/messaging/index.js";
import { config } from "../config.js";
import { buildPublicDevisPdfUrl, publicDevisPdfPath } from "../lib/publicUrl.js";
import { HttpError } from "../middleware/errorHandler.js";
import { requireBackoffice, requireRole, requireDevis, requireAdmin } from "../middleware/auth.js";
import { normalizeAdminOptions } from "../lib/draftDevis.js";
import { sendDevisEmailToClient, isEmailConfigured } from "../lib/email.js";
import { resolvePublicBaseUrl } from "../lib/publicUrl.js";
import { canAccessLead, normalizeRole, ROLES, filterLeadsForUser } from "../lib/roles.js";

const router = Router();

// Toutes les routes devis sont réservées au back-office. La sanitization par
// rôle (rule S01) reste appliquée en sortie via sanitizeDevisForRole().
router.use(requireBackoffice);

const DAY = 24 * 60 * 60 * 1000;

function parseServices(s) {
  if (Array.isArray(s)) return s;
  return String(s || "")
    .split(/[,;·]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

router.get("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const devis = await store.devis.findById(req.params.id);
    if (!devis) throw new HttpError(404, "Devis introuvable");
    if (normalizeRole(req.user.role) !== ROLES.ADMIN) {
      const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;
      if (!lead || !canAccessLead(req.user, lead)) {
        throw new HttpError(403, "Devis hors périmètre");
      }
    }
    res.json({ item: sanitizeDevisForRole(devis, req.user.role) });
  } catch (e) { next(e); }
});

router.get("/", validate({ query: devisQuerySchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    let items = await store.devis.list();
    // Le rôle vient de la session JWT (req.user.role) — la query.role legacy est
    // ignorée pour ne pas pouvoir réclamer un rôle plus élevé via l'URL.
    const role = normalizeRole(req.user.role);
    if (role !== ROLES.ADMIN) {
      const leads = filterLeadsForUser(await store.leads.list(), req.user);
      const myLeadIds = new Set(leads.map((l) => String(l.id)));
      items = items.filter((d) => d.lead_id && myLeadIds.has(String(d.lead_id)));
    }
    res.json({ items: items.map((d) => sanitizeDevisForRole(d, role)) });
  } catch (e) { next(e); }
});

router.post("/", requireDevis, validate({ body: devisCreateSchema }), async (req, res, next) => {
  try {
    const body = req.body;
    const { marge, closer_commission, apporteur_commission } = computeCommissions({
      prix_vente: body.prix_vente,
      prix_revient: body.prix_revient,
      apporteur_name: body.apporteur_name,
    });

    const now = Date.now();
    const isSupabase = config.storage.driver === "supabase";
    const tsNow = isSupabase ? new Date(now).toISOString() : now;
    const tsValide = isSupabase ? new Date(now + DAY).toISOString() : now + DAY;
    const devis = {
      id: body.id || `OLA-${uid().slice(0, 6)}`,
      lead_id: body.lead_id,
      compagnie: body.compagnie || "",
      horaire_dep: body.horaire_dep || "",
      horaire_arr: body.horaire_arr || "",
      prix_revient: body.prix_revient || 0,
      prix_vente: body.prix_vente || 0,
      prix_marche: body.prix_marche || 0,
      // marge, closer_commission, apporteur_commission sont des colonnes GENERATED
      // calculées automatiquement par Supabase — ne pas les insérer.
      apporteur_name: body.apporteur_name || null,
      services_inclus: parseServices(body.services_inclus),
      pdf_url: body.pdf_url || null,
      valide_jusqu_au: tsValide,
      paiement_recu: false,
      created_at: tsNow,
      updated_at: tsNow,
    };

    const store = await getStore();
    await store.devis.insert(devis);

    // Met à jour le lead lié → devis_sent + propage value/margin (lecture CRM).
    if (devis.lead_id) {
      await store.leads.update(devis.lead_id, {
        status: "devis_sent",
        value: devis.prix_vente,
        margin: marge,
      });
    }

    res.json({ item: devis });
  } catch (e) { next(e); }
});

// ─── Édition d'un devis (admin / dalsim / closeuse de ce lead) ────────
const optionEditSchema = z.object({
  label: z.string().optional(),
  compagnie: z.string().optional(),
  horaire_dep: z.string().optional(),
  horaire_arr: z.string().optional(),
  duration: z.string().optional(),
  stops: z.coerce.number().int().min(0).max(5).optional(),
  prix_revient: z.coerce.number().min(0).optional(),
  prix_vente: z.coerce.number().min(0).optional(),
  prix_marche: z.coerce.number().min(0).optional(),
  services_inclus: z.array(z.string()).optional(),
});
const hotelEditSchema = z.object({
  name: z.string(),
  stars: z.coerce.number().int().min(1).max(5).optional(),
  area: z.string().optional(),
  nights: z.coerce.number().int().min(1).optional(),
  price_per_night: z.coerce.number().min(0).optional(),
  total_price: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});
const driverEditSchema = z.object({
  pickup: z.string().optional(),
  dropoff: z.string().optional(),
  vehicle: z.string().optional(),
  hours: z.coerce.number().min(0).optional(),
  total_price: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
}).nullable();

const adminOptionSchema = z.object({
  label: z.string().optional(),
  compagnie: z.string().min(1),
  prix_vente_business: z.coerce.number().min(1),
  prix_vente_first: z.coerce.number().min(0).optional().default(0),
  horaire_dep: z.string().optional(),
  horaire_arr: z.string().optional(),
  prix_revient: z.coerce.number().min(0).optional(),
  prix_marche: z.coerce.number().min(0).optional(),
});

const adminPricingSchema = z.object({
  options: z.array(adminOptionSchema).length(2),
  hotels: z.array(hotelEditSchema).optional(),
  driver: driverEditSchema.optional(),
  regenerate_pdf: z.coerce.boolean().optional().default(true),
});

const devisPatchSchema = z.object({
  compagnie: z.string().optional(),
  horaire_dep: z.string().optional(),
  horaire_arr: z.string().optional(),
  prix_revient: z.coerce.number().min(0).optional(),
  prix_vente: z.coerce.number().min(0).optional(),
  prix_marche: z.coerce.number().min(0).optional(),
  services_inclus: z.union([z.array(z.string()), z.string()]).optional(),
  options: z.array(optionEditSchema).max(3).optional(),
  hotels: z.array(hotelEditSchema).optional(),
  driver: driverEditSchema.optional(),
  paiement_recu: z.coerce.boolean().optional(),
  // Pour relancer la validité 24h après édition.
  refresh_validity: z.coerce.boolean().optional(),
  // Régénérer le PDF après update (true par défaut).
  regenerate_pdf: z.coerce.boolean().optional().default(true),
});

router.patch(
  "/:id",
  validate({ params: idParamSchema, body: devisPatchSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const before = await store.devis.findById(req.params.id);
      if (!before) throw new HttpError(404, "Devis introuvable");

      // Closeuse : ne peut éditer que les devis liés à ses leads.
      if (normalizeRole(req.user.role) !== ROLES.ADMIN) {
        const lead = before.lead_id ? await store.leads.findById(before.lead_id) : null;
        if (!lead || !canAccessLead(req.user, lead)) {
          throw new HttpError(403, "Devis hors périmètre");
        }
      }

      const body = req.body;
      // Recalcul commissions/marge si les prix changent (SQLite uniquement —
      // Supabase a des generated columns).
      const isSupabase = config.storage.driver === "supabase";
      const newPV = body.prix_vente ?? before.prix_vente;
      const newPR = body.prix_revient ?? before.prix_revient;
      const recompute = !isSupabase && (body.prix_vente != null || body.prix_revient != null);
      const recomputed = recompute
        ? computeCommissions({
            prix_vente: newPV,
            prix_revient: newPR,
            apporteur_name: before.apporteur_name || null,
          })
        : null;

      const services_inclus = body.services_inclus !== undefined
        ? parseServices(body.services_inclus)
        : undefined;

      const patch = {
        ...(body.compagnie != null   ? { compagnie: body.compagnie } : {}),
        ...(body.horaire_dep != null ? { horaire_dep: body.horaire_dep } : {}),
        ...(body.horaire_arr != null ? { horaire_arr: body.horaire_arr } : {}),
        ...(body.prix_revient != null ? { prix_revient: body.prix_revient } : {}),
        ...(body.prix_vente != null   ? { prix_vente: body.prix_vente } : {}),
        ...(body.prix_marche != null  ? { prix_marche: body.prix_marche } : {}),
        ...(services_inclus !== undefined ? { services_inclus } : {}),
        ...(body.options !== undefined ? { options: body.options } : {}),
        ...(body.hotels !== undefined ? { hotels: body.hotels } : {}),
        ...(body.driver !== undefined ? { driver: body.driver } : {}),
        ...(body.paiement_recu != null ? { paiement_recu: body.paiement_recu } : {}),
        ...(body.refresh_validity ? {
          valide_jusqu_au: isSupabase
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : Date.now() + 24 * 60 * 60 * 1000,
        } : {}),
      };

      // Update tolérant aux migrations manquantes (options/hotels/driver).
      async function updateTolerant(p) {
        try {
          return await store.devis.update(req.params.id, p);
        } catch (e) {
          const msg = e?.message || String(e);
          const matches = ["options", "hotels", "driver"].filter((c) => {
            const re = new RegExp(`'${c}'|"${c}"|\\b${c}\\b`, "i");
            return re.test(msg) && /column|cache|schema|does not exist/i.test(msg);
          });
          if (matches.length === 0) throw e;
          const reduced = { ...p };
          for (const c of matches) delete reduced[c];
          return updateTolerant(reduced);
        }
      }

      const updated = await updateTolerant(patch);

      // Régénération PDF (par défaut). Si la migration manque, l'objet `updated`
      // ne contient pas les nouveaux options/hotels/driver — on les complète en
      // mémoire pour le rendu PDF.
      let pdf_url = updated?.pdf_url || null;
      if (body.regenerate_pdf !== false) {
        const merged = {
          ...(updated || before),
          ...(patch.options !== undefined ? { options: patch.options } : {}),
          ...(patch.hotels !== undefined ? { hotels: patch.hotels } : {}),
          ...(patch.driver !== undefined ? { driver: patch.driver } : {}),
        };
        const lead = merged.lead_id ? await store.leads.findById(merged.lead_id) : null;
        await generateDevisPdf({ devis: merged, lead });
        pdf_url = publicDevisPdfPath(merged.id);
        await store.devis.update(req.params.id, { pdf_url });
        if (updated) updated.pdf_url = pdf_url;
      }

      // Met à jour la valeur du lead si prix_vente a changé.
      if (body.prix_vente != null && before.lead_id) {
        try {
          await store.leads.update(before.lead_id, {
            value: body.prix_vente,
            margin: recomputed?.marge ?? (newPV - newPR),
          });
        } catch { /* schema-tolerant */ }
      }

      res.json({ item: updated, pdf_url });
    } catch (e) { next(e); }
  }
);

// ─── Saisie tarifs admin (2 compagnies) — web Agent Ola ───────────────
router.post(
  "/:id/admin-pricing",
  requireAdmin,
  validate({ params: idParamSchema, body: adminPricingSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const before = await store.devis.findById(req.params.id);
      if (!before) throw new HttpError(404, "Devis introuvable");
      const lead = before.lead_id ? await store.leads.findById(before.lead_id) : null;
      if (!lead) throw new HttpError(400, "Lead introuvable pour ce devis");

      const body = req.body;
      const options = normalizeAdminOptions(body.options, lead);

      if (lead.needs_hotel && body.hotels?.length) {
        /* ok */
      } else if (lead.needs_hotel && !body.hotels?.length) {
        throw new HttpError(400, "Hôtel demandé par le client — renseignez au moins un hôtel.");
      }

      if (lead.needs_driver) {
        const d = body.driver;
        if (!d?.total_price || Number(d.total_price) <= 0) {
          throw new HttpError(400, "Chauffeur demandé — renseignez le forfait chauffeur.");
        }
      }

      const main = options[0];
      const isSupabase = config.storage.driver === "supabase";
      const recomputed = !isSupabase
        ? computeCommissions({
            prix_vente: main.prix_vente,
            prix_revient: main.prix_revient || 0,
            apporteur_name: before.apporteur_name || null,
          })
        : null;

      const patch = {
        options,
        compagnie: main.compagnie,
        horaire_dep: main.horaire_dep || "",
        horaire_arr: main.horaire_arr || "",
        prix_vente: main.prix_vente,
        prix_revient: main.prix_revient || 0,
        prix_marche: main.prix_marche || 0,
        pricing_status: "ready",
        ...(body.hotels !== undefined ? { hotels: body.hotels } : {}),
        ...(body.driver !== undefined ? { driver: body.driver } : {}),
        valide_jusqu_au: isSupabase
          ? new Date(Date.now() + DAY).toISOString()
          : Date.now() + DAY,
      };

      async function updateTolerant(p) {
        try {
          return await store.devis.update(req.params.id, p);
        } catch (e) {
          const msg = e?.message || String(e);
          if (/pricing_status|email_sent_at|client_decision/i.test(msg) && /column|schema/i.test(msg)) {
            const reduced = { ...p };
            delete reduced.pricing_status;
            delete reduced.email_sent_at;
            delete reduced.client_decision;
            return updateTolerant(reduced);
          }
          throw e;
        }
      }

      let updated = await updateTolerant(patch);

      if (body.regenerate_pdf !== false) {
        const merged = { ...(updated || before), ...patch };
        const leadForPdf = lead;
        await generateDevisPdf({ devis: merged, lead: leadForPdf });
        const pdfPath = publicDevisPdfPath(merged.id);
        updated = await updateTolerant({ pdf_url: pdfPath });
      }

      if (lead.id) {
        await store.leads.update(lead.id, {
          value: main.prix_vente,
          margin: recomputed?.marge ?? main.prix_vente - (main.prix_revient || 0),
        });
      }

      const recap = {
        devis_id: updated.id,
        lead_name: lead.client_name,
        destination: lead.destination,
        options: options.map((o) => ({
          label: o.label,
          compagnie: o.compagnie,
          prix_vente_business: o.prix_vente_business,
          prix_vente_first: o.prix_vente_first,
          prix_vente: o.prix_vente,
        })),
        hotels: updated.hotels || patch.hotels || [],
        driver: updated.driver || patch.driver || null,
        client_email: String(lead.client_contact || "").match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0] || "",
        smtp_ready: isEmailConfigured(),
      };

      res.json({ item: sanitizeDevisForRole(updated, req.user.role), recap });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/:id/send-email",
  requireAdmin,
  validate({ params: idParamSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const devis = await store.devis.findById(req.params.id);
      if (!devis) throw new HttpError(404, "Devis introuvable");
      const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;
      if (!lead) throw new HttpError(400, "Lead manquant");

      const opts = normalizeAdminOptions(devis.options || [], lead);
      if (!opts.every((o) => o.compagnie && o.prix_vente > 0)) {
        throw new HttpError(400, "Tarifs incomplets — saisissez les 2 compagnies avant envoi.");
      }

      const baseUrl = resolvePublicBaseUrl(req);
      const lang = lead.lang === "en" ? "en" : "fr";
      const sent = await sendDevisEmailToClient({ devis: { ...devis, options: opts }, lead, baseUrl, lang });
      if (!sent.ok) throw new HttpError(502, sent.error || "Envoi email échoué");

      const now = Date.now();
      await store.devis.update(devis.id, {
        pricing_status: "sent",
        email_sent_at: config.storage.driver === "supabase" ? new Date(now).toISOString() : now,
      });
      await store.leads.update(lead.id, { status: "devis_sent", value: opts[0].prix_vente });

      res.json({ ok: true, messageId: sent.messageId });
    } catch (e) {
      next(e);
    }
  }
);

// ─── Génération PDF + envoi optionnel au client ──────────────────────
router.post(
  "/:id/pdf",
  requireDevis,
  validate({ params: idParamSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const devis = await store.devis.findById(req.params.id);
      if (!devis) throw new HttpError(404, "Devis introuvable");
      const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;

      const { filename } = await generateDevisPdf({ devis, lead });
      const pdfPath = `/api/public/devis/${encodeURIComponent(devis.id)}/pdf`;
      await store.devis.update(devis.id, { pdf_url: pdfPath });
      const publicUrl = buildPublicDevisPdfUrl(devis.id, { req });

      // Envoi auto au client si demandé.
      const sendTo = req.body?.send === true || req.body?.send === "client";
      let sent = null;
      if (sendTo && lead?.client_contact && lead?.canal) {
        const captionLines = [
          `Voici votre proposition Ola Flight (${devis.id}).`,
          devis.compagnie ? `Compagnie : ${devis.compagnie}` : null,
          `Tarif valable 24 h.`,
        ].filter(Boolean);
        sent = await sendMessage({
          channel: lead.canal,
          to: lead.client_contact,
          text: captionLines.join("\n"),
          attachments: [
            {
              type: "document",
              url: publicUrl,
              filename,
              caption: `Devis ${devis.id}`,
            },
          ],
        });
      }

      res.json({ pdf_url: publicUrl, pdf_path: pdfPath, filename, sent });
    } catch (e) { next(e); }
  }
);

export default router;
