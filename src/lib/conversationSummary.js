// Génère un résumé court de la dernière conversation client → agent
// pour la fiche lead du CRM. Reconstruit l'historique depuis :
//   1) la collection `conversations_ola` (par lead_id),
//   2) à défaut, les `agent_actions` du lead (best-effort).

import { getStore } from "../db/index.js";
import { chatComplete } from "./anthropic.js";
import { createLogger } from "../logger.js";

const log = createLogger("conv:summary");

const SYSTEM = `Tu es un analyste commercial. Tu reçois la dernière conversation entre un client et l'agent IA Ola Flight (conciergerie de voyages premium). Produis un résumé EN FRANÇAIS, factuel et actionnable, en 4 puces maximum, format Markdown :

• Où en est-on ? (statut implicite : qualif / devis envoyé / négociation / accepté / perdu)
• Ce que veut le client (destination, dates, classe, contraintes, points sensibles)
• Dernière objection ou question ouverte (si pertinent)
• Action recommandée pour le closer (1 phrase max, concrète)

Pas d'introduction, pas de conclusion. Pas de "Bien sûr, voici…". Sois sec et concret.`;

function tsOf(x) {
  if (!x) return 0;
  if (typeof x === "number") return x;
  return Date.parse(x) || 0;
}

async function findConversationForLead(leadId) {
  const store = await getStore();
  const col = store.conversations_ola;
  if (!col?.list) return null;
  const all = await col.list().catch(() => []);
  return all.find((c) => String(c.lead_id || "") === String(leadId)) || null;
}

async function listAgentActionsForLead(leadId) {
  const store = await getStore();
  if (!store.agent_actions?.list) return [];
  const all = await store.agent_actions.list().catch(() => []);
  return all
    .filter((a) => String(a.lead_id || "") === String(leadId))
    .sort((a, b) => tsOf(a.created_at) - tsOf(b.created_at));
}

function reconstructTranscript({ conv, actions, lead }) {
  // Cas 1 : on a la conversation web (messages persistés). C'est la source idéale.
  if (conv && Array.isArray(conv.messages) && conv.messages.length) {
    return conv.messages
      .slice(-20)
      .map((m) => {
        const who = m.role === "assistant" ? "Agent" : "Client";
        return `[${who}] ${String(m.content || "").slice(0, 600)}`;
      })
      .join("\n");
  }
  // Cas 2 : reconstitution best-effort depuis les agent_actions et le lead.
  const lines = [];
  if (lead) {
    lines.push(
      `[Contexte] ${lead.client_name || "Client"} · ${lead.destination || "—"} · ${lead.dates || "dates non précisées"} · ${lead.classe || "classe non précisée"} · ${lead.passagers || 1} pax · statut "${lead.status}"`
    );
    if (lead.notes) lines.push(`[Notes lead] ${String(lead.notes).slice(0, 600)}`);
  }
  for (const a of actions || []) {
    if (a.action === "scrape_flights") {
      const out = a.output || {};
      const offers = Array.isArray(out.offers) ? out.offers : [];
      lines.push(`[Agent] scraping ${offers.length} options trouvées`);
    } else if (a.action === "create_devis_from_offer") {
      const out = a.output || {};
      lines.push(
        `[Agent] devis ${out.devis_id || ""} envoyé · ${out.options_count || 1} option(s) · ${out.prix_vente || "?"} €`
      );
    } else if (a.action === "upsert_lead") {
      const inp = a.input || {};
      if (inp.status) lines.push(`[Agent] lead → ${inp.status}`);
      if (inp.notes) lines.push(`[Notes] ${String(inp.notes).slice(0, 400)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Calcule un résumé pour le lead.
 *
 * @param {string} leadId
 * @returns {Promise<{summary:string, source:string, has_conv:boolean, last_message_at:number|null}>}
 */
export async function summarizeLeadConversation(leadId) {
  const store = await getStore();
  const lead = await store.leads.findById(leadId).catch(() => null);
  if (!lead) {
    return { summary: "", source: "none", has_conv: false, last_message_at: null };
  }
  const conv = await findConversationForLead(leadId);
  const actions = await listAgentActionsForLead(leadId);

  const lastConvTs = conv?.messages?.length
    ? tsOf(conv.messages[conv.messages.length - 1].ts || conv.updated_at)
    : 0;
  const lastActionTs = actions.length
    ? tsOf(actions[actions.length - 1].created_at)
    : 0;
  const last_message_at = Math.max(lastConvTs, lastActionTs) || null;

  if (!conv && actions.length === 0) {
    return {
      summary: "_Aucun échange enregistré pour ce lead — pas encore de conversation web ou d'action agent._",
      source: "empty",
      has_conv: false,
      last_message_at,
    };
  }

  const transcript = reconstructTranscript({ conv, actions, lead });
  if (!transcript.trim()) {
    return {
      summary: "_Pas de transcript exploitable._",
      source: "empty",
      has_conv: Boolean(conv),
      last_message_at,
    };
  }

  // Anthropic peut être indisponible (pas de clé). Dans ce cas, on retourne
  // simplement le transcript brut tronqué — utile pour le closer.
  try {
    const { text } = await chatComplete({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Conversation à résumer :\n\n${transcript.slice(-6000)}`,
        },
      ],
      maxTokens: 350,
    });
    return {
      summary: text.trim() || "_(résumé vide)_",
      source: conv ? "conversation" : "actions",
      has_conv: Boolean(conv),
      last_message_at,
    };
  } catch (e) {
    log.warn(`anthropic summary failed: ${e?.message || e}`);
    return {
      summary: "_(impossible de générer un résumé IA pour le moment, transcript brut ci-dessous)_\n\n```\n" + transcript.slice(-2000) + "\n```",
      source: conv ? "conversation_raw" : "actions_raw",
      has_conv: Boolean(conv),
      last_message_at,
    };
  }
}
