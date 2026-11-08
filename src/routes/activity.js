// Suivi d'activité.
//
//   POST /api/activity/ping              → pulsation du back-office (tous les membres)
//   GET  /api/activity/team              → admin : vue d'équipe (en ligne, temps, actions, alertes)
//   GET  /api/activity/user?email=…      → admin : détail d'une personne (30 jours + journal)
//   GET  /api/activity/export.csv        → admin : export jour par jour (?from=AAAA-MM-JJ&to=…)

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireBackoffice, requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { getStore } from "../db/index.js";
import { config } from "../config.js";
import { recordPing, parisDay, toMs } from "../lib/activity.js";
import { followupState } from "../lib/followups.js";
import { normalizeRole, roleLabel, ROLES } from "../lib/roles.js";

const router = Router();
router.use(requireBackoffice);

const DAY = 24 * 60 * 60 * 1000;
const ONLINE_MS = 3 * 60 * 1000;
const sinceValue = (ms) => (config.storage.driver === "supabase" ? new Date(ms).toISOString() : ms);
const lastDays = (n) => Array.from({ length: n }, (_, i) => parisDay(Date.now() - (n - 1 - i) * DAY));

// ─── Pulsation ──────────────────────────────────────────────
const pingSchema = z.object({ active: z.boolean().default(true), page: z.string().max(80).optional() });
router.post("/ping", validate({ body: pingSchema }), async (req, res) => {
  await recordPing(req.user, req.body);
  res.status(204).end();
});

// ─── Données communes ───────────────────────────────────────
async function loadAll(days) {
  const store = await getStore();
  if (!store.activity_days || !store.activity_log) throw new HttpError(503, "Suivi d'activité indisponible (migration 018 manquante)");
  const since = Date.now() - days * DAY;
  const [users, dayRows, log, leads] = await Promise.all([
    store.users.list(),
    store.activity_days.listSince("day", parisDay(since)),
    store.activity_log.listSince("created_at", sinceValue(since)),
    store.leads.list(),
  ]);
  return { users, dayRows, log, leads };
}

const MEMBER_ROLES = new Set([ROLES.CONCIERGE, ROLES.CLOSER, ROLES.PROSPECTEUR]);

function memberSummary(u, { dayRows, log, leads }, now = Date.now()) {
  const today = parisDay(now);
  const mine = dayRows.filter((r) => r.user_email === u.email);
  const byDay = new Map(mine.map((r) => [r.day, r]));
  const todayRow = byDay.get(today);
  const week = lastDays(7);
  const lastSeen = Math.max(0, ...mine.map((r) => toMs(r.last_seen)));
  const actionsToday = log.filter((a) => a.user_email === u.email && parisDay(toMs(a.created_at)) === today && a.type !== "login");
  const count = (list, type) => list.filter((a) => a.type === type).length;

  const myLeads = leads.filter((l) => l.closer_name === u.email || l.apporteur_name === u.email);
  const late = myLeads.filter((l) => followupState(l, now) === "en_retard").length;
  const dueToday = myLeads.filter((l) => followupState(l, now) === "aujourdhui").length;

  const alerts = [];
  const daysAway = lastSeen ? Math.floor((now - lastSeen) / DAY) : null;
  if (lastSeen === 0) alerts.push("Jamais connectée");
  else if (daysAway >= 2) alerts.push(`Pas connectée depuis ${daysAway} jours`);
  if (late >= 3) alerts.push(`${late} relances en retard`);
  const parisHour = Number(new Date(now).toLocaleString("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }));
  const weekday = !["Sat", "Sun"].includes(new Date(now).toLocaleString("en-US", { timeZone: "Europe/Paris", weekday: "short" }));
  if (weekday && parisHour >= 15 && todayRow && !actionsToday.length) alerts.push("Connectée mais aucune action aujourd'hui");

  return {
    email: u.email,
    name: u.display_name || u.email,
    role: normalizeRole(u.role),
    role_label: roleLabel(u.role),
    active: u.active !== false && u.active !== 0,
    online: lastSeen > 0 && now - lastSeen < ONLINE_MS,
    last_seen: lastSeen || null,
    today: {
      active_minutes: Math.round((Number(todayRow?.active_seconds) || 0) / 60),
      first_seen: todayRow?.first_seen ?? null,
      logins: Number(todayRow?.logins) || 0,
      dm: count(actionsToday, "echange"),
      devis: count(actionsToday, "devis_cree"),
      clients: count(actionsToday, "client_cree"),
      ventes: count(actionsToday, "devis_paye"),
      actions: actionsToday.length,
    },
    week_minutes: Math.round(week.reduce((s, d) => s + (Number(byDay.get(d)?.active_seconds) || 0), 0) / 60),
    week_series: week.map((d) => ({ day: d, minutes: Math.round((Number(byDay.get(d)?.active_seconds) || 0) / 60) })),
    relances: { en_retard: late, aujourdhui: dueToday },
    clients_total: myLeads.length,
    alerts,
  };
}

// ─── Vue d'équipe ───────────────────────────────────────────
router.get("/team", requireAdmin, async (_req, res, next) => {
  try {
    const data = await loadAll(8);
    const members = data.users
      .filter((u) => MEMBER_ROLES.has(normalizeRole(u.role)) && u.active !== false && u.active !== 0)
      .map((u) => memberSummary(u, data))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.last_seen || 0) - (a.last_seen || 0));
    res.json({
      members,
      totals: {
        online: members.filter((m) => m.online).length,
        active_minutes_today: members.reduce((s, m) => s + m.today.active_minutes, 0),
        actions_today: members.reduce((s, m) => s + m.today.actions, 0),
        alerts: members.reduce((s, m) => s + m.alerts.length, 0),
      },
    });
  } catch (e) { next(e); }
});

// ─── Détail d'une personne ──────────────────────────────────
router.get("/user", requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.query.email || "").toLowerCase();
    const data = await loadAll(30);
    const u = data.users.find((x) => x.email === email);
    if (!u) throw new HttpError(404, "Personne introuvable");
    const byDay = new Map(data.dayRows.filter((r) => r.user_email === email).map((r) => [r.day, r]));
    const leadNames = new Map(data.leads.map((l) => [String(l.id), l.client_name]));
    res.json({
      member: memberSummary(u, data),
      days: lastDays(30).map((d) => {
        const r = byDay.get(d);
        const acts = data.log.filter((a) => a.user_email === email && parisDay(toMs(a.created_at)) === d && a.type !== "login");
        return {
          day: d,
          minutes: Math.round((Number(r?.active_seconds) || 0) / 60),
          logins: Number(r?.logins) || 0,
          first_seen: r?.first_seen ?? null,
          last_seen: r?.last_seen ?? null,
          actions: acts.length,
        };
      }),
      journal: data.log
        .filter((a) => a.user_email === email)
        .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
        .slice(0, 150)
        .map((a) => ({ type: a.type, label: a.label, at: a.created_at, lead_id: a.lead_id, client_name: leadNames.get(String(a.lead_id)) || null })),
    });
  } catch (e) { next(e); }
});

// ─── Export CSV ─────────────────────────────────────────────
router.get("/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const to = iso.test(req.query.to || "") ? req.query.to : parisDay();
    const from = iso.test(req.query.from || "") ? req.query.from : parisDay(Date.now() - 29 * DAY);
    const span = Math.ceil((Date.now() - Date.parse(from + "T00:00:00Z")) / DAY) + 1;
    const data = await loadAll(Math.min(Math.max(span, 1), 400));
    const names = new Map(data.users.map((u) => [u.email, [u.display_name || u.email, roleLabel(u.role)]]));
    const time = (v) => (toMs(v) ? new Date(toMs(v)).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "");

    const actions = new Map(); // email|jour → { type: n }
    for (const a of data.log) {
      const k = `${a.user_email}|${parisDay(toMs(a.created_at))}`;
      const m = actions.get(k) || {};
      m[a.type] = (m[a.type] || 0) + 1;
      actions.set(k, m);
    }
    const rows = data.dayRows
      .filter((r) => r.day >= from && r.day <= to)
      .sort((a, b) => a.day.localeCompare(b.day) || a.user_email.localeCompare(b.user_email));

    const esc = (v) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Date", "Personne", "Email", "Rôle", "Première connexion", "Dernière activité", "Temps actif (min)", "Connexions", "Échanges notés", "Clients créés", "Devis créés", "Devis payés"];
    const lines = [header.join(";")];
    for (const r of rows) {
      const [name, role] = names.get(r.user_email) || [r.user_email, ""];
      const a = actions.get(r.id) || {};
      lines.push([
        r.day, name, r.user_email, role, time(r.first_seen), time(r.last_seen),
        Math.round((Number(r.active_seconds) || 0) / 60), Number(r.logins) || 0,
        a.echange || 0, a.client_cree || 0, a.devis_cree || 0, a.devis_paye || 0,
      ].map(esc).join(";"));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="activite-equipe-${from}-${to}.csv"`);
    res.send("﻿" + lines.join("\r\n")); // BOM : Excel ouvre les accents correctement
  } catch (e) { next(e); }
});

export default router;
