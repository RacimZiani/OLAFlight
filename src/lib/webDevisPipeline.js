/**
 * Pipeline serveur après formulaire contact (web) : upsert → scrape → devis.
 * Garantit que le client reçoit les options dans le chat (pas un faux email).
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

const log = createLogger("web-devis");

function buildScrapeOptions(scrapeOut) {
  const offers = scrapeOut?.offers || [];
  const hints = scrapeOut?.price_hints;
  const labels = ["Express", "Confort", "Premium"];

  if (offers.length >= 3) {
    return offers.slice(0, 3).map((o, i) => ({
      label: labels[i],
      prix_public: o.price,
      compagnie: o.company || "",
      stops: typeof o.stops === "number" ? o.stops : undefined,
    }));
  }

  if (offers.length >= 1) {
    const base = offers[0];
    const p = base.price;
    return [
      { label: "Express", prix_public: p, compagnie: base.company || "" },
      { label: "Confort", prix_public: Math.round(p * 1.08), compagnie: base.company || "" },
      { label: "Premium", prix_public: Math.round(p * 1.12), compagnie: base.company || "" },
    ];
  }

  if (hints?.express) {
    return [
      { label: "Express", prix_public: hints.express[0] },
      { label: "Confort", prix_public: hints.confort[0] },
      { label: "Premium", prix_public: hints.premium[0] },
    ];
  }

  return [];
}

function pendingClientMessage({ contact, lang, reason }) {
  const name = contact?.client_name?.split(" ")[0] || "Client";
  const reach = contact?.phone || contact?.email || "";
  if (lang === "en") {
    return (
      `Thank you, ${name}. We could not display live fares for this route right now` +
      (reason ? ` (${reason})` : "") +
      `. Our Ola Flight team is preparing your Business quote and will reach you shortly` +
      (reach ? ` at ${reach}` : "") +
      `. You will see the options here in the chat as soon as they are ready.`
    );
  }
  return (
    `Merci ${name}. Nous n'avons pas pu afficher de tarifs en direct sur cette route pour le moment` +
    (reason ? ` (${reason})` : "") +
    `. Notre équipe Ola Flight prépare votre devis Business et vous recontacte très vite` +
    (reach ? ` au ${reach}` : "") +
    `. Les options s'afficheront ici dans le chat dès qu'elles sont prêtes — nous n'envoyons pas de devis par email automatiquement.`
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
          destination,
          dates: datesLabel,
          status: "qualification",
          extras_notes:
            hints.needs_driver === true
              ? "Chauffeur privé souhaité — trajets à préciser par le client."
              : undefined,
        },
      },
      { context: ctx }
    );
    if (leadOut?.lead_id) ctx.lead_id = leadOut.lead_id;

    const scrapeOut = await runOlaTool(
      {
        name: "scrape_flights",
        input: {
          from: route.from,
          to: route.to,
          depart: travel.depart,
          adults: hints.passagers || travel.passagers || 1,
        },
      },
      { context: ctx }
    );

    if (scrapeOut?.route_blocked) {
      await runOlaTool(
        {
          name: "upsert_lead",
          input: { id: ctx.lead_id, status: "devis_pending", notes: scrapeOut.block_reason || "" },
        },
        { context: ctx }
      );
      return {
        text: pendingClientMessage({ contact, lang, reason: "route restreinte" }),
        lead_id: ctx.lead_id,
        devis_id: null,
      };
    }

    const options = buildScrapeOptions(scrapeOut);
    if (!scrapeOut?.scrape_ok || !options.length) {
      await runOlaTool(
        {
          name: "upsert_lead",
          input: {
            id: ctx.lead_id,
            status: "devis_pending",
            notes: `Scrape 0 offre ${route.from}→${route.to} ${travel.depart}`,
          },
        },
        { context: ctx }
      );
      return {
        text: pendingClientMessage({ contact, lang, reason: "aucune offre scrape" }),
        lead_id: ctx.lead_id,
        devis_id: null,
      };
    }

    const devisInput = {
      lead_id: ctx.lead_id,
      client_type: hints.client_type || "particulier",
      options,
      generate_pdf: true,
    };

    if (hints.needs_driver === true) {
      devisInput.driver = {
        vehicle: "Berline / van premium",
        pickup: "À préciser avec le client",
        dropoff: "À préciser avec le client",
        notes: "Trajets non définis lors de la demande chat",
      };
    }

    const devisOut = await runOlaTool(
      { name: "create_devis_from_offer", input: devisInput },
      { context: ctx }
    );

    if (devisOut?.devis_refused) {
      log.warn(`web devis refused: ${(devisOut.reasons || []).join("; ")}`);
      await runOlaTool(
        {
          name: "upsert_lead",
          input: { id: ctx.lead_id, status: "devis_pending" },
        },
        { context: ctx }
      );
      return {
        text: pendingClientMessage({ contact, lang, reason: "validation serveur" }),
        lead_id: ctx.lead_id,
        devis_id: null,
      };
    }

    const quote =
      ctx.clientQuoteMessage ||
      (lang === "en" ? devisOut?.client_quote_en : devisOut?.client_quote_fr);

    return {
      text: quote || null,
      lead_id: ctx.lead_id || devisOut?.lead_id || null,
      devis_id: devisOut?.devis_id || null,
    };
  } catch (e) {
    log.error(`web devis pipeline failed: ${e?.message || e}`);
    return { text: null, lead_id: ctx.lead_id || null, devis_id: null };
  }
}
