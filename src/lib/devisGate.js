// Garde-fous serveur avant create_devis_from_offer (web) — ne remplace pas le prompt.

import {
  parseRouteFromText,
  getAirportEntry,
  formatDestinationLabel,
} from "./airports.js";
import { parseTravelDatesFromText } from "./travelDates.js";
import { getRouteBlockReason as getRouteBlockReasonPolicy } from "./routePolicy.js";

const PLACEHOLDER_NAMES = new Set([
  "client",
  "client web",
  "visiteur",
  "anonymous",
  "user",
  "test",
]);

function hasRealName(lead) {
  const n = String(lead?.client_name || "").trim();
  if (!n || n.length < 2) return false;
  if (PLACEHOLDER_NAMES.has(n.toLowerCase())) return false;
  if (/^(client|user|test)\b/i.test(n)) return false;
  return true;
}

function hasRealContact(lead) {
  const c = String(lead?.client_contact || "").trim();
  if (!c || c.length < 5) return false;
  const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(c);
  const hasPhone = /\+?\d[\d\s().-]{7,}/.test(c);
  return hasEmail || hasPhone;
}

function hasDates(lead, context) {
  if (context?.confirmedTravel?.depart) return true;
  const parsed = parseTravelDatesFromText(lead?.dates || "");
  return Boolean(parsed?.depart);
}

export function getRouteBlockReason(from, to) {
  const hit = getRouteBlockReasonPolicy(from, to);
  if (!hit) return null;
  return `Destination ${hit.label || hit.iata} : vols commerciaux non disponibles via Ola Flight (zone ${hit.code || hit.place || "restreinte"}).`;
}

export function resolveRouteForLead(lead, context = {}) {
  const fromLead = parseRouteFromText(lead?.destination || "");
  const confirmed = context?.confirmedRoute || null;
  const from = confirmed?.from || fromLead.from || null;
  const to = confirmed?.to || fromLead.to || null;
  const label =
    confirmed?.label ||
    fromLead.label ||
    (from && to ? formatDestinationLabel({ from, to }) : "");
  return { from, to, label };
}

/**
 * Vérifie si un devis auto (web) est autorisé.
 * @returns {{ ok: true, route: object } | { ok: false, reasons: string[], instruction: string }}
 */
export function checkDevisAllowed(lead, context = {}) {
  const reasons = [];
  const route = resolveRouteForLead(lead, context);

  if (!route.from || !route.to) {
    reasons.push(
      "Route incomplète : aéroport de départ ET d'arrivée obligatoires (ville ou code IATA confirmés par le client)."
    );
  } else {
    const fromAp = getAirportEntry(route.from);
    const toAp = getAirportEntry(route.to);
    if (!fromAp?.inIndex) {
      reasons.push(`Aéroport de départ « ${route.from} » non reconnu dans notre base.`);
    }
    if (!toAp?.inIndex) {
      reasons.push(`Aéroport d'arrivée « ${route.to} » non reconnu dans notre base.`);
    }
    const block = getRouteBlockReason(route.from, route.to);
    if (block) reasons.push(block);
  }

  if (!hasRealName(lead)) {
    reasons.push("Identité : prénom et nom du client obligatoires (pas « Client »).");
  }
  if (!hasRealContact(lead)) {
    reasons.push("Contact : email et/ou téléphone obligatoires.");
  }
  if (!hasDates(lead, context)) {
    reasons.push("Dates de voyage obligatoires (date précise ou période).");
  }
  if (!String(lead?.classe || "").trim()) {
    reasons.push("Classe de voyage obligatoire (Business, First, etc.).");
  }
  if (!lead?.client_type) {
    reasons.push("Type de client obligatoire (particulier / pro / corporate).");
  }
  if (lead?.needs_driver === undefined || lead?.needs_driver === null) {
    reasons.push("Question chauffeur privé obligatoire (needs_driver true ou false).");
  }

  const channel = String(context?.channel || "web").toLowerCase();
  if (channel === "web") {
    const scrape = context?.lastScrape;
    if (!scrape) {
      reasons.push("Aucun scrape_flights sur cette conversation : lancez scrape_flights avant le devis.");
    } else if (scrape.route_blocked) {
      reasons.push(scrape.block_reason || "Route non éligible au devis automatique.");
    } else if (!scrape.scrape_ok || !scrape.offers_count) {
      reasons.push(
        "Aucune offre de vol réelle trouvée sur cette route — impossible de générer un devis fiable. Proposez d'autres dates/aéroports ou transférez à l'équipe (statut devis_pending)."
      );
    } else if (route.from && route.to) {
      const sf = String(scrape.from || "").toUpperCase();
      const st = String(scrape.to || "").toUpperCase();
      if (sf !== route.from || st !== route.to) {
        reasons.push(
          `Le scrape (${sf}→${st}) ne correspond pas à la route confirmée (${route.from}→${route.to}).`
        );
      }
    }
  }

  if (reasons.length) {
    return {
      ok: false,
      reasons,
      route,
      instruction:
        "NE PAS appeler create_devis_from_offer. Collectez les infos manquantes une par une, ou mettez le lead en devis_pending et dites au client que l'équipe revient vers lui. N'inventez jamais de compagnie, horaire ni aéroport.",
    };
  }

  return { ok: true, route };
}

/** Libellé aéroport officiel (index OurAirports) — pour PDF / options. */
export function formatAirportOfficial(iata) {
  const ap = getAirportEntry(iata);
  if (!ap?.inIndex) return String(iata || "").toUpperCase();
  const name = ap.name || ap.label || iata;
  return `${name} (${ap.iata})`;
}

/**
 * Enrichit les options de devis avec les aéroports réels ; horaires issus du scrape si dispo.
 */
export function enrichDevisOptionsFromRoute(rawOpts, { route, scrapeOffers = [] }) {
  const from = route?.from;
  const to = route?.to;
  const depAirport = from ? formatAirportOfficial(from) : "";
  const arrAirport = to ? formatAirportOfficial(to) : "";
  const sortedOffers = [...(scrapeOffers || [])].sort((a, b) => a.price - b.price);

  return rawOpts.map((opt, i) => {
    const scraped = sortedOffers[i] || sortedOffers[0] || null;
    const compagnie =
      (scraped?.company && String(scraped.company).trim()) ||
      (opt.compagnie && !/à confirmer/i.test(opt.compagnie) ? opt.compagnie : "") ||
      "Compagnie selon disponibilité";

    let horaire_dep = "";
    let horaire_arr = "";
    if (scraped?.depart_time || scraped?.arrive_time) {
      horaire_dep = scraped.depart_time
        ? `${depAirport} · départ ${scraped.depart_time}`
        : depAirport;
      horaire_arr = scraped.arrive_time
        ? `${arrAirport} · arrivée ${scraped.arrive_time}`
        : arrAirport;
    } else {
      horaire_dep = depAirport;
      horaire_arr = arrAirport;
    }

    return {
      ...opt,
      compagnie,
      horaire_dep,
      horaire_arr,
      aeroport_dep: depAirport,
      aeroport_arr: arrAirport,
      route_label: route?.label || (from && to ? `${from} → ${to}` : ""),
    };
  });
}
