/**
 * Enrichissement lead CRM depuis la conversation (formulaire web, route, dates, classe).
 */

import {
  extractRouteFromMessages,
  formatDestinationLabel,
  parseRouteFromText,
} from "./airports.js";
import {
  extractTravelDatesFromMessages,
  formatLeadDatesLabel,
  parseTravelDatesFromText,
} from "./travelDates.js";
import {
  extractContactFromMessages,
  isContactFormUserMessage,
} from "./contactFormUi.js";

function coalesceStr(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (s === "Client" || s === "—" || s === "-") continue;
    return s;
  }
  return "";
}

/** Indices depuis les messages utilisateur (classe, pax, type client, extras). */
export function extractLeadHintsFromMessages(messages) {
  let classe = "";
  let passagers = null;
  let client_type = "";
  let needs_hotel = null;
  let needs_driver = null;

  for (const m of messages || []) {
    if (m.role !== "user") continue;
    const t = String(m.content || "");
    if (isContactFormUserMessage(t)) continue;

    if (/\b(?:first|premi[eè]re)\b/i.test(t)) classe = "First";
    else if (/\bbusiness\b/i.test(t)) classe = "Business";

    const pax = t.match(/\b(\d{1,2})\s*(?:personnes?|pax|passagers?|adultes?)\b/i);
    if (pax) passagers = Math.max(1, Number(pax[1]) || 1);

    if (/\b(?:particulier|perso|personnel|priv[eé]|personnellement)\b/i.test(t)) {
      client_type = "particulier";
    } else if (/\b(?:corporate|entreprise|soci[eé]t[eé])\b/i.test(t)) {
      client_type = "corporate";
    } else if (/\b(?:pro|professionnel|freelance)\b/i.test(t)) {
      client_type = "pro";
    }

    if (/pas\s+d['']?h[oô]tel|sans\s+h[oô]tel|no\s+hotel/i.test(t)) needs_hotel = false;
    if (/pas\s+de\s+chauffeur|sans\s+chauffeur|no\s+(?:driver|chauffeur)/i.test(t)) {
      needs_driver = false;
    }
  }

  const travel = extractTravelDatesFromMessages(messages);
  if (travel.passagers != null) passagers = travel.passagers;

  return { classe, passagers, client_type, needs_hotel, needs_driver, travel };
}

export function resolveLeadDestination({
  argsDestination = "",
  existing = null,
  confirmedRoute = null,
  conversationMessages = [],
}) {
  if (confirmedRoute?.from || confirmedRoute?.to) {
    return formatDestinationLabel(confirmedRoute);
  }

  const fromMsgs = extractRouteFromMessages(conversationMessages || []);
  if (fromMsgs.from || fromMsgs.to) {
    return formatDestinationLabel(fromMsgs);
  }

  const raw = String(argsDestination || "").trim();
  if (!raw) return existing?.destination || "";

  if (/\bpas\s+d['']?/i.test(raw)) {
    return existing?.destination || raw;
  }

  const parsed = parseRouteFromText(raw);
  if (parsed.from || parsed.to) {
    return formatDestinationLabel({
      from: parsed.from,
      to: parsed.to,
      label: parsed.label || raw,
    });
  }
  return raw;
}

export function resolveLeadDates({
  argsDates = "",
  existing = null,
  confirmedTravel = null,
  conversationMessages = [],
}) {
  if (confirmedTravel?.depart) {
    return formatLeadDatesLabel(confirmedTravel);
  }

  const travel = extractTravelDatesFromMessages(conversationMessages || []);
  if (travel.depart) {
    return formatLeadDatesLabel(travel);
  }

  const raw = String(argsDates || "").trim();
  if (!raw) return existing?.dates || "";

  const parsed = parseTravelDatesFromText(raw);
  if (parsed.depart) return formatLeadDatesLabel({ ...parsed, oneWay: confirmedTravel?.oneWay });
  return raw;
}

/**
 * Fusionne args outil + conversation + lead existant (ne pas écraser par des champs vides).
 */
export function buildLeadUpsertPayload({
  args,
  existing = null,
  context = {},
}) {
  const msgs = context.conversationMessages || [];
  const contact = extractContactFromMessages(msgs);
  const hints = extractLeadHintsFromMessages(msgs);
  const route =
    context.confirmedRoute?.from || context.confirmedRoute?.to
      ? context.confirmedRoute
      : extractRouteFromMessages(msgs);
  const travel =
    context.confirmedTravel?.depart ? context.confirmedTravel : hints.travel;

  const client_name = coalesceStr(
    args.client_name,
    contact?.client_name,
    existing?.client_name
  ) || "Client";

  const email = contact?.email || "";
  const phone = contact?.phone || "";
  const client_contact = coalesceStr(
    args.client_contact,
    phone,
    email,
    existing?.client_contact
  );

  const notesParts = [];
  const baseNotes = coalesceStr(args.notes, existing?.notes);
  if (baseNotes) notesParts.push(baseNotes);
  if (email && !String(client_contact).includes(email)) {
    notesParts.push(`Email : ${email}`);
  }
  if (context.channel === "web" && context.contact) {
    notesParts.push(`Conversation web : ${context.contact}`);
  }

  const payload = {
    client_name,
    client_contact,
    destination: resolveLeadDestination({
      argsDestination: args.destination,
      existing,
      confirmedRoute: route,
      conversationMessages: msgs,
    }),
    dates: resolveLeadDates({
      argsDates: args.dates,
      existing,
      confirmedTravel: travel,
      conversationMessages: msgs,
    }),
    classe: coalesceStr(args.classe, hints.classe, existing?.classe),
    passagers:
      args.passagers != null
        ? args.passagers
        : hints.passagers != null
          ? hints.passagers
          : existing?.passagers ?? 1,
    notes: notesParts.filter(Boolean).join("\n"),
  };

  if (hints.client_type || args.client_type) {
    payload.client_type = args.client_type || hints.client_type;
  }
  if (args.needs_hotel != null) payload.needs_hotel = args.needs_hotel;
  else if (hints.needs_hotel != null) payload.needs_hotel = hints.needs_hotel;
  else if (existing?.needs_hotel != null) payload.needs_hotel = existing.needs_hotel;

  if (args.needs_driver != null) payload.needs_driver = args.needs_driver;
  else if (hints.needs_driver != null) payload.needs_driver = hints.needs_driver;
  else if (existing?.needs_driver != null) payload.needs_driver = existing.needs_driver;

  return { payload, contact, route, travel };
}
