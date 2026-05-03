// Client Calendly v2 minimal (one-off scheduling links).
// Doc : https://developers.calendly.com/api-docs/
//
// Stratégie phase 1 : on utilise un lien personnel statique (CALENDLY_LINK)
// qu'on envoie au client. Quand un budget Calendly Pro est dispo, on bascule
// sur la création dynamique (single_use_scheduling_links) pour tracker chaque
// lead. La fonction createBookingLink() encapsule les deux modes.

import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("calendly");

const API_BASE = "https://api.calendly.com";

function isApiConfigured() {
  return Boolean(config.calendly.token && config.calendly.eventTypeUri);
}

async function calendlyFetch(pathSeg, init = {}) {
  const res = await fetch(`${API_BASE}${pathSeg}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.calendly.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Calendly ${res.status}: ${json?.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/**
 * Retourne un lien de booking pour le lead.
 * - Si Calendly API configuré → crée un single_use_scheduling_link (max_event_count=1).
 * - Sinon → retourne CALENDLY_LINK (lien personnel statique).
 */
export async function createBookingLink({ lead }) {
  if (!isApiConfigured()) {
    if (config.calendly.fallbackLink) {
      log.debug(`fallback link → ${config.calendly.fallbackLink}`);
      return { url: config.calendly.fallbackLink, single_use: false };
    }
    log.warn("Calendly non configuré (CALENDLY_TOKEN + CALENDLY_EVENT_TYPE_URI ou CALENDLY_LINK)");
    return null;
  }
  try {
    const json = await calendlyFetch("/scheduling_links", {
      method: "POST",
      body: JSON.stringify({
        max_event_count: 1,
        owner: config.calendly.eventTypeUri,
        owner_type: "EventType",
      }),
    });
    const url = json?.resource?.booking_url;
    if (!url) throw new Error("Réponse Calendly sans booking_url");
    log.info(`single-use link créé pour ${lead?.client_name || "lead"}`);
    return { url, single_use: true };
  } catch (e) {
    log.error(`création lien échouée: ${e.message} — fallback vers lien statique`);
    return config.calendly.fallbackLink
      ? { url: config.calendly.fallbackLink, single_use: false }
      : null;
  }
}

// Parse webhook Calendly invitee.created → infos pour update lead.
export function parseCalendlyWebhook(payload) {
  if (!payload?.event || !payload?.payload) return null;
  if (payload.event !== "invitee.created") return null;
  const p = payload.payload;
  return {
    event: payload.event,
    invitee_email: p?.email || null,
    invitee_name: p?.name || null,
    event_uri: p?.event || null,
    scheduled_at: p?.scheduled_event?.start_time || null,
    cancel_url: p?.cancel_url || null,
    reschedule_url: p?.reschedule_url || null,
  };
}
