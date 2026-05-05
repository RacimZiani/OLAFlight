import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";
import { uid } from "./ids.js";
import { ensureConversation } from "./conversation.js";
import { config } from "../config.js";

const log = createLogger("agent:audit");

function safeJson(v) {
  try {
    return v == null ? null : JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

/**
 * Enregistre une action (tool-call) pour audit CRM.
 * - Primary: table/collection agent_actions (SQLite / Supabase si table existe)
 * - Fallback: append dans conversations_ola.messages sous forme d'event
 */
export async function logAgentAction({
  actor = "agent",
  channel = "web",
  conversation_id = null,
  lead_id = null,
  action,
  status = "ok",
  input = null,
  output = null,
  error = null,
  context = {},
}) {
  const store = await getStore();
  const isSupabase = config.storage.driver === "supabase";
  const now = Date.now();
  const row = {
    // Supabase: id est uuid (default gen_random_uuid) → on laisse la DB générer.
    ...(isSupabase ? {} : { id: uid() }),
    actor,
    channel,
    conversation_id,
    lead_id,
    action: String(action || ""),
    status,
    input: safeJson(input),
    output: safeJson(output),
    error: error ? String(error).slice(0, 4000) : null,
    // SQLite: INTEGER ms. Supabase: timestamptz. On envoie un format compatible.
    created_at: isSupabase ? new Date(now).toISOString() : now,
    updated_at: isSupabase ? new Date(now).toISOString() : now,
  };

  // 1) Preferred: agent_actions collection
  try {
    if (store.agent_actions?.insert) {
      await store.agent_actions.insert(row);
      return { stored: "agent_actions", id: row.id };
    }
  } catch (e) {
    // Table non créée (Supabase) ou autre erreur : on fallback.
    log.warn(`agent_actions insert failed: ${e?.message || e}`);
  }

  // 2) Fallback: embed as event in conversation messages
  try {
    if (context?.contact) {
      const conv = await ensureConversation({
        channel: context.channel || "web",
        contact: context.contact,
        lang: context.lang || "fr",
        lead_id: lead_id || context.lead_id || null,
        name: context.name || "",
      });
      const col = store.conversations_ola;
      if (col?.update && conv?.id) {
        const next = [
          ...(Array.isArray(conv.messages) ? conv.messages : []),
          {
            role: "event",
            ts: Date.now(),
            type: "agent_action",
            ...row,
          },
        ].slice(-80);
        await col.update(conv.id, { messages: next });
        return { stored: "conversation_event", id: row.id };
      }
    }
  } catch (e) {
    log.warn(`conversation fallback failed: ${e?.message || e}`);
  }

  return { stored: "none", id: row.id };
}

