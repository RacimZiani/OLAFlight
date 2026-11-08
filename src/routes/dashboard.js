// Tableau de bord personnel et classement de l'équipe.
//
//   GET /api/dashboard?period=week|month|last_month   → mes chiffres + classement
//   PUT /api/dashboard/settings                       → admin : visibilité du classement
//
// Définitions (période en heure de Paris, semaine du lundi au dimanche) :
//   vente        = devis payé dans la période (paid_at)
//   CA           = total des ventes
//   devis        = devis créés dans la période
//   conversion   = ventes / devis de la période
//   commissions  = commission concierge des ventes de la période
//   échanges     = DM, appels, rendez-vous notés (journal d'activité)
// Une vente revient à la concierge du devis, sinon au closer du client.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireBackoffice, requireAdmin } from "../middleware/auth.js";
import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { normalizeRole, roleLabel, ROLES, isAdmin } from "../lib/roles.js";
import { parisDay, toMs } from "../lib/activity.js";
import { followupState } from "../lib/followups.js";
import { getSettings, setSettings } from "../lib/settings.js";

const router = Router();
router.use(requireBackoffice);

const DAY = 864e5;
const SELLERS = new Set([ROLES.CONCIERGE, ROLES.CLOSER]);

/** Bornes de la période, en jours AAAA-MM-JJ (heure de Paris). */
function periodBounds(period, now = Date.now()) {
  const today = parisDay(now);
  const [y, m, d] = today.split("-").map(Number);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (period === "week") {
    const date = new Date(Date.UTC(y, m - 1, d));
    const dow = (date.getUTCDay() + 6) % 7; // lundi = 0
    const start = new Date(date.getTime() - dow * DAY);
    return { from: iso(start), to: iso(new Date(start.getTime() + 6 * DAY)), label: "Cette semaine" };
  }
  if (period === "last_month") {
    const start = new Date(Date.UTC(y, m - 2, 1));
    const end = new Date(Date.UTC(y, m - 1, 0));
    return { from: iso(start), to: iso(end), label: start.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { from: iso(start), to: iso(end), label: "Ce mois-ci" };
}

const inPeriod = (v, p) => { const ms = toMs(v); if (!ms) return false; const d = parisDay(ms); return d >= p.from && d <= p.to; };

function computeStats(users, leads, devis, log, p) {
  const leadById = new Map(leads.map((l) => [String(l.id), l]));
  const ownerOf = (dv) => dv.concierge_name || leadById.get(String(dv.lead_id))?.closer_name || null;

  const stats = new Map();
  for (const u of users) {
    stats.set(u.email, {
      email: u.email, name: u.display_name || u.email.split("@")[0], role: normalizeRole(u.role),
      role_label: roleLabel(u.role), monthly_goal: u.monthly_goal != null ? Number(u.monthly_goal) : null,
      ca: 0, marge: 0, ventes: 0, devis: 0, commissions: 0, echanges: 0, clients: 0, best_sale: 0,
      relances_en_retard: 0, clients_suivis: 0,
    });
  }
  for (const dv of devis) {
    const s = stats.get(ownerOf(dv));
    if (!s) continue;
    if (inPeriod(dv.created_at, p)) s.devis += 1;
    if (dv.paiement_recu && inPeriod(dv.paid_at || dv.updated_at, p)) {
      const pv = Number(dv.prix_vente) || 0;
      s.ventes += 1;
      s.ca += pv;
      s.marge += pv - (Number(dv.prix_revient) || 0);
      s.commissions += Number(dv.concierge_commission) || 0;
      s.best_sale = Math.max(s.best_sale, pv);
    }
  }
  for (const a of log) {
    const s = stats.get(a.user_email);
    if (!s || !inPeriod(a.created_at, p)) continue;
    if (a.type === "echange") s.echanges += 1;
    if (a.type === "client_cree") s.clients += 1;
  }
  for (const l of leads) {
    const s = stats.get(l.closer_name);
    if (!s) continue;
    s.clients_suivis += 1;
    if (followupState(l) === "en_retard") s.relances_en_retard += 1;
  }
  for (const s of stats.values()) {
    s.conversion = s.devis ? Math.round((s.ventes / s.devis) * 100) : null;
  }
  return [...stats.values()];
}

/** Badges de la période, attribués à une seule personne chacun (sauf « relances à jour »). */
function awardBadges(list) {
  const badges = new Map(list.map((s) => [s.email, []]));
  const top = (key, min = 1) => {
    const best = [...list].sort((a, b) => b[key] - a[key])[0];
    return best && best[key] >= min ? best : null;
  };
  const give = (s, label, hint) => s && badges.get(s.email).push({ label, hint });
  give(top("ca"), "N°1 des ventes", "Plus gros chiffre d'affaires de la période");
  give(top("best_sale"), "Plus belle vente", "La vente la plus importante de la période");
  give(top("echanges", 5), "La plus active", "Le plus d'échanges notés avec les clients");
  give(top("clients", 3), "Chasseuse", "Le plus de nouveaux clients");
  for (const s of list) {
    if (s.clients_suivis >= 3 && s.relances_en_retard === 0) give(s, "Relances à jour", "Aucune relance en retard");
    if (s.monthly_goal && s.commissions >= s.monthly_goal) give(s, "Objectif atteint", "Objectif mensuel de commissions atteint");
  }
  return badges;
}

router.get("/", async (req, res, next) => {
  try {
    const period = ["week", "month", "last_month"].includes(req.query.period) ? req.query.period : "month";
    const p = periodBounds(period);
    const store = await getStore();
    const since = Date.parse(p.from + "T00:00:00Z") - DAY;
    const sinceDb = config.storage.driver === "supabase" ? new Date(since).toISOString() : since;
    const [users, leads, devis, log, settings] = await Promise.all([
      store.users.list(),
      store.leads.list(),
      store.devis.list(),
      store.activity_log?.listSince ? store.activity_log.listSince("created_at", sinceDb).catch(() => []) : [],
      getSettings(),
    ]);
    const sellers = users.filter((u) => SELLERS.has(normalizeRole(u.role)) && u.active !== false && u.active !== 0);
    const stats = computeStats(sellers, leads, devis, log, p);
    const badges = awardBadges(stats);
    const admin = isAdmin(req.user);

    const ranked = [...stats]
      .sort((a, b) => b.ca - a.ca || b.ventes - a.ventes || b.devis - a.devis || b.echanges - a.echanges)
      .map((s, i) => ({ ...s, rank: i + 1, badges: badges.get(s.email) || [] }));

    const me = ranked.find((s) => s.email === req.user.email) || null;
    const showBoard = admin || settings.leaderboard_visible;
    const showAmounts = admin || settings.leaderboard_amounts;
    const leaderboard = showBoard
      ? ranked.map((s) => {
          const self = s.email === req.user.email;
          const row = {
            rank: s.rank, name: s.name, role_label: s.role_label, self,
            ventes: s.ventes, devis: s.devis, echanges: s.echanges, conversion: s.conversion, badges: s.badges,
          };
          if (showAmounts || self) Object.assign(row, { ca: s.ca, commissions: s.commissions });
          if (admin) Object.assign(row, { email: s.email, marge: s.marge });
          return row;
        })
      : null;

    // Ma part : rien sur la marge pour une concierge (elle la voit déjà devis par devis).
    // Classement masqué par la direction : pas de rang non plus (il trahirait le classement).
    const mine = me && {
      rank: showBoard ? me.rank : null, out_of: showBoard ? ranked.length : null, ca: me.ca, ventes: me.ventes, devis: me.devis,
      conversion: me.conversion, commissions: me.commissions, echanges: me.echanges, clients: me.clients,
      relances_en_retard: me.relances_en_retard, monthly_goal: me.monthly_goal, badges: me.badges,
      // L'écart en euros trahirait le CA de la personne devant : seulement si les montants sont visibles.
      gap_to_next: showBoard && showAmounts && me.rank > 1 ? Math.max(0, ranked[me.rank - 2].ca - me.ca) : null,
    };

    res.json({
      period: { key: period, ...p },
      me: mine,
      leaderboard,
      settings: admin ? settings : { leaderboard_visible: settings.leaderboard_visible, leaderboard_amounts: settings.leaderboard_amounts },
      team: admin ? {
        ca: stats.reduce((s, x) => s + x.ca, 0),
        marge: stats.reduce((s, x) => s + x.marge, 0),
        ventes: stats.reduce((s, x) => s + x.ventes, 0),
        devis: stats.reduce((s, x) => s + x.devis, 0),
        commissions: stats.reduce((s, x) => s + x.commissions, 0),
      } : null,
    });
  } catch (e) { next(e); }
});

const settingsSchema = z.object({
  leaderboard_visible: z.boolean().optional(),
  leaderboard_amounts: z.boolean().optional(),
});

router.put("/settings", requireAdmin, validate({ body: settingsSchema }), async (req, res, next) => {
  try { res.json({ settings: await setSettings(req.body) }); } catch (e) { next(e); }
});

export default router;
