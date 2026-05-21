// Résolution villes / aéroports → codes IATA pour l'agent Ola Flight.
// Base complète OurAirports (~9 000 codes IATA) — voir data/airports-index.json
// Régénérer : npm run airports:build

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isContactFormUserMessage } from "./contactFormUi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "../../data/airports-index.json");

/** @type {{ byIata: Record<string, object>, aliases: Record<string, string> } | null} */
let _index = null;

/** Villes FR courantes absentes ou ambiguës dans l'index. */
const MANUAL_FR_ALIASES = {
  varsovie: "WAW",
  warsaw: "WAW",
  warszawa: "WAW",
  kiev: "IEV",
  kyiv: "IEV",
  budapest: "BUD",
  prague: "PRG",
  bucarest: "OTP",
  bucharest: "OTP",
  londres: "LHR",
  london: "LHR",
  bali: "DPS",
  indonesie: "DPS",
  indonésie: "DPS",
  indonesia: "DPS",
  denpasar: "DPS",
  alger: "ALG",
  algiers: "ALG",
  "tizi ouzou": "ALG",
  "tel aviv": "TLV",
  "tel-aviv": "TLV",
  telaviv: "TLV",
  paris: "CDG",
  "new york": "JFK",
  "new-york": "JFK",
};

/** Mots FR courants — ne pas résoudre comme alias IATA (ex. « pas » → PAS Paros). */
const BLOCKED_PLACE_WORDS = new Set([
  "pas",
  "non",
  "oui",
  "plus",
  "sans",
  "avec",
  "pour",
  "tres",
  "très",
  "bien",
  "merci",
  "ok",
  "perso",
  "personnel",
  "hotel",
  "hôtel",
  "chauffeur",
  "chauffeurs",
  "entreprise",
  "professionnel",
  "ajd",
  "meme",
  "même",
  "possible",
  "semaine",
  "tot",
  "tôt",
  "tel",
  "tete",
  "tête",
]);

/** Codes 3 lettres qui ne sont pas des aéroports dans nos conversations. */
const SPURIOUS_IATA = new Set([
  "WEB",
  "PDF",
  "SMS",
  "CRM",
  "API",
  "URL",
  "BOT",
  "FAQ",
  "VIP",
  "CEO",
  "CTA",
  "APP",
  "DOM",
  "XML",
  "JSON",
  "OUI",
  "NON",
]);

const ROUTE_SEP_RE = /\s*(?:→|->|vers|to|—|–)\s*/i;

function loadIndex() {
  if (_index) return _index;
  try {
    const raw = readFileSync(INDEX_PATH, "utf8");
    _index = JSON.parse(raw);
    return _index;
  } catch (e) {
    console.warn(`[airports] index introuvable (${INDEX_PATH}) — lancez: npm run airports:build`);
    _index = { byIata: {}, aliases: {} };
    return _index;
  }
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasAsWordRegex(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
}

function isSpuriousIata(code) {
  return SPURIOUS_IATA.has(String(code || "").toUpperCase());
}

/** Réponses conversationnelles — ne pas en déduire une ville/IATA. */
function isNonRouteUserReply(text) {
  const t = String(text || "").trim();
  return /\b(en\s+t[eê]te|trajets?|pas\s+les|je\s+n['']?ai\s+pas|oui\s+mais|pas\s+en\s+t[eê]te)\b/i.test(t);
}

function isShortCityReply(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 55 || t.includes("\n")) return false;
  if (/^[\d\s+().@-]+$/.test(t)) return false;
  if (/^(oui|non|ok|yes|no|merci|thanks|business|first|entreprise|corporate)$/i.test(t)) return false;
  if (
    /\b(?:ajd|aujourd|semaine|demain|asap|possible|passager|chauffeur|h[oô]tel|perso|en\s+t[eê]te)\b/i.test(t)
  ) {
    return false;
  }
  return true;
}

function entryFromIata(iata) {
  const code = String(iata || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || isSpuriousIata(code)) return null;
  const ap = loadIndex().byIata[code];
  if (!ap) return { iata: code, label: code, slug: "", inIndex: false };
  return {
    iata: ap.iata,
    label: ap.label,
    slug: ap.slug || "",
    city: ap.city,
    country: ap.country,
    countryCode: ap.countryCode || "",
    name: ap.name,
    inIndex: true,
  };
}

/** Entrée index (OurAirports) ou null si code inconnu. */
export function getAirportEntry(iata) {
  return entryFromIata(iata);
}

/**
 * Résout un fragment texte (ville, IATA, nom d'aéroport) en code IATA.
 * @returns {{ iata: string, label: string, slug?: string, inIndex?: boolean } | null}
 */
export function resolveAirport(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/\bpas\s+d['']?/i.test(raw)) return null;
  if (/\ben\s+t[eê]te\b/i.test(raw)) return null;

  const key = normalizeKey(raw);
  if (BLOCKED_PLACE_WORDS.has(key)) return null;
  if (MANUAL_FR_ALIASES[key]) return entryFromIata(MANUAL_FR_ALIASES[key]);

  const { aliases, byIata } = loadIndex();

  if (aliases[key]) return entryFromIata(aliases[key]);

  const iataOnly = raw.match(/^\s*([A-Za-z]{3})\s*$/);
  if (iataOnly) return entryFromIata(iataOnly[1].toUpperCase());

  const iataMatch = raw.match(/\b([A-Z]{3})\b/i);
  if (iataMatch && raw.length <= 6) return entryFromIata(iataMatch[1].toUpperCase());

  if (key.length >= 3) {
    const candidates = [];
    for (const [alias, code] of Object.entries(aliases)) {
      if (alias.length < 4 || BLOCKED_PLACE_WORDS.has(alias)) continue;
      if (alias === key) {
        candidates.push({ alias, code, len: alias.length, exact: true });
        continue;
      }
      if (aliasAsWordRegex(alias).test(key)) {
        candidates.push({ alias, code, len: alias.length, exact: false });
      }
    }
    candidates.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return b.len - a.len;
    });
    if (candidates.length) return entryFromIata(candidates[0].code);
  }

  const q = key;
  let best = null;
  for (const ap of Object.values(byIata)) {
    const cityK = normalizeKey(ap.city);
    const nameK = normalizeKey(ap.name);
    if (!cityK && !nameK) continue;
    if (cityK === q || nameK === q) return entryFromIata(ap.iata);
    if (cityK && (q === cityK || aliasAsWordRegex(cityK).test(q))) {
      if (!best || q.length <= cityK.length) best = ap;
    }
  }
  if (best) return entryFromIata(best.iata);

  return null;
}

/**
 * Extrait from/to depuis une chaîne destination (lead ou conversation).
 */
export function parseRouteFromText(text) {
  const s = String(text || "").trim();
  if (!s || isContactFormUserMessage(s)) return { from: null, to: null, label: "" };

  const parts = s.split(ROUTE_SEP_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const fromR = resolveAirport(parts[0]);
    const toR = resolveAirport(parts[1]);
    const from = fromR?.iata || null;
    const to = toR?.iata || null;
    const label = [fromR?.label || parts[0], toR?.label || parts[1]].filter(Boolean).join(" → ");
    return { from, to, label };
  }

  if (/\bpas\s+d['']?/i.test(s)) {
    return { from: null, to: null, label: s };
  }

  const single = resolveAirport(s);
  if (single) return { from: null, to: single.iata, label: single.label };

  const codes = [...s.toUpperCase().matchAll(/\b([A-Z]{3})\b/g)]
    .map((m) => m[1])
    .filter((c) => !isSpuriousIata(c) && !BLOCKED_PLACE_WORDS.has(c.toLowerCase()));
  const uniq = [...new Set(codes)];
  if (uniq.length >= 2) {
    return {
      from: uniq[0],
      to: uniq[1],
      label: `${entryFromIata(uniq[0])?.label || uniq[0]} → ${entryFromIata(uniq[1])?.label || uniq[1]}`,
    };
  }
  if (uniq.length === 1) {
    const e = entryFromIata(uniq[0]);
    if (e) return { from: null, to: uniq[0], label: e.label || uniq[0] };
  }

  return { from: null, to: null, label: s };
}

const DEST_PATTERNS = [
  /\b(?:pour|vers|à|a|destination|going to|to)\s+([a-zàâäéèêëïîôùûüç\s'-]{3,50})/gi,
  /\b(?:aller(?:\s+simple)?|vol)\s+(?:pour|vers|à|a)\s+([a-zàâäéèêëïîôùûüç\s'-]{3,50})/gi,
  /\b(?:from|de|depuis)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})\s+(?:to|vers|à|a)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})/gi,
  /\b([a-zàâäéèêëïîôùûüç]{3,35})\s*(?:→|->|vers)\s*([a-zàâäéèêëïîôùûüç]{3,35})/gi,
];

const DEPARTURE_QUESTION_RE =
  /\b(d['']?o[uù]|depuis|from|partir|d[eé]part|ville de d[eé]part)\b/i;
const DESTINATION_QUESTION_RE =
  /\b(destination|arriv[eé]e|pour quelle destination|going to|what'?s your destination)\b/i;

function applyCityToRoute({ ap, expectField, from, to }) {
  if (!ap?.iata) return { from, to, expectField };
  const code = ap.iata;
  if (expectField === "from") {
    return { from: code, to, expectField: null };
  }
  if (expectField === "to") {
    return { from, to: code, expectField: null };
  }
  if (to && !from && code !== to) {
    return { from: code, to, expectField: null };
  }
  if (!to) {
    return { from, to: code, expectField: null };
  }
  if (!from) {
    return { from: code, to, expectField: null };
  }
  // Ville déjà en départ ou arrivée (ex. « ok pour Alger ») — ne pas écraser la destination.
  if (code === from || code === to) {
    return { from, to, expectField: null };
  }
  return { from, to: code, expectField: null };
}

/**
 * Scanne l'historique de messages pour reconstruire la route confirmée.
 */
export function extractRouteFromMessages(messages) {
  let from = null;
  let to = null;
  let label = "";
  let oneWay = false;
  let expectField = null;

  for (const m of messages || []) {
    if (m.role === "assistant") {
      const t = String(m.content || "");
      if (DEPARTURE_QUESTION_RE.test(t)) expectField = "from";
      else if (DESTINATION_QUESTION_RE.test(t)) expectField = "to";
      continue;
    }
    if (m.role !== "user") continue;

    const text = String(m.content || "").trim();
    if (!text || isContactFormUserMessage(text)) continue;
    if (isNonRouteUserReply(text)) continue;

    if (/\b(aller\s+simple|one\s*way|sans\s+retour)\b/i.test(text)) oneWay = true;

    const ft =
      /\b(?:de|depuis|from)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})\s+(?:vers|à|a|to)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})/i.exec(
        text
      );
    if (ft) {
      const f = resolveAirport(ft[1]);
      const t = resolveAirport(ft[2]);
      if (f) from = f.iata;
      if (t) to = t.iata;
      expectField = null;
      continue;
    }

    for (const re of DEST_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match[2]) {
          const f = resolveAirport(match[1]);
          const t = resolveAirport(match[2]);
          if (f) from = f.iata;
          if (t) to = t.iata;
          expectField = null;
        } else if (match[1]) {
          const t = resolveAirport(match[1].trim());
          if (t) {
            let field = expectField;
            if (!field) {
              if (!to) field = "to";
              else if (!from) field = "from";
              else field = null;
            }
            const applied = applyCityToRoute({
              ap: t,
              expectField: field,
              from,
              to,
            });
            from = applied.from;
            to = applied.to;
            expectField = applied.expectField;
          }
        }
      }
    }

    if (isShortCityReply(text)) {
      const ap = resolveAirport(text);
      if (ap) {
        const applied = applyCityToRoute({ ap, expectField, from, to });
        from = applied.from;
        to = applied.to;
        expectField = applied.expectField;
        continue;
      }
    }

    const route = parseRouteFromText(text);
    if (route.from && route.to) {
      from = route.from;
      to = route.to;
      expectField = null;
    } else {
      if (route.from) from = route.from;
      if (route.to && !isSpuriousIata(route.to)) {
        const applied = applyCityToRoute({
          ap: entryFromIata(route.to),
          expectField,
          from,
          to,
        });
        from = applied.from;
        to = applied.to;
        expectField = applied.expectField;
      }
    }
    if (route.label && route.from && route.to) label = route.label;
  }

  if (!label && (from || to)) {
    const fromL = from ? entryFromIata(from)?.label || from : null;
    const toL = to ? entryFromIata(to)?.label || to : null;
    label = [fromL, toL].filter(Boolean).join(" → ");
  }

  return { from, to, label, oneWay };
}

/** Label lisible pour Google Flights autocomplete. */
export function iataToSearchLabel(iata) {
  return entryFromIata(iata)?.label || String(iata || "").toUpperCase();
}

/** Slug Booking.com city-to-city (approximatif). */
export function iataToBookingSlug(iata) {
  return entryFromIata(iata)?.slug || "";
}

/**
 * Corrige from/to du scrape si le LLM s'est trompé par rapport à la route confirmée.
 */
export function reconcileScrapeRoute({ from, to, confirmed }) {
  const out = {
    from: String(from || "").toUpperCase(),
    to: String(to || "").toUpperCase(),
    corrected: false,
    reason: "",
  };
  if (!confirmed) return out;

  const cFrom = confirmed.from ? String(confirmed.from).toUpperCase() : null;
  const cTo = confirmed.to ? String(confirmed.to).toUpperCase() : null;

  if (cTo && out.to !== cTo) {
    out.reason = `destination corrigée ${out.to} → ${cTo}`;
    out.to = cTo;
    out.corrected = true;
  }
  if (cFrom && out.from !== cFrom) {
    out.reason = (out.reason ? out.reason + "; " : "") + `origine corrigée ${out.from} → ${cFrom}`;
    out.from = cFrom;
    out.corrected = true;
  }

  return out;
}

export function formatDestinationLabel({ from, to, label }) {
  if (from && to) {
    return `${entryFromIata(from)?.label || from} → ${entryFromIata(to)?.label || to} (${from} → ${to})`;
  }
  if (to) return `${entryFromIata(to)?.label || to} (${to})`;
  return label || "";
}

/** Nombre d'aéroports IATA chargés (pour diagnostics). */
export function getAirportIndexStats() {
  const idx = loadIndex();
  return {
    airports: Object.keys(idx.byIata || {}).length,
    aliases: Object.keys(idx.aliases || {}).length,
    path: INDEX_PATH,
  };
}

/** Proxy legacy : registre IATA → entrée. */
export function getIataRegistry() {
  const { byIata } = loadIndex();
  const out = {};
  for (const [code, ap] of Object.entries(byIata)) {
    out[code] = { iata: ap.iata, label: ap.label, slug: ap.slug || "" };
  }
  return out;
}

export const IATA_REGISTRY = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return getIataRegistry()[prop];
    },
    ownKeys() {
      return Object.keys(getIataRegistry());
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop in getIataRegistry()) {
        return { enumerable: true, configurable: true };
      }
    },
  }
);
