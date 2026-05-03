import { config } from "../../config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("msg:instagram");

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function isConfigured() {
  return Boolean(config.instagram.token && config.instagram.pageId);
}

export async function send({ channel, to, text }) {
  if (!isConfigured()) throw new Error("Instagram non configuré (INSTAGRAM_TOKEN + INSTAGRAM_PAGE_ID).");
  if (!to) throw new Error("Instagram: recipient.id manquant");

  const url = `${GRAPH_BASE}/${config.instagram.pageId}/messages?access_token=${encodeURIComponent(config.instagram.token)}`;
  const body = {
    recipient: { id: String(to) },
    message: { text: String(text || "").slice(0, 1000) },
    messaging_type: "RESPONSE",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.error(`graph error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    throw new Error(`Instagram Graph ${res.status}: ${json?.error?.message || "unknown"}`);
  }
  log.info(`→ ig:${to}`);
  return { id: json.message_id || `ig-${Date.now()}` };
}

// Webhook entrant Meta IG : entry[*].messaging[*].
export function parseIncomingWebhook(payload) {
  const out = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const ev of events) {
      const text = ev.message?.text;
      if (!text) continue; // ignore reactions/postbacks pour la phase 1
      out.push({
        channel: "instagram",
        messageId: ev.message?.mid,
        from: ev.sender?.id,
        name: "",
        text: String(text || ""),
        timestamp: Number(ev.timestamp) || Date.now(),
      });
    }
  }
  return out;
}
