import { Router } from "express";
import { requireBackoffice } from "../middleware/auth.js";
import { listForUser, markRead, markAllReadForUser } from "../lib/notifBus.js";

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

export default router;
