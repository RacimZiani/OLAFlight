import { Router } from "express";
import { requireBackoffice } from "../middleware/auth.js";
import { listForUser, markRead, markAllReadForUser } from "../lib/notifBus.js";
import { isNtfyEnabled, pushSetupForUser } from "../lib/ntfy.js";

const router = Router();
router.use(requireBackoffice);

router.get("/", async (req, res, next) => {
  try {
    const unread = String(req.query.unread || "") === "1" || req.query.unread === "true";
    const limit = Number(req.query.limit || 50);
    const items = await listForUser(req.user, { unread, limit });
    res.json({ items, unread_count: items.filter((x) => !x.read).length });
  } catch (e) { next(e); }
});

router.patch("/:id/read", async (req, res, next) => {
  try {
    const updated = await markRead(req.params.id);
    res.json({ item: updated });
  } catch (e) { next(e); }
});

router.post("/read-all", async (req, res, next) => {
  try {
    const n = await markAllReadForUser(req.user);
    res.json({ updated: n });
  } catch (e) { next(e); }
});

/** Configuration push ntfy pour l'utilisateur connecté (topic personnel secret). */
router.get("/push/setup", async (req, res) => {
  const setup = pushSetupForUser(req.user);
  res.json({
    ...setup,
    hint_fr: setup.enabled
      ? "Installez l'app ntfy (iOS/Android) ou ouvrez le lien d'abonnement. Vous ne recevrez que VOS alertes CRM (comme la cloche du site)."
      : "Push désactivé sur le serveur (NTFY_TOPIC_SECRET manquant).",
    hint_en: setup.enabled
      ? "Install the ntfy app and subscribe via the link below. You only receive YOUR CRM alerts."
      : "Push disabled on server (missing NTFY_TOPIC_SECRET).",
  });
});

router.get("/push/status", async (_req, res) => {
  res.json({ enabled: isNtfyEnabled() });
});

export default router;
