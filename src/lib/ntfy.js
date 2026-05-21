/**
 * Push mobile / desktop via ntfy.sh (ou serveur ntfy self-hosted).
 * Un topic secret par utilisateur — aligné sur les destinataires de la cloche CRM.
 */

import crypto from "node:crypto";
import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";
import { normalizeRole, ROLES } from "./roles.js";

const log = createLogger("ntfy");

export function isNtfyEnabled() {
  return Boolean(config.ntfy.enabled && config.ntfy.topicSecret.length >= 16);
}

function hmacTag(input) {
  return crypto
    .createHmac("sha256", config.ntfy.topicSecret)
    .update(String(input))
    .digest("hex")
    .slice(0, 12);
}

/** Topic personnel (secret — ne pas partager publiquement). */
export function topicForUserEmail(email) {
  const e = String(email || "").toLowerCase().trim();
  const slug = e
    .replace(/@/g, "-at-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
  const prefix = config.ntfy.topicPrefix;
  return `${prefix}-u-${slug}-${hmacTag(`user:${e}`)}`;
}

export function subscribeUrlForTopic(topic) {
  const base = config.ntfy.server.replace(/\/$/, "");
  return `${base}/${encodeURIComponent(topic)}`;
}

const PRIORITY_BY_TYPE = {
  lead_won: "urgent",
  lead_assigned: "high",
  chatbot_lead: "high",
  chatbot_devis: "high",
  devis_created: "default",
  lead_nego: "default",
  lead_lost: "low",
};

/**
 * Résout les topics ntfy = un push par personne concernée (comme la cloche CRM).
 */
export async function resolveNtfyTopics(recipients = []) {
  if (!isNtfyEnabled()) return [];

  const topics = new Set();
  const list = recipients?.length ? recipients : [{ role: "admin" }];

  let users = [];
  try {
    const store = await getStore();
    if (store.users?.list) users = await store.users.list();
  } catch {
    /* ignore */
  }

  const activeUsers = users.filter((u) => u && u.active !== false && u.email);

  for (const r of list) {
    if (r.email) {
      topics.add(topicForUserEmail(r.email));
      continue;
    }
    if (r.role) {
      const want = normalizeRole(r.role);
      for (const u of activeUsers) {
        if (normalizeRole(u.role) === want || u.role === r.role) {
          topics.add(topicForUserEmail(u.email));
        }
      }
    }
  }

  if (!topics.size && list.some((r) => r.role === "admin" || !r.email)) {
    for (const u of activeUsers) {
      if (normalizeRole(u.role) === ROLES.ADMIN) {
        topics.add(topicForUserEmail(u.email));
      }
    }
  }

  return [...topics];
}

/**
 * Envoie une notification push (best-effort, ne bloque pas le flux métier).
 */
export async function publishNtfy(topic, { title, body = "", type = "", lead_id = null }) {
  if (!isNtfyEnabled() || !topic || !title) return false;

  const base = config.ntfy.server.replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(topic)}`;

  const headers = {
    Title: String(title).slice(0, 250),
    Tags: ["olaflight", type || "notif"].filter(Boolean).join(","),
    Priority: PRIORITY_BY_TYPE[type] || "default",
  };

  if (lead_id && config.publicUrl) {
    const click = `${config.publicUrl.replace(/\/$/, "")}/crm.html`;
    headers.Click = click;
  }

  if (config.ntfy.token) {
    headers.Authorization = `Bearer ${config.ntfy.token}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: String(body || "").slice(0, 4000),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      log.warn(`ntfy ${res.status} ${topic}: ${txt.slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (e) {
    log.warn(`ntfy publish failed (${topic}): ${e?.message || e}`);
    return false;
  }
}

/** Push pour une notif CRM déjà ciblée. */
export async function pushNtfyForRecipients({
  recipients,
  type,
  title,
  body = "",
  lead_id = null,
}) {
  if (!isNtfyEnabled()) return { sent: 0, topics: [] };

  const topics = await resolveNtfyTopics(recipients);
  let sent = 0;
  for (const topic of topics) {
    const ok = await publishNtfy(topic, { title, body, type, lead_id });
    if (ok) sent++;
  }
  if (sent) log.info(`ntfy push ${sent}/${topics.length} · ${type}`);
  return { sent, topics };
}

export function pushSetupForUser(user) {
  const topic = topicForUserEmail(user?.email);
  const subscribe_url = subscribeUrlForTopic(topic);
  return {
    enabled: isNtfyEnabled(),
    server: config.ntfy.server,
    topic,
    subscribe_url,
    web_url: `${subscribe_url}?poll=1`,
    qr_url: `https://ntfy.sh/qr?url=${encodeURIComponent(subscribe_url)}`,
  };
}
