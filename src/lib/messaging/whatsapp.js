import { config } from "../../config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("msg:whatsapp");

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function isConfigured() {
  return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
}

async function postGraph(pathSeg, body) {
  const res = await fetch(`${GRAPH_BASE}/${pathSeg}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.error(`graph error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    throw new Error(`WhatsApp Cloud API ${res.status}: ${json?.error?.message || "unknown"}`);
  }
  return json;
}

/**
 * Envoie un message texte (et optionnellement un document/image en première étape).
 * Format `to` : E.164 sans le "+" — ex "33612345678".
 */
export async function send({ channel, to, text, attachments = [] }) {
  if (!isConfigured()) throw new Error("WhatsApp non configuré (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID).");

  const pid = config.whatsapp.phoneNumberId;
  const cleanTo = String(to || "").replace(/^\+/, "").replace(/\D/g, "");
  if (!cleanTo) throw new Error(`WhatsApp: destinataire invalide (${to})`);

  const sent = [];

  // 1) Pièces jointes (PDF, image) — chacune comme message séparé.
  for (const att of attachments) {
    const type = att.type === "image" ? "image" : "document";
    const link = att.url;
    if (!link) continue;
    const payload = {
      messaging_product: "whatsapp",
      to: cleanTo,
      type,
      [type]: { link, ...(att.filename ? { filename: att.filename } : {}), ...(att.caption ? { caption: att.caption } : {}) },
    };
    const r = await postGraph(`${pid}/messages`, payload);
    sent.push({ id: r.messages?.[0]?.id, type });
  }

  // 2) Texte.
  if (text && text.trim()) {
    const payload = {
      messaging_product: "whatsapp",
      to: cleanTo,
      type: "text",
      text: { preview_url: false, body: String(text).slice(0, 4096) },
    };
    const r = await postGraph(`${pid}/messages`, payload);
    sent.push({ id: r.messages?.[0]?.id, type: "text" });
  }

  log.info(`→ ${cleanTo} (${sent.length} msg)`);
  return { id: sent.map((s) => s.id).filter(Boolean).join(","), parts: sent };
}

// Parse un payload webhook entrant Meta WhatsApp Business → liste de
// messages normalisés `{ from, text, name, timestamp }`.
export function parseIncomingWebhook(payload) {
  const out = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      const value = ch.value || {};
      const contacts = value.contacts || [];
      const contactName = contacts[0]?.profile?.name || "";
      const messages = value.messages || [];
      for (const m of messages) {
        if (m.type !== "text" || !m.text?.body) continue;
        out.push({
          channel: "whatsapp",
          messageId: m.id,
          from: m.from, // E.164 sans "+"
          name: contactName,
          text: String(m.text.body || ""),
          timestamp: Number(m.timestamp) * 1000 || Date.now(),
        });
      }
    }
  }
  return out;
}
