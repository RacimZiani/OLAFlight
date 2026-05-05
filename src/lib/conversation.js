// Mémoire de conversation côté serveur — clé : `${canal}:${contact}`.
// Pour le webhook chatbot, le client (WA/IG) ne nous renvoie que le dernier
// message → on doit reconstruire l'historique nous-mêmes.
//
// Stockage : collection `conversations_ola` (jsonStore ou Supabase plus tard).
// Schéma : { id, key, lead_id?, channel, contact, lang, messages: [{role, content, ts}], created_at, updated_at }

import { getStore } from "../db/index.js";
import { uid } from "./ids.js";
import { config } from "../config.js";

function makeKey(channel, contact) {
  return `${channel}:${String(contact || "").toLowerCase()}`;
}

async function getConversationsCollection() {
  const store = await getStore();
  // jsonStore expose `conversations_ola` quand il a été initialisé ;
  // si l'adapter l'oublie, on dégrade vers leads (interface compatible).
  return store.conversations_ola || store.conversations || null;
}

async function listAllByKey(key) {
  const col = await getConversationsCollection();
  if (!col) return null;
  // Si l'adapter supporte findByField (Supabase), on évite de lister tout.
  if (col.findByField) {
    try {
      return (await col.findByField("key", key)) || null;
    } catch {
      // fallback ci-dessous
    }
  }
  const items = await col.list();
  return items.find((c) => c.key === key) || null;
}

/**
 * Récupère ou crée la conversation pour {channel, contact}.
 * `seed` peut renseigner lead_id, lang, name à la création.
 */
export async function ensureConversation({ channel, contact, lang = "fr", lead_id = null, name = "" }) {
  const col = await getConversationsCollection();
  const key = makeKey(channel, contact);
  if (!col) {
    // pas de collection conversations → fallback minimal en mémoire process
    return { id: `mem-${key}`, key, channel, contact, lang, lead_id, name, messages: [] };
  }
  const existing = await listAllByKey(key);
  if (existing) return existing;
  const now = Date.now();
  const isSupabase = config.storage.driver === "supabase";
  const conv = {
    ...(isSupabase ? {} : { id: uid() }),
    key,
    channel,
    contact: String(contact || ""),
    name,
    lang,
    lead_id,
    messages: [],
  };
  const inserted = await col.insert(conv);
  return { ...conv, id: inserted?.id || conv.id };
}

export async function appendMessage({ channel, contact, role, content }) {
  const col = await getConversationsCollection();
  const key = makeKey(channel, contact);
  const conv = await listAllByKey(key);
  if (!conv) return null;
  const msg = { role, content: String(content || ""), ts: Date.now() };
  const next = [...(conv.messages || []), msg].slice(-30); // borné pour la mémoire
  if (col?.update) {
    return col.update(conv.id, { messages: next });
  }
  conv.messages = next;
  return conv;
}

export async function setConversationLeadId({ channel, contact, lead_id }) {
  const col = await getConversationsCollection();
  const key = makeKey(channel, contact);
  const conv = await listAllByKey(key);
  if (!conv) return null;
  return col.update(conv.id, { lead_id });
}

export async function getConversation({ channel, contact }) {
  return listAllByKey(makeKey(channel, contact));
}
