/**
 * Accès public aux PDF devis (chat web, clients non connectés) — sans auth.
 * UUID / id devis = secret implicite (V1).
 */

import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "../db/index.js";
import { generateDevisPdf } from "../lib/pdf.js";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("public-pdf");
const router = Router();

router.get("/devis/:id/pdf", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).send("Identifiant devis manquant");

    const store = await getStore();
    const devis = await store.devis.findById(id);
    if (!devis) {
      return res.status(404).type("text/plain").send("Devis introuvable ou expiré.");
    }

    const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;
    const filename = `devis-${devis.id}.pdf`;
    let absolutePath = path.join(config.pdf.outDir, filename);

    try {
      await fs.access(absolutePath);
    } catch {
      log.info(`pdf manquant sur disque, régénération → ${id}`);
      const generated = await generateDevisPdf({ devis, lead });
      absolutePath = generated.absolutePath;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.sendFile(path.resolve(absolutePath));
  } catch (e) {
    next(e);
  }
});

export default router;
