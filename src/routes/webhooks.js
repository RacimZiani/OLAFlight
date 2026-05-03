import { Router } from "express";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { runAgent } from "../lib/agentRunner.js";
import { sendMessage } from "../lib/messaging/index.js";
import { parseIncomingWebhook as parseWA } from "../lib/messaging/whatsapp.js";
import { parseIncomingWebhook as parseIG } from "../lib/messaging/instagram.js";
import { verifyMetaSignature } from "../lib/webhookSignature.js";
import { ensureConversation, appendMessage, getConversation } from "../lib/conversation.js";
import { parseCalendlyWebhook } from "../lib/calendly.js";
import { notifyCloserOfBookedLead } from "../lib/notifications.js";
import { getStore } from "../db/index.js";
import { detectLang } from "../lib/lang.js";

const log = createLogger("webhooks");
const router = Router();

// ─────────────────────────────────────────────────────────────────────
// Meta webhooks (WhatsApp + Instagram) — share verify (GET) + receive (POST).
//
// Convention Meta :
//   GET  /api/webhooks/{wa|ig}?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   POST /api/webhooks/{wa|ig}  (avec X-Hub-Signature-256)
// ─────────────────────────────────────────────────────────────────────

function makeVerifyHandler(verifyToken) {
  return (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === verifyToken && verifyToken) {
      log.info(`webhook verified (token OK)`);
      return res.status(200).send(String(challenge || ""));
    }
    log.warn("webhook verification refused (token mismatch)");
    return res.sendStatus(403);
  };
}

function checkSignature(req, res) {
  const sig = req.header("X-Hub-Signature-256");
  const secret = config.meta.appSecret;
  if (!secret) {
    log.warn("META_APP_SECRET absent — signature check désactivé (dev only)");
    return true; // en dev, on laisse passer pour pouvoir tester avec curl
  }
  const ok = verifyMetaSignature({
    rawBody: req.rawBody || JSON.stringify(req.body || {}),
    signatureHeader: sig,
    secret,
  });
  if (!ok) {
    log.warn("signature webhook invalide → 401");
    res.sendStatus(401);
    return false;
  }
  return true;
}

async function handleIncoming({ channel, message }) {
  const { from, text, name, messageId } = message;
  if (!from || !text) return null;

  // 1. Persiste conversation (création si pas encore là).
  const lang = detectLang(text);
  await ensureConversation({ channel, contact: from, lang, name });
  await appendMessage({ channel, contact: from, role: "user", content: text });

  // 2. Récupère l'historique pour Claude.
  const conv = await getConversation({ channel, contact: from });
  const messages = (conv?.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 3. Run agent.
  const { text: reply, lead } = await runAgent({
    messages,
    lang,
    context: { channel, contact: from, name },
  });

  // 4. Persist reply + envoie au client.
  await appendMessage({ channel, contact: from, role: "assistant", content: reply });

  if (reply && reply.trim()) {
    try {
      await sendMessage({ channel, to: from, text: reply });
    } catch (e) {
      log.error(`reply ${channel}/${from}: ${e.message}`);
    }
  }

  return { messageId, lead };
}

// ─── WhatsApp ──────────────────────────────────────────
router.get("/whatsapp", makeVerifyHandler(config.meta.verifyToken));
router.post("/whatsapp", async (req, res, next) => {
  if (!checkSignature(req, res)) return; // 401 already sent
  try {
    const messages = parseWA(req.body || {});
    res.sendStatus(200); // ack rapide à Meta (≤ 5s)
    for (const m of messages) await handleIncoming({ channel: "whatsapp", message: m });
  } catch (e) { next(e); }
});

// ─── Instagram ─────────────────────────────────────────
router.get("/instagram", makeVerifyHandler(config.meta.verifyToken));
router.post("/instagram", async (req, res, next) => {
  if (!checkSignature(req, res)) return;
  try {
    const messages = parseIG(req.body || {});
    res.sendStatus(200);
    for (const m of messages) await handleIncoming({ channel: "instagram", message: m });
  } catch (e) { next(e); }
});

// ─── Calendly ──────────────────────────────────────────
// Quand un client book le call → on update le lead → notif closeuse.
router.post("/calendly", async (req, res, next) => {
  try {
    res.sendStatus(200); // ack rapide
    const event = parseCalendlyWebhook(req.body || {});
    if (!event) return;
    log.info(`calendly ${event.event} → ${event.invitee_email || "?"}`);

    const store = await getStore();
    const leads = await store.leads.list();
    // Match très simple : on cherche un lead avec calendly_link ou client_contact = email.
    const lead = leads.find(
      (l) =>
        (l.client_contact && event.invitee_email && l.client_contact.toLowerCase() === event.invitee_email.toLowerCase()) ||
        (l.calendly_link && event.event_uri && l.calendly_link.includes(event.event_uri))
    );
    if (!lead) {
      log.warn(`calendly invitee non rattaché à un lead (${event.invitee_email || "?"})`);
      return;
    }

    await store.leads.update(lead.id, {
      status: "call_booked",
      next_followup: event.scheduled_at,
    });

    // Devis lié (si déjà créé) — pour enrichir le brief.
    const devisItems = await store.devis.list();
    const devis = devisItems.find((d) => d.lead_id === lead.id) || null;

    await notifyCloserOfBookedLead({
      lead,
      devis,
      calendlyLink: lead.calendly_link,
    });
  } catch (e) { next(e); }
});

export default router;
