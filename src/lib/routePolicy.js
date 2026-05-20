// Politique destinations : refus serveur (avant/après LLM) — liste depuis data/blocked-destinations.json.

import { getAirportEntry } from "./airports.js";
import { getBlockedDestinationsIndex } from "./blockedDestinationsData.js";

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeRegex(place) {
  const escaped = place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
}

export function getRouteBlockReason(from, to) {
  const idx = getBlockedDestinationsIndex();
  const f = String(from || "").toUpperCase();
  const t = String(to || "").toUpperCase();
  for (const code of [f, t]) {
    if (!code) continue;
    const ap = getAirportEntry(code);
    if (!ap) continue;
    if (idx.countryCodes.has(ap.countryCode)) {
      const meta = idx.countries.find((c) => c.code === ap.countryCode);
      return {
        code: ap.countryCode,
        iata: code,
        label: ap.label || code,
        type: "country",
        level: meta?.level,
        source: meta?.source,
      };
    }
  }
  return null;
}

/** Détecte zone interdite dans le texte (alias Ola + noms de pays bloqués). */
export function matchBlockedPlaceInText(text) {
  const key = normalizeKey(text);
  if (!key) return null;
  const idx = getBlockedDestinationsIndex();

  for (const place of idx.places) {
    if (placeRegex(place).test(key)) {
      return { place, key: place, type: "place" };
    }
  }

  for (const name of idx.countryNames) {
    if (name.length < 4) continue;
    if (placeRegex(name).test(key)) {
      return { place: name, key: name, type: "country_name" };
    }
  }

  return null;
}

function blockedReply({ lang, hit }) {
  const en = lang === "en";
  const placeLabel = hit?.label || hit?.place || hit?.iata || "this destination";
  const levelNote =
    hit?.level === 4
      ? en
        ? " (US State Dept: Do Not Travel)"
        : " (avis US : ne pas voyager)"
      : hit?.level === 3
        ? en
          ? " (US State Dept: Reconsider Travel)"
          : " (avis US : repenser le voyage)"
        : "";

  if (en) {
    return (
      `We cannot arrange trips to ${placeLabel} at the moment — security and regulatory restrictions${levelNote}.\n\n` +
      `I can suggest alternative destinations in the same region (e.g. Warsaw, Budapest, Prague, Bucharest). ` +
      `Which city would work for you?`
    );
  }
  return (
    `Nous ne pouvons pas organiser de voyages vers ${placeLabel} pour le moment — restrictions sécuritaires et réglementaires${levelNote}.\n\n` +
    `Je peux vous proposer d'autres destinations dans la même région (Varsovie, Budapest, Prague, Bucarest). ` +
    `Quelle ville vous conviendrait ?`
  );
}

/**
 * Verdict serveur : destination interdite → ne pas appeler Claude pour continuer la qualification.
 */
export function evaluateRoutePolicy(route, messages, lang = "fr") {
  const hitRoute = getRouteBlockReason(route?.from, route?.to);
  if (hitRoute) {
    return {
      blocked: true,
      hit: hitRoute,
      reply: blockedReply({ lang, hit: { label: hitRoute.label, iata: hitRoute.iata, level: hitRoute.level } }),
    };
  }

  const lastUser = (messages || []).filter((m) => m.role === "user").pop();
  if (lastUser) {
    const place = matchBlockedPlaceInText(lastUser.content);
    if (place) {
      return {
        blocked: true,
        hit: place,
        reply: blockedReply({ lang, hit: { place: place.place } }),
      };
    }
  }

  return { blocked: false };
}

/** Stats pour admin / logs */
export function getBlockedPolicyStats() {
  const idx = getBlockedDestinationsIndex();
  return {
    countries: idx.countryCodes.size,
    places: idx.places.length,
    generatedAt: idx.meta.generatedAt,
    policy: idx.meta.policy,
  };
}
