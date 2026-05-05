import { Router } from "express";
import { requireBackoffice } from "../middleware/auth.js";
import { getStore } from "../db/index.js";

const router = Router();

// Actions de l'agent IA (audit trail) — réservé back-office.
router.use(requireBackoffice);

router.get("/actions", async (req, res, next) => {
  try {
    const { lead_id, conversation_id, limit } = req.query || {};
    const lim = Math.max(1, Math.min(200, Number(limit || 50) || 50));
    const store = await getStore();

    let items = [];
    if (store.agent_actions?.list) {
      items = await store.agent_actions.list();
      if (lead_id) items = items.filter((x) => String(x.lead_id || "") === String(lead_id));
      if (conversation_id) items = items.filter((x) => String(x.conversation_id || "") === String(conversation_id));
      items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      items = items.slice(0, lim);
    } else {
      items = [];
    }

    res.json({ items });
  } catch (e) {
    next(e);
  }
});

export default router;

