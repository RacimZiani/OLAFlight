// Devis de conciergerie multi-prestations (chauffeur, personal shopping,
// horlogerie, hôtel, jet…).
//
//   GET  /api/devis-conciergerie/catalog   → catalogue des services
//   POST /api/devis-conciergerie           → crée le devis (+ fiche client si besoin) et son PDF
//   PUT  /api/devis-conciergerie/:id       → modifie les prestations et régénère le PDF
//
// Les devis vol historiques restent gérés par routes/devis.js.

import { Router } from "express";
import { logAction } from "../lib/activity.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireBackoffice, requireDevis } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { uid, uuidv4 } from "../lib/ids.js";
import { createLogger } from "../logger.js";
import { SERVICE_CATALOG, normalizePrestations } from "../lib/serviceCatalog.js";
import { computeCommissions, sanitizeDevisForRole } from "../lib/commissions.js";
import { conciergeFields, isOwnConciergeDevis } from "../lib/conciergeCommission.js";
import { findOrCreateClient } from "../lib/clientMatch.js";
import { canAccessLead, filterLeadsForUser, isAdmin } from "../lib/roles.js";
import { generateDevisPdf } from "../lib/pdf.js";
import { writeTolerant } from "../lib/dbTolerant.js";
import { followupPatch } from "../lib/followups.js";
import { buildPublicDevisPdfUrl } from "../lib/publicUrl.js";

const log = createLogger("devis-conciergerie");
const router = Router();
router.use(requireBackoffice);

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VALIDITE_JOURS = 7;

const ligneSchema = z.object({
  type: z.string().max(40),
  titre: z.string().max(160).optional(),
  details: z.record(z.string().max(200)).optional(),
  description: z.string().max(1000).optional(),
  quantite: z.coerce.number().int().min(1).max(999).optional(),
  prix_unitaire: z.coerce.number().min(0).nullable().optional(),
  prix_achat_unitaire: z.coerce.number().min(0).nullable().optional(),
  sur_devis: z.boolean().optional(),
});

const clientSchema = z.object({
  lead_id: z.string().optional(),
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  instagram: z.string().max(120).optional(),
  email: z.string().max(160).optional(),
}).refine(
  (c) => c.lead_id || (c.name && c.name.trim()) || c.phone || c.instagram || c.email,
  { message: "Client requis : un nom ou une coordonnée" }
);

const bodySchema = z.object({
  client: clientSchema,
  prestations: z.array(ligneSchema).min(1, "Ajoutez au moins une prestation").max(30),
  notes: z.string().max(2000).optional(),
  validite_jours: z.coerce.number().int().min(1).max(90).optional(),
});

const putSchema = bodySchema.omit({ client: true });

const ts = (ms) => (config.storage.driver === "supabase" ? new Date(ms).toISOString() : ms);

/** Champs marge / commissions closer & apporteur : SQLite seulement (colonnes GENERATED en Supabase). */
function legacyCommissionFields(prix_vente, prix_revient, apporteur_name) {
  if (config.storage.driver === "supabase") return {};
  const { marge, closer_commission, apporteur_commission } = computeCommissions({ prix_vente, prix_revient, apporteur_name });
  return { marge, closer_commission, apporteur_commission };
}

async function renderPdf(store, devis, lead, req) {
  try {
    await generateDevisPdf({ devis, lead });
    const pdf_url = `/api/public/devis/${encodeURIComponent(devis.id)}/pdf`;
    await store.devis.update(devis.id, { pdf_url });
    return { pdf_url, public_pdf_url: buildPublicDevisPdfUrl(devis.id, { req }), pdf_error: null };
  } catch (e) {
    log.warn(`pdf ${devis.id} : ${e?.message || e}`);
    return { pdf_url: null, public_pdf_url: null, pdf_error: "Le PDF n'a pas pu être généré, le devis est bien enregistré." };
  }
}

router.get("/catalog", (_req, res) => {
  res.json({ items: SERVICE_CATALOG, default_validite_jours: DEFAULT_VALIDITE_JOURS });
});

router.post("/", requireDevis, validate({ body: bodySchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const { client, notes, validite_jours } = req.body;
    const { prestations, prix_vente, prix_revient } = normalizePrestations(req.body.prestations);

    // 1) Fiche client : existante (lead_id), retrouvée par coordonnées, ou créée.
    let lead;
    let created_client = false;
    if (client.lead_id) {
      lead = await store.leads.findById(client.lead_id);
      if (!lead) throw new HttpError(404, "Client introuvable");
      if (!isAdmin(req.user) && !canAccessLead(req.user, lead)) throw new HttpError(403, "Client hors de votre portefeuille");
    } else {
      const visible = filterLeadsForUser(await store.leads.list(), req.user);
      ({ lead, created: created_client } = await findOrCreateClient(store, req.user, client, visible));
    }

    // 2) Devis.
    const now = Date.now();
    const days = validite_jours || DEFAULT_VALIDITE_JOURS;
    const devis = {
      id: config.storage.driver === "supabase" ? uuidv4() : `OLA-${uid().slice(0, 6)}`,
      kind: "conciergerie",
      lead_id: lead.id,
      client_name: lead.client_name,
      compagnie: prestations.map((p) => p.titre).join(" · ").slice(0, 200),
      prestations,
      prix_vente,
      prix_revient,
      prix_marche: 0,
      apporteur_name: lead.apporteur_name || null,
      services_inclus: [],
      notes: notes || "",
      validite_jours: days,
      valide_jusqu_au: ts(now + days * DAY),
      paiement_recu: false,
      created_at: ts(now),
      updated_at: ts(now),
      ...legacyCommissionFields(prix_vente, prix_revient, lead.apporteur_name),
      ...(await conciergeFields(store, { user: req.user, lead, prix_vente, prix_revient })),
    };
    await writeTolerant((row) => store.devis.insert(row), devis, { table: "devis" });
    logAction(req.user, "devis_cree", `Devis ${devis.id} · ${lead.client_name} · ${prix_vente} €`, lead.id);
    if (created_client) logAction(req.user, "client_cree", `Client créé : ${lead.client_name}`, lead.id);

    // 3) Le lead suit le devis (statut + valeur), sans bloquer en cas d'échec.
    const keep = ["won", "nego"].includes(lead.status);
    store.leads.update(lead.id, {
      status: keep ? lead.status : "devis_sent",
      value: prix_vente,
      margin: prix_vente - prix_revient,
      ...(keep ? {} : followupPatch({ ...lead, status: "devis_sent" }, "devis_sent")),
    }).catch((e) => log.warn(`lead update ${lead.id} : ${e?.message || e}`));

    const pdf = await renderPdf(store, devis, lead, req);
    res.json({
      item: sanitizeDevisForRole({ ...devis, pdf_url: pdf.pdf_url }, req.user.role),
      lead: {
        id: lead.id, client_name: lead.client_name, client_contact: lead.client_contact,
        canal: lead.canal, phone: lead.phone || null, instagram: lead.instagram || null, email: lead.email || null,
      },
      created_client,
      ...pdf,
    });
  } catch (e) { next(e); }
});

router.put("/:id", requireDevis, validate({ body: putSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const before = await store.devis.findById(req.params.id);
    if (!before) throw new HttpError(404, "Devis introuvable");
    if (before.kind !== "conciergerie") throw new HttpError(400, "Ce devis n'est pas un devis de conciergerie");
    const lead = before.lead_id ? await store.leads.findById(before.lead_id) : null;
    // Modification réservée à l'admin et à la concierge du devis : eux seuls
    // voient les prix d'achat, un autre rôle les effacerait en renvoyant le formulaire.
    if (!isAdmin(req.user) && !isOwnConciergeDevis(req.user, before)) {
      throw new HttpError(403, "Seules l'admin et la concierge du devis peuvent le modifier");
    }

    const { prestations, prix_vente, prix_revient } = normalizePrestations(req.body.prestations);
    const days = req.body.validite_jours || before.validite_jours || DEFAULT_VALIDITE_JOURS;
    const now = Date.now();
    const patch = {
      prestations,
      prix_vente,
      prix_revient,
      compagnie: prestations.map((p) => p.titre).join(" · ").slice(0, 200),
      ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
      validite_jours: days,
      valide_jusqu_au: ts(now + days * DAY),
      ...legacyCommissionFields(prix_vente, prix_revient, before.apporteur_name),
      ...(await conciergeFields(store, { lead, conciergeName: before.concierge_name, prix_vente, prix_revient })),
    };
    const updated = (await writeTolerant((row) => store.devis.update(before.id, row), patch, { table: "devis" })) || { ...before, ...patch };
    logAction(req.user, "devis_modifie", `Devis ${before.id} modifié · ${prix_vente} €`, before.lead_id);
    if (lead) {
      store.leads.update(lead.id, { value: prix_vente, margin: prix_vente - prix_revient }).catch(() => {});
    }
    const pdf = await renderPdf(store, updated, lead, req);
    res.json({ item: sanitizeDevisForRole({ ...updated, pdf_url: pdf.pdf_url ?? updated.pdf_url }, req.user.role), ...pdf });
  } catch (e) { next(e); }
});

export default router;
