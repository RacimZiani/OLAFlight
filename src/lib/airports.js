// Résolution villes / aéroports → codes IATA pour l'agent Ola Flight.
// Base complète OurAirports (~9 000 codes IATA) — voir data/airports-index.json
// Régénérer : npm run airports:build

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "../../data/airports-index.json");

/** @type {{ byIata: Record<string, object>, aliases: Record<string, string> } | null} */
let _index = null;

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

const ROUTE_SEP_RE = /\s*(?:→|->|vers|to|—|–)\s*/i;

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entryFromIata(iata) {
  const code = String(iata || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const ap = loadIndex().byIata[code];
  if (!ap) return { iata: code, label: code, slug: "" };
  return {
    iata: ap.iata,
    label: ap.label,
    slug: ap.slug || "",
    city: ap.city,
    country: ap.country,
    name: ap.name,
  };
}

/**
 * Résout un fragment texte (ville, IATA, nom d'aéroport) en code IATA.
 * Couvre tous les aéroports IATA de la base OurAirports + alias FR courants.
 * @returns {{ iata: string, label: string, slug?: string } | null}
 */
export function resolveAirport(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const { aliases, byIata } = loadIndex();
  const key = normalizeKey(raw);

  // Alias exact (ville, nom, mot-clé)
  if (aliases[key]) return entryFromIata(aliases[key]);

  // Code IATA seul
  const iataMatch = raw.match(/\b([A-Z]{3})\b/i);
  if (iataMatch) return entryFromIata(iataMatch[1].toUpperCase());

  // Sous-chaîne : "pour madrid", texte long avec ville dedans
  if (key.length >= 3) {
    // Priorité aux alias dont la clé est contenue dans le texte (plus long d'abord)
    const candidates = [];
    for (const [alias, code] of Object.entries(aliases)) {
      if (alias.length < 3) continue;
      if (key.includes(alias) || alias.includes(key)) {
        candidates.push({ alias, code, len: alias.length });
      }
    }
    candidates.sort((a, b) => b.len - a.len);
    if (candidates.length) return entryFromIata(candidates[0].code);
  }

  // Recherche par ville / nom d'aéroport (contient)
  const q = key;
  let best = null;
  for (const ap of Object.values(byIata)) {
    const cityK = normalizeKey(ap.city);
    const nameK = normalizeKey(ap.name);
    if (!cityK && !nameK) continue;
    if (cityK === q || nameK === q) return entryFromIata(ap.iata);
    if (cityK && (q.includes(cityK) || cityK.includes(q))) {
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
  if (!s) return { from: null, to: null, label: "" };

  const parts = s.split(ROUTE_SEP_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const fromR = resolveAirport(parts[0]);
    const toR = resolveAirport(parts[1]);
    const from = fromR?.iata || null;
    const to = toR?.iata || null;
    const label = [fromR?.label || parts[0], toR?.label || parts[1]].filter(Boolean).join(" → ");
    return { from, to, label };
  }

  const single = resolveAirport(s);
  if (single) return { from: null, to: single.iata, label: single.label };

  const codes = [...s.toUpperCase().matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]);
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
    return { from: null, to: uniq[0], label: e?.label || uniq[0] };
  }

  return { from: null, to: null, label: s };
}

const DEST_PATTERNS = [
  /\b(?:pour|vers|à|a|destination|going to|to)\s+([a-zàâäéèêëïîôùûüç\s'-]{3,50})/gi,
  /\b(?:aller(?:\s+simple)?|vol)\s+(?:pour|vers|à|a)\s+([a-zàâäéèêëïîôùûüç\s'-]{3,50})/gi,
  /\b(?:from|de|depuis)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})\s+(?:to|vers|à|a)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})/gi,
  /\b([a-zàâäéèêëïîôùûüç]{3,35})\s*(?:→|->|vers)\s*([a-zàâäéèêëïîôùûüç]{3,35})/gi,
];

/**
 * Scanne l'historique de messages pour reconstruire la route confirmée.
 */
export function extractRouteFromMessages(messages) {
  let from = null;
  let to = null;
  let label = "";
  let oneWay = false;

  const userTexts = (messages || [])
    .filter((m) => m.role === "user")
    .map((m) => String(m.content || ""));

  for (const text of userTexts) {
    if (/\b(aller\s+simple|one\s*way|sans\s+retour)\b/i.test(text)) oneWay = true;

    const ft = /\b(?:de|depuis|from)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})\s+(?:vers|à|a|to)\s+([a-zàâäéèêëïîôùûüç\s'-]{2,40})/i.exec(text);
    if (ft) {
      const f = resolveAirport(ft[1]);
      const t = resolveAirport(ft[2]);
      if (f) from = f.iata;
      if (t) to = t.iata;
    }

    for (const re of DEST_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[2]) {
          const f = resolveAirport(m[1]);
          const t = resolveAirport(m[2]);
          if (f) from = f.iata;
          if (t) to = t.iata;
        } else if (m[1]) {
          const t = resolveAirport(m[1].trim());
          if (t) to = t.iata;
        }
      }
    }

    const route = parseRouteFromText(text);
    if (route.from) from = route.from;
    if (route.to) to = route.to;
    if (route.label) label = route.label;
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

  if (!cFrom && cTo && !out.from) {
    out.from = "CDG";
    out.corrected = true;
    out.reason = (out.reason ? out.reason + "; " : "") + "origine par défaut CDG (Paris)";
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

// Compat : ancien export BY_IATA / IATA_REGISTRY
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
