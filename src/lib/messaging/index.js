// ─────────────────────────────────────────────────────────────────────────
// Outbound messaging — interface unique pour WhatsApp, Instagram et fallback.
// Toute partie du code (notif Dalsim, agent IA, devis…) appelle sendMessage()
// et n'a pas à savoir quel canal/adapter est utilisé.
//
// Si le canal demandé n'est pas configuré → fallback console (log + outbox.json).
// ─────────────────────────────────────────────────────────────────────────

import { config } from "../../config.js";
import { createLogger } from "../../logger.js";
import * as wa from "./whatsapp.js";
import * as ig from "./instagram.js";
import * as fallback from "./console.js";

const log = createLogger("msg");

const ADAPTERS = {
  whatsapp: wa,
  instagram: ig,
  console: fallback,
};

function pickAdapter(channel) {
  if (channel === "whatsapp" && config.whatsapp.token && config.whatsapp.phoneNumberId) return wa;
  if (channel === "instagram" && config.instagram.token && config.instagram.pageId) return ig;
  return fallback;
}

/**
 * @param {object} args
 * @param {"whatsapp"|"instagram"} args.channel
 * @param {string} args.to             - phone E.164 (sans +) ou IG sender id
 * @param {string} args.text
 * @param {Array<{type:"document"|"image", url:string, filename?:string, caption?:string}>} [args.attachments]
 */
export async function sendMessage({ channel, to, text, attachments }) {
  if (!channel) throw new Error("sendMessage: channel manquant");
  if (!to) throw new Error("sendMessage: 'to' manquant");
  const adapter = pickAdapter(channel);
  try {
    return await adapter.send({ channel, to, text, attachments });
  } catch (err) {
    // Erreur réelle d'API Meta → on tombe en fallback pour ne pas bloquer le flow.
    log.error(`send ${channel} → ${to} a échoué (${err.message}) — fallback console`);
    return fallback.send({ channel, to, text, attachments });
  }
}

export { wa, ig, fallback };
