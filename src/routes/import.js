// Import du Google Sheet de prospection (admin).
//
//   POST /api/import/preview   corps = fichier .xlsx brut → lit le fichier, renvoie un jeton
//                              + les onglets + une attribution proposée + l'aperçu
//   POST /api/import/plan      { token, mapping, perDay } → aperçu recalculé (rien n'est écrit)
//   POST /api/import/commit    { token, mapping, perDay } → crée les fiches
//
// Le fichier lu reste 30 min en mémoire (un seul serveur sur Railway). L'import
// est relançable : un client déjà présent n'est jamais recréé.

import { Router } from "express";
import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getStore } from "../db/index.js";
import { normalizeRole, roleLabel, ROLES } from "../lib/roles.js";
import { normalizeName } from "../lib/clientMatch.js";
import { parseWorkbook, planImport, commitImport } from "../lib/sheetImport.js";
import { logAction } from "../lib/activity.js";
import { createLogger } from "../logger.js";

const log = createLogger("import");
const router = Router();
router.use(requireAdmin);

const TTL = 30 * 60 * 1000;
const uploads = new Map(); // token → { tabs, at, filename }
const sweep = () => { for (const [k, v] of uploads) if (Date.now() - v.at > TTL) uploads.delete(k); };

async function teamUsers(store) {
  const users = await store.users.list();
  return users
    .filter((u) => u.active !== false && u.active !== 0)
    .map((u) => ({ email: u.email, name: u.display_name || u.email, role: normalizeRole(u.role), role_label: roleLabel(u.role) }));
}

/** Onglet « Mayana » → compte dont le prénom ou l'email commence par « mayana ». */
function suggestMapping(tabs, users) {
  const out = {};
  for (const t of tabs) {
    const key = normalizeName(t.name);
    const hit = t.rows.length ? users.find((u) => normalizeName(u.name).split(" ")[0] === key || normalizeName(u.email.split("@")[0]).replace(/[^a-z]/g, "") === key.replace(/[^a-z]/g, "")) : null;
    out[t.name] = hit ? hit.email : "";
  }
  return out;
}

function summarize(plan, tabs) {
  const reasons = plan.skipped.reduce((a, s) => ((a[s.reason] = (a[s.reason] || 0) + 1), a), {});
  const count = (f) => plan.toCreate.reduce((a, c) => ((a[f(c)] = (a[f(c)] || 0) + 1), a), {});
  return {
    tabs: tabs.map((t) => ({ name: t.name, rows: t.rows.length, ...plan.perTab[t.name] })),
    totals: {
      a_creer: plan.toCreate.length,
      deja_la: plan.alreadyThere.length,
      fusionnes: plan.merged.length,
      ignores: plan.skipped.length,
    },
    ignores_par_raison: reasons,
    statuts: count((c) => c.status),
    // « Recommandation (famille) », « … (mon frère) » : regroupées ici, le détail reste sur la fiche.
    sources: count((c) => (c.sourceLabel || "Inconnue").replace(/ \(.*\)$/, "")),
    chauds: plan.toCreate.filter((c) => c.temperature === "chaud").length,
    relances_jusquau: plan.relances_jusquau,
    merged: plan.merged.slice(0, 50),
    deja_la: plan.alreadyThere.slice(0, 50),
    warnings: plan.warnings.slice(0, 50),
    exemples: plan.toCreate.slice(0, 8).map((c) => ({
      name: c.name, contact: c.instagram ? "@" + c.instagram : c.phone ? "+" + c.phone : c.email || (c.otherHandle ? `${c.sourceLabel} : ${c.otherHandle}` : ""),
      besoin: c.besoin, status: c.status, temperature: c.temperature, tab: c.tab, next_followup: c.nextFollowup,
    })),
  };
}

async function buildPlan(token, mapping, perDay) {
  sweep();
  const up = uploads.get(token);
  if (!up) throw new HttpError(410, "Le fichier a expiré, rechargez-le");
  const store = await getStore();
  const [users, existing] = await Promise.all([teamUsers(store), store.leads.list()]);
  const valid = new Set(users.map((u) => u.email));
  for (const [tab, email] of Object.entries(mapping)) {
    if (email && !valid.has(email)) throw new HttpError(400, `Compte inconnu pour l'onglet ${tab}`);
  }
  const names = new Map(users.map((u) => [u.email, u.name]));
  return { store, up, plan: planImport(up.tabs, mapping, existing, { perDay, userNames: names }) };
}

// ─── 1. Lecture du fichier ──────────────────────────────────
router.post("/preview", express.raw({ type: () => true, limit: "15mb" }), async (req, res, next) => {
  try {
    if (!req.body?.length) throw new HttpError(400, "Fichier vide");
    let tabs;
    try { tabs = await parseWorkbook(req.body); }
    catch { throw new HttpError(400, "Fichier illisible : exportez le Google Sheet au format Excel (.xlsx)"); }
    if (!tabs.length) throw new HttpError(400, "Aucun onglet de prospection trouvé (colonnes Nom, Coordonnées et Statut attendues)");
    sweep();
    const token = crypto.randomBytes(16).toString("hex");
    uploads.set(token, { tabs, at: Date.now(), filename: String(req.get("x-filename") || "fichier.xlsx").slice(0, 120) });
    const store = await getStore();
    const users = await teamUsers(store);
    const mapping = suggestMapping(tabs, users);
    const { plan } = await buildPlan(token, mapping, 10);
    res.json({ token, users, mapping, per_day: 10, preview: summarize(plan, tabs) });
  } catch (e) { next(e); }
});

const planSchema = z.object({
  token: z.string().length(32),
  mapping: z.record(z.string()),
  perDay: z.coerce.number().int().min(1).max(100).default(10),
});

// ─── 2. Aperçu selon l'attribution choisie ──────────────────
router.post("/plan", validate({ body: planSchema }), async (req, res, next) => {
  try {
    const { up, plan } = await buildPlan(req.body.token, req.body.mapping, req.body.perDay);
    res.json({ preview: summarize(plan, up.tabs) });
  } catch (e) { next(e); }
});

// ─── 3. Import ──────────────────────────────────────────────
router.post("/commit", validate({ body: planSchema }), async (req, res, next) => {
  try {
    const { store, up, plan } = await buildPlan(req.body.token, req.body.mapping, req.body.perDay);
    if (!plan.toCreate.length) throw new HttpError(400, "Rien à importer : tous les clients sont déjà dans le CRM");
    const started = Date.now();
    const result = await commitImport(store, plan);
    uploads.delete(req.body.token);
    log.info(`import ${up.filename} : ${result.created} fiches, ${result.events} échanges, ${result.errors.length} erreurs (${Date.now() - started} ms) par ${req.user.email}`);
    logAction(req.user, "import", `Import du Google Sheet : ${result.created} clients`);
    const byOwner = plan.toCreate.reduce((a, c) => ((a[c.owner] = (a[c.owner] || 0) + 1), a), {});
    res.json({ ...result, par_concierge: byOwner, fusionnes: plan.merged.length, deja_la: plan.alreadyThere.length, ignores: plan.skipped.length });
  } catch (e) { next(e); }
});

export default router;
