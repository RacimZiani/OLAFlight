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
import { extractRouteFromMessages, formatDestinationLabel } from "./airports.js";
import {
  extractTravelDatesFromMessages,
  getTodayContext,
  formatLeadDatesLabel,
} from "./travelDates.js";
import { getConversation } from "./conversation.js";

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

DATE DU JOUR (référence obligatoire — ne jamais proposer une date de voyage dans le passé) :
- Aujourd'hui : ${context.today?.labelFr || "—"} (${context.today?.iso || "—"})
- Si le client dit « août » ou « 15 août » sans année → utiliser ${context.today?.year || "l'année en cours"} (ou l'année suivante si le mois est déjà passé).
- Interdit d'utiliser 2024 ou une année passée sauf si le client l'a explicitement demandée pour un voyage futur impossible.

${context.confirmedTravel?.depart ? `
DATES CONFIRMÉES (ne jamais changer) :
- Départ : ${context.confirmedTravel.label || context.confirmedTravel.depart} (${context.confirmedTravel.depart})
${context.confirmedTravel.ret ? `- Retour : ${context.confirmedTravel.ret}` : "- Aller simple"}
- Passagers : ${context.confirmedTravel.passagers ?? "non précisé"}
Utilise EXACTEMENT ces dates pour scrape_flights (\`depart\` = ${context.confirmedTravel.depart}) et pour le champ \`dates\` du lead.
` : ""}
${context.confirmedRoute?.label ? `
ROUTE CONFIRMÉE PAR LE CLIENT (ne jamais changer) :
- Trajet : ${context.confirmedRoute.label}
- Codes IATA : ${context.confirmedRoute.from || "?"} → ${context.confirmedRoute.to || "?"}
- Aller simple : ${context.confirmedRoute.oneWay ? "oui" : "non précisé"}
Utilise EXACTEMENT ces aéroports pour scrape_flights et create_devis_from_offer. Ne remplace jamais par une autre ville (ex. New York si le client a dit Madrid).
` : ""}
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
function mergeMessageHistories(serverMsgs, clientMsgs, cap = 24) {
  const norm = (m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 2000),
  });
  const server = (serverMsgs || []).map(norm).filter((m) => m.content.trim());
  const client = (clientMsgs || []).map(norm).filter((m) => m.content.trim());
  if (!server.length) return client.slice(-cap);
  if (!client.length) return server.slice(-cap);

  const merged = [...server];
  const tail = client.slice(-6);
  const start = Math.max(0, client.length - tail.length);
  for (let i = 0; i < tail.length; i++) {
    const globalIdx = start + i;
    const srvIdx = server.length - tail.length + i;
    if (srvIdx >= 0 && srvIdx < server.length && server[srvIdx].content === tail[i].content) {
      continue;
    }
    if (globalIdx >= server.length) merged.push(tail[i]);
  }
  return merged.slice(-cap);
}

export async function runAgent({ messages, lang = "fr", context = {} }) {
  let history = messages || [];

  // Web : fusionner l'historique serveur (évite d'oublier Madrid après 12 msgs client-only).
  if (context.channel === "web" && context.contact) {
    try {
      const conv = await getConversation({ channel: "web", contact: context.contact });
      if (conv?.messages?.length) {
        history = mergeMessageHistories(conv.messages, history, 24);
      }
    } catch (e) {
      log.warn(`merge conversation history failed: ${e?.message || e}`);
    }
  }

  const trimmed = history
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000),
    }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-24);

  if (trimmed.length === 0) return { text: "", lead: null };

  const confirmedRoute = extractRouteFromMessages(trimmed);
  if (confirmedRoute.to || confirmedRoute.from) {
    confirmedRoute.label =
      confirmedRoute.label ||
      formatDestinationLabel({
        from: confirmedRoute.from,
        to: confirmedRoute.to,
        label: "",
      });
  }

  let leadDestination = "";
  if (context.lead_id) {
    try {
      const store = await getStore();
      const lead = await store.leads.findById(context.lead_id);
      leadDestination = lead?.destination || "";
      if (lead?.destination) {
        const fromLead = extractRouteFromMessages([
          { role: "user", content: lead.destination },
        ]);
        if (fromLead.to && !confirmedRoute.to) confirmedRoute.to = fromLead.to;
        if (fromLead.from && !confirmedRoute.from) confirmedRoute.from = fromLead.from;
      }
    } catch {
      /* best effort */
    }
  }

  const today = getTodayContext();
  const confirmedTravel = extractTravelDatesFromMessages(trimmed);
  if (confirmedTravel.depart) {
    confirmedTravel.datesLabel = formatLeadDatesLabel(confirmedTravel);
  }

  const agentContext = {
    ...context,
    today,
    confirmedRoute: confirmedRoute.to || confirmedRoute.from ? confirmedRoute : null,
    confirmedTravel: confirmedTravel.depart ? confirmedTravel : null,
    leadDestination,
  };

  // V1: tool-calling activé (scrape/devis/whatsapp). Si aucun tool n'est appelé,
  // le comportement reste équivalent à chatComplete().
  const { text } = await chatWithTools({
    system: buildSystem(lang, agentContext),
    messages: trimmed,
    tools: OLA_AGENT_TOOLS,
    onToolUse: async ({ id: _id, name, input }) => runOlaTool({ name, input }, { context: agentContext }),
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
