import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { devisCreateSchema, devisQuerySchema, idParamSchema } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { uid } from "../lib/ids.js";
import { computeCommissions, sanitizeDevisForRole } from "../lib/commissions.js";
import { generateDevisPdf } from "../lib/pdf.js";
import { sendMessage } from "../lib/messaging/index.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/errorHandler.js";
import { requireBackoffice, requireRole } from "../middleware/auth.js";

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

router.get("/", validate({ query: devisQuerySchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const items = await store.devis.list();
    // Le rôle vient de la session JWT (req.user.role) — la query.role legacy est
    // ignorée pour ne pas pouvoir réclamer un rôle plus élevé via l'URL.
    const role = req.user.role;
    res.json({ items: items.map((d) => sanitizeDevisForRole(d, role)) });
  } catch (e) { next(e); }
});

router.post("/", requireRole("admin", "dalsim"), validate({ body: devisCreateSchema }), async (req, res, next) => {
  try {
    const body = req.body;
    const { marge, closer_commission, apporteur_commission } = computeCommissions({
      prix_vente: body.prix_vente,
      prix_revient: body.prix_revient,
      apporteur_name: body.apporteur_name,
    });

    const now = Date.now();
    const devis = {
      id: body.id || `OLA-${uid().slice(0, 6)}`,
      lead_id: body.lead_id,
      compagnie: body.compagnie || "",
      horaire_dep: body.horaire_dep || "",
      horaire_arr: body.horaire_arr || "",
      prix_revient: body.prix_revient || 0,
      prix_vente: body.prix_vente || 0,
      prix_marche: body.prix_marche || 0,
      marge,
      closer_commission,
      apporteur_commission,
      apporteur_name: body.apporteur_name || null,
      services_inclus: parseServices(body.services_inclus),
      pdf_url: body.pdf_url || null,
      valide_jusqu_au: now + DAY,
      paiement_recu: false,
      created_at: now,
      updated_at: now,
    };

    const store = await getStore();
    await store.devis.insert(devis);

    // Met à jour le lead lié → devis_sent + propage value/margin (lecture CRM).
    if (devis.lead_id) {
      await store.leads.update(devis.lead_id, {
        status: "devis_sent",
        value: devis.prix_vente,
        margin: devis.marge,
      });
    }

    res.json({ item: devis });
  } catch (e) { next(e); }
});

// ─── Génération PDF + envoi optionnel au client ──────────────────────
router.post(
  "/:id/pdf",
  requireRole("admin", "dalsim"),
  validate({ params: idParamSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const devis = await store.devis.findById(req.params.id);
      if (!devis) throw new HttpError(404, "Devis introuvable");
      const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;

      const { publicUrl, filename } = await generateDevisPdf({ devis, lead });
      // On stocke l'URL dans le devis pour récupération directe dans le CRM.
      await store.devis.update(devis.id, { pdf_url: publicUrl });

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
              url: `${config.publicUrl}${publicUrl}`,
              filename,
              caption: `Devis ${devis.id}`,
            },
          ],
        });
      }

      res.json({ pdf_url: publicUrl, filename, sent });
    } catch (e) { next(e); }
  }
);

export default router;
