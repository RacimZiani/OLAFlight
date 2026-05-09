import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireRole, requireAdmin } from "../middleware/auth.js";
import { getStore } from "../db/index.js";
import { uid } from "../lib/ids.js";
import { HttpError } from "../middleware/errorHandler.js";

const router = Router();
// Le réseau apporteurs (et leurs commissions) est strictement réservé aux admins.
// Les closers ne le voient pas (S02 — isolation par rôle).
router.use(requireRole("admin", "dalsim"));

const createSchema = z.object({
  nom: z.string().min(1),
  instagram: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.union([z.string().email(), z.literal("")]).optional().nullable(),
  reseau: z.string().optional().nullable(),
  type_reseau: z.string().optional().nullable(),
  taille_reseau: z.string().optional().nullable(),
  taux_commission: z.coerce.number().min(0).max(100).optional().default(10),
  code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/", async (_req, res, next) => {
  try {
    const store = await getStore();
    const items = await store.apporteurs.list();
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.post("/", validate({ body: createSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const body = req.body;
    const code =
      body.code?.trim() ||
      `${body.nom.replace(/\s+/g, "").slice(0, 6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
    const row = await store.apporteurs.insert({
      id: uid(),
      nom: body.nom.trim(),
      instagram: body.instagram?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      reseau: body.reseau?.trim() || null,
      type_reseau: body.type_reseau?.trim() || null,
      taille_reseau: body.taille_reseau?.trim() || null,
      taux_commission: body.taux_commission ?? 10,
      code,
      notes: body.notes?.trim() || null,
    });
    res.json({ item: row });
  } catch (e) {
    next(e);
  }
});

const patchSchema = createSchema.partial();

router.patch("/:id", requireAdmin, validate({ body: patchSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const updated = await store.apporteurs.update(req.params.id, req.body);
    if (!updated) throw new HttpError(404, "Apporteur introuvable");
    res.json({ item: updated });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const store = await getStore();
    const n = await store.apporteurs.remove(req.params.id);
    res.json({ removed: n });
  } catch (e) {
    next(e);
  }
});

export default router;
