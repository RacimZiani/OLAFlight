/**
 * Accès public aux PDF devis + réponses client (accept / refuse / negotiate).
 */

import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "../db/index.js";
import { generateDevisPdf } from "../lib/pdf.js";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { verifyDevisDecisionToken } from "../lib/devisDecisionToken.js";
import { notify } from "../lib/notifBus.js";

const log = createLogger("public-pdf");
const router = Router();

const DECISION_STATUS = {
  accept: "won",
  refuse: "lost",
  negotiate: "nego",
};

const DECISION_NOTIF = {
  accept: "client_decision_accept",
  refuse: "client_decision_refuse",
  negotiate: "client_decision_negotiate",
};

function thankYouHtml(lang, action) {
  const fr = lang !== "en";
  const titles = {
    accept: fr ? "Merci — votre validation est enregistrée" : "Thank you — your confirmation is recorded",
    refuse: fr ? "Demande enregistrée" : "Request recorded",
    negotiate: fr ? "Nous vous recontactons" : "We will get back to you",
  };
  const bodies = {
    accept: fr
      ? "Un conseiller Ola Flight finalise votre réservation."
      : "An Ola Flight advisor will finalise your booking.",
    refuse: fr ? "Nous restons disponibles pour un prochain voyage." : "We remain available for a future trip.",
    negotiate: fr
      ? "Votre conseiller prépare une réponse adaptée sous 24 h."
      : "Your advisor will respond within 24 hours.",
  };
  return `<!DOCTYPE html><html lang="${fr ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ola Flight</title>
  <style>body{margin:0;background:#0a0a0a;color:#f8f5f0;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .box{max-width:480px;text-align:center;border:1px solid #333;padding:48px 32px;background:#111}
  p{color:#aaa;font-size:15px;line-height:1.7;font-family:Arial,sans-serif}</style></head>
  <body><div class="box"><h1 style="font-weight:300;font-size:26px;margin:0 0 16px">${titles[action] || titles.accept}</h1>
  <p>${bodies[action] || bodies.accept}</p></div></body></html>`;
}

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

router.get("/devis/:id/decision", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const action = String(req.query.action || "").toLowerCase();
    const token = String(req.query.token || "");

    if (!DECISION_STATUS[action]) {
      return res.status(400).type("text/plain").send("Action invalide.");
    }
    if (!verifyDevisDecisionToken(token, id, action)) {
      return res.status(403).type("text/plain").send("Lien expiré ou invalide.");
    }

    const store = await getStore();
    const devis = await store.devis.findById(id);
    if (!devis) return res.status(404).type("text/plain").send("Devis introuvable.");

    const lead = devis.lead_id ? await store.leads.findById(devis.lead_id) : null;
    const newStatus = DECISION_STATUS[action];

    if (lead?.id) {
      await store.leads.update(lead.id, { status: newStatus });
    }

    try {
      await store.devis.update(id, {
        client_decision: action,
        client_decision_at: Date.now(),
      });
    } catch {
      /* colonnes optionnelles */
    }

    const closerEmail = lead?.closer_name?.includes("@") ? lead.closer_name : null;
    const recipients = [{ role: "admin" }];
    if (closerEmail) recipients.push({ email: closerEmail });
    else if (lead?.closer_name) recipients.push({ role: "closer" });

    const actionLabel =
      action === "accept" ? "Accepté" : action === "refuse" ? "Refusé" : "Négociation";

    await notify({
      recipients,
      type: DECISION_NOTIF[action],
      title: `Client ${actionLabel} — ${lead?.client_name || devis.id}`,
      body: `${lead?.destination || ""} · Devis ${devis.id}`,
      lead_id: lead?.id || null,
      devis_id: devis.id,
      meta: { decision: action },
    });

    const lang = lead?.lang === "en" ? "en" : "fr";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(thankYouHtml(lang, action));
  } catch (e) {
    next(e);
  }
});

export default router;
