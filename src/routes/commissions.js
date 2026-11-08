// Commissions concierge : compteur personnel + données du simulateur.
//
//   GET /api/commissions/me            → la concierge connectée
//   GET /api/commissions/me?email=…    → admin : la concierge choisie
//
// Encaissée  = devis payé (paiement_recu) ou lead gagné.
// Potentielle = devis en cours (ni encaissé, ni lead perdu / archivé).
// « Ce mois-ci » se base sur la date de création du devis.

import { Router } from "express";
import { getStore } from "../db/index.js";
import { HttpError } from "../middleware/errorHandler.js";
import { requireBackoffice } from "../middleware/auth.js";
import { normalizeRole, ROLES } from "../lib/roles.js";
import { COMMISSION_RATES, conciergeRate } from "../lib/commissions.js";

const router = Router();
router.use(requireBackoffice);

const CLOSED_LOST = new Set(["lost", "archived"]);

function toMs(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

router.get("/me", async (req, res, next) => {
  try {
    const role = normalizeRole(req.user.role);
    let email = req.user.email;
    if (req.query.email) {
      if (role !== ROLES.ADMIN) throw new HttpError(403, "Admin requis");
      email = String(req.query.email).toLowerCase();
    } else if (role !== ROLES.CONCIERGE && role !== ROLES.ADMIN) {
      throw new HttpError(403, "Réservé aux concierges");
    }

    const store = await getStore();
    const user = email ? await store.users.findByField?.("email", email) : null;
    const rate = user ? conciergeRate(user) : COMMISSION_RATES.concierge;

    const [allDevis, allLeads] = await Promise.all([store.devis.list(), store.leads.list()]);
    const leadsById = new Map(allLeads.map((l) => [String(l.id), l]));
    const mine = email ? allDevis.filter((d) => d.concierge_name === email) : [];

    const monthStart = startOfMonth();
    const totals = { encaisse: 0, potentiel: 0, encaisse_mois: 0, potentiel_mois: 0, ventes_mois: 0 };
    const items = [];

    for (const d of mine) {
      const lead = d.lead_id ? leadsById.get(String(d.lead_id)) : null;
      const amount = Number(d.concierge_commission) || 0;
      const won = Boolean(d.paiement_recu) || lead?.status === "won";
      const lost = !won && lead && CLOSED_LOST.has(lead.status);
      const thisMonth = toMs(d.created_at) >= monthStart;
      const state = won ? "encaisse" : lost ? "perdu" : "potentiel";

      if (state === "encaisse") {
        totals.encaisse += amount;
        if (thisMonth) { totals.encaisse_mois += amount; totals.ventes_mois += 1; }
      } else if (state === "potentiel") {
        totals.potentiel += amount;
        if (thisMonth) totals.potentiel_mois += amount;
      }

      items.push({
        id: d.id,
        client_name: d.client_name || lead?.client_name || null,
        prix_vente: Number(d.prix_vente) || 0,
        commission: amount,
        state,
        created_at: d.created_at,
      });
    }

    items.sort((a, b) => toMs(b.created_at) - toMs(a.created_at));

    res.json({
      email,
      rate_pct: Math.round(rate * 1000) / 10,
      monthly_goal: user?.monthly_goal != null ? Number(user.monthly_goal) : null,
      totals,
      items: items.slice(0, 50),
    });
  } catch (e) { next(e); }
});

export default router;
