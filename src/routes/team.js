import { Router } from "express";
import { getStore } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import { normalizeRole, ROLES } from "../lib/roles.js";

const router = Router();

router.use(requireAdmin);

const WON = "won";
const NEGO = "nego";
const OPEN = new Set([
  "qualification", "new", "contacted", "devis_pending", "devis_sent",
  "interested", "call_booked", "offer", "nego",
]);

function statsForMember(email, leads, kind) {
  const mine = leads.filter((l) =>
    kind === "closer" ? l.closer_name === email : l.apporteur_name === email
  );
  const open = mine.filter((l) => OPEN.has(String(l.status || "")));
  const won = mine.filter((l) => l.status === WON);
  const nego = mine.filter((l) => l.status === NEGO);
  const value = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
  return {
    email,
    total: mine.length,
    open: open.length,
    won: won.length,
    nego: nego.length,
    pipeline_value: open.reduce((s, l) => s + (Number(l.value) || 0), 0),
    won_value: value,
  };
}

router.get("/overview", async (_req, res, next) => {
  try {
    const store = await getStore();
    const [users, leads] = await Promise.all([
      store.users?.list?.() || [],
      store.leads.list(),
    ]);

    const closers = users
      .filter((u) => normalizeRole(u.role) === ROLES.CLOSER && u.active !== false)
      .map((u) => ({
        email: u.email,
        name: u.display_name || u.name || u.email,
        role: u.role,
        ...statsForMember(u.email, leads, "closer"),
      }));

    const prospecteurs = users
      .filter((u) => normalizeRole(u.role) === ROLES.PROSPECTEUR && u.active !== false)
      .map((u) => ({
        email: u.email,
        name: u.display_name || u.name || u.email,
        role: u.role,
        ...statsForMember(u.email, leads, "prospecteur"),
      }));

    res.json({
      closers,
      prospecteurs,
      totals: {
        leads: leads.length,
        open: leads.filter((l) => OPEN.has(String(l.status || ""))).length,
        won: leads.filter((l) => l.status === WON).length,
        nego: leads.filter((l) => l.status === NEGO).length,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
