// Runner unifié de l'agent IA : appelle Claude avec le system prompt Ola Flight,
// gère l'extraction de lead quand les 4 infos sont collectées, persiste, et
// déclenche la notification Dalsim. Utilisable depuis :
//   - POST /api/chat (web)
//   - webhooks WhatsApp / Instagram

import { chatComplete, chatWithTools } from "./anthropic.js";
import { OLA_SYSTEM_PROMPT, LEAD_TRIGGER_PATTERN } from "./prompt.js";
import { extractLeadFromConversation } from "./leadExtractor.js";
import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";
import { notifyDalsimOfNewLead } from "./notifications.js";
import { OLA_AGENT_TOOLS, runOlaTool } from "./olaAgentTools.js";

const log = createLogger("agent");

function buildSystem(lang, context = {}) {
  const channel = context?.channel || "web";
  return `${OLA_SYSTEM_PROMPT}

═══════════════════════════════════════
MODE AGENT AUTONOME (WEB / OPS)
═══════════════════════════════════════
Tu as accès à des outils internes pour agir au lieu de promettre :
- scrape_flights : récupère des prix publics réels (sources web) pour proposer des options.
- create_devis_from_offer : crée un devis interne Ola Flight (et PDF optionnel).
- handoff_whatsapp : si le client est très intéressé, bascule vers WhatsApp (lien ou message).

Règles de sécurité supplémentaires :
- Tu peux communiquer des PRIX PUBLICS issus du scraping (indicatifs), mais tu ne révèles jamais de prix_revient, marge, commissions.
- Tu ne “fabriques” jamais un billet : tu proposes des options + un devis PDF Ola Flight pour finaliser.
- Si un outil échoue, tu l’expliques brièvement et tu proposes une alternative (autres dates, autre aéroport, ou passage WhatsApp).

Canal actuel: ${channel}.

Règle additionnelle : réponds en ${
    lang === "en" ? "anglais" : "français"
  } (langue UI), sauf si l'utilisateur écrit clairement dans l'autre langue.`;
}

/**
 * Reçoit un historique [{role,content}], appelle Claude, applique le post-processing
 * (extraction lead + notif Dalsim si trigger). Retourne `{ text, lead }`.
 *
 * @param {object} args
 * @param {Array<{role:string,content:string}>} args.messages
 * @param {"fr"|"en"} [args.lang="fr"]
 * @param {object} [args.context]  - { channel, contact, name } pour persistance
 */
export async function runAgent({ messages, lang = "fr", context = {} }) {
  const trimmed = (messages || [])
    .slice(-12)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000),
    }))
    .filter((m) => m.content.trim().length > 0);

  if (trimmed.length === 0) return { text: "", lead: null };

  // V1: tool-calling activé (scrape/devis/whatsapp). Si aucun tool n'est appelé,
  // le comportement reste équivalent à chatComplete().
  const { text } = await chatWithTools({
    system: buildSystem(lang, context),
    messages: trimmed,
    tools: OLA_AGENT_TOOLS,
    onToolUse: async ({ id: _id, name, input }) => runOlaTool({ name, input }, { context }),
  });

  let leadCreated = null;
  if (LEAD_TRIGGER_PATTERN.test(text)) {
    try {
      const lead = await extractLeadFromConversation(trimmed);
      if (lead) {
        // Si on a un contact webhook, on le rattache au lead.
        if (context.contact) lead.client_contact = lead.client_contact || context.contact;
        if (context.channel) lead.canal = lead.canal || (context.channel === "instagram" ? "instagram" : "whatsapp");
        if (context.name) lead.client_name = lead.client_name === "Lead WhatsApp" ? context.name : lead.client_name;
        const store = await getStore();
        await store.leads.insert(lead);
        leadCreated = lead;
        log.info(`lead créé via agent → ${lead.client_name} · ${lead.destination} · ${lead.canal}`);
        // Hook : notif Dalsim (silencieuse si non configurée).
        notifyDalsimOfNewLead(lead).catch((e) =>
          log.warn(`notif dalsim a échoué: ${e.message}`)
        );
      }
    } catch (err) {
      log.error(`extraction/persist lead: ${err?.message || err}`);
    }
  }

  return { text, lead: leadCreated };
}
