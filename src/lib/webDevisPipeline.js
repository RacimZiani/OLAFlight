/**
 * Pipeline web après formulaire contact : lead + brouillon devis (2 options vides)
 * → notification admin pour saisie des tarifs → message client (devis par email).
 * Pas de scrape ni de prix automatiques (évite hallucinations).
 */

import { createLogger } from "../logger.js";
import { runOlaTool } from "./olaAgentTools.js";
import {
  extractRouteFromMessages,
  formatDestinationLabel,
} from "./airports.js";
import {
  extractTravelDatesFromMessages,
  formatLeadDatesLabel,
} from "./travelDates.js";
import {
  extractContactFromMessages,
  isContactFormUserMessage,
} from "./contactFormUi.js";
import { extractLeadHintsFromMessages } from "./leadEnrichment.js";
import { getStore } from "../db/index.js";
import { createDraftDevisForLead } from "./draftDevis.js";

const log = createLogger("web-devis");

function clientEmailConfirmationMessage({ contact, lang }) {
  const name = contact?.client_name?.split(" ")[0] || "";
  const reach = contact?.email || contact?.phone || contact?.client_contact || "";
  if (lang === "en") {
    return (
      `Thank you${name ? `, ${name}` : ""}. Your request has been registered.` +
      ` Our team is preparing your personalised comparison with two airline options` +
      (reach ? ` — you will receive your quote by email at ${reach} within 24 hours` : " — you will receive your quote by email within 24 hours") +
      `. No prices are shown here in the chat: your advisor validates each fare before sending.`
    );
  }
  return (
    `Merci${name ? ` ${name}` : ""}, votre demande est bien enregistrée.` +
    ` Notre équipe prépare votre comparatif sur deux compagnies` +
    (reach ? ` — vous recevrez votre devis par email à ${reach} sous 24 h` : " — vous recevrez votre devis par email sous 24 h") +
    `. Aucun tarif n'est affiché ici dans le chat : chaque proposition est validée par un conseiller avant envoi.`
  );
}

/**
 * @returns {Promise<{ text: string|null, lead_id: string|null, devis_id: string|null }>}
 */
export async function runWebDevisPipeline({ messages, context, lang = "fr" }) {
  const lastUser = [...(messages || [])].reverse().find((m) => m.role === "user");
  if (!lastUser || !isContactFormUserMessage(lastUser.content)) {
    return { text: null, lead_id: null, devis_id: null };
  }

  const route = extractRouteFromMessages(messages);
  const travel = extractTravelDatesFromMessages(messages);
  const contact = extractContactFromMessages(messages);
  const hints = extractLeadHintsFromMessages(messages);

  if (!route.from || !route.to) {
    log.warn("web devis pipeline: route incomplete");
    return { text: null, lead_id: null, devis_id: null };
  }
  if (!travel.depart) {
    log.warn("web devis pipeline: no depart date");
    return { text: null, lead_id: null, devis_id: null };
  }
  if (!contact?.client_name) {
    log.warn("web devis pipeline: no contact identity");
    return { text: null, lead_id: null, devis_id: null };
  }

  const ctx = {
    ...context,
    channel: "web",
    lang,
    conversationMessages: messages,
    confirmedRoute: route,
    confirmedTravel: travel,
    leadClasse: hints.classe || "",
  };

  const destination = formatDestinationLabel(route);
  const datesLabel = formatLeadDatesLabel(travel);

  try {
    const leadOut = await runOlaTool(
      {
        name: "upsert_lead",
        input: {
          id: ctx.lead_id || undefined,
          client_name: contact.client_name,
          client_contact: contact.client_contact,
          client_type: hints.client_type || "particulier",
          classe: hints.classe || "Business",
          passagers: hints.passagers || travel.passagers || 1,
          needs_hotel: hints.needs_hotel ?? false,
          needs_driver: hints.needs_driver ?? false,
          hotel_preference: hints.hotel_preference || undefined,
          driver_pickup: hints.driver_pickup || undefined,
          driver_dropoff: hints.driver_dropoff || undefined,
          destination,
          dates: datesLabel,
          status: "devis_pending",
          notes: "Demande web — tarifs à saisir par admin (2 compagnies).",
          extras_notes:
            hints.needs_driver === true
              ? "Chauffeur privé souhaité — trajets à préciser."
              : undefined,
        },
      },
      { context: ctx }
    );
    if (leadOut?.lead_id) ctx.lead_id = leadOut.lead_id;

    const store = await getStore();
    const lead = await store.leads.findById(ctx.lead_id);
    if (!lead) {
      return { text: null, lead_id: ctx.lead_id, devis_id: null };
    }

    const draft = await createDraftDevisForLead(lead, ctx);

    return {
      text: clientEmailConfirmationMessage({ contact, lang }),
      lead_id: lead.id,
      devis_id: draft.id,
    };
  } catch (e) {
    log.error(`web devis pipeline failed: ${e?.message || e}`);
    return { text: null, lead_id: ctx.lead_id || null, devis_id: null };
  }
}
