#!/usr/bin/env node
/**
 * Génère data/airports-index.json depuis OurAirports (domaine public).
 * https://ourairports.com/data/
 *
 * Usage: node scripts/build-airports-index.mjs
 * Sources: télécharge airports.csv + countries.csv si absents en cache.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "airports-index.json");

const SOURCES = {
  airports: "https://davidmegginson.github.io/ourairports-data/airports.csv",
  countries: "https://davidmegginson.github.io/ourairports-data/countries.csv",
};

const TYPE_SCORE = {
  large_airport: 5,
  medium_airport: 3,
  small_airport: 1,
  seaplane_base: 0,
  balloonport: 0,
  closed: -99,
  heliport: -99,
};

const SKIP_TYPES = new Set(["closed", "heliport", "balloonport"]);

/** Alias FR courants → clé alias (ville EN normalisée ou IATA). */
const FR_CITY_ALIASES = {
  paris: "paris",
  londres: "london",
  london: "london",
  barcelone: "barcelona",
  munich: "munich",
  munchen: "munich",
  münchen: "munich",
  francfort: "frankfurt",
  frankfurt: "frankfurt",
  geneve: "geneva",
  genève: "geneva",
  zurich: "zurich",
  zürich: "zurich",
  lisbonne: "lisbon",
  lisbon: "lisbon",
  rome: "rome",
  milan: "milan",
  milano: "milan",
  vienne: "vienna",
  vienna: "vienna",
  bruxelles: "brussels",
  brussels: "brussels",
  amsterdam: "amsterdam",
  singapour: "singapore",
  singapore: "singapore",
  moscou: "moscow",
  pekin: "beijing",
  pékin: "beijing",
  beijing: "beijing",
  shanghai: "shanghai",
  istanbul: "istanbul",
  dubai: "dubai",
  dubaï: "dubai",
  "new york": "new york",
  "los angeles": "los angeles",
  "hong kong": "hong kong",
  "sao paulo": "sao paulo",
  "são paulo": "sao paulo",
  montreal: "montreal",
  montréal: "montreal",
  abidjan: "abidjan",
  cotonou: "cotonou",
  dakar: "dakar",
  casablanca: "casablanca",
  marrakech: "marrakech",
  alger: "algiers",
  tunis: "tunis",
  nice: "nice",
  lyon: "lyon",
  marseille: "marseille",
  bordeaux: "bordeaux",
  toulouse: "toulouse",
  madrid: "madrid",
  barcelona: "barcelona",
  nyc: "new york",
};

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s) {
  return normalizeKey(s).replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 48);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.map((r) => Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""])));
}

async function fetchCsv(url, cachePath) {
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch {
    console.log(`Téléchargement ${url}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
    const text = await res.text();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, text);
    return text;
  }
}

function stripAirportName(name) {
  return String(name || "")
    .replace(/\s+Airport$/i, "")
    .replace(/\s+International$/i, "")
    .replace(/\s+Intl\.?$/i, "")
    .trim();
}

function scoreAirport(row) {
  const type = row.type || "";
  if (SKIP_TYPES.has(type)) return -999;
  let s = TYPE_SCORE[type] ?? 0;
  if (row.scheduled_service === "yes") s += 2;
  return s;
}

async function main() {
  const cacheDir = path.join(ROOT, ".cache", "ourairports");
  const airportsCsv = await fetchCsv(SOURCES.airports, path.join(cacheDir, "airports.csv"));
  const countriesCsv = await fetchCsv(SOURCES.countries, path.join(cacheDir, "countries.csv"));

  const countryRows = parseCsv(countriesCsv);
  const countryByCode = Object.fromEntries(countryRows.map((c) => [c.code, c.name]));

  const airportRows = parseCsv(airportsCsv);
  const byIata = {};
  const cityBest = new Map(); // normalized city -> { iata, score }

  for (const row of airportRows) {
    const iata = String(row.iata_code || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    if (SKIP_TYPES.has(row.type)) continue;

    const sc = scoreAirport(row);
    if (sc < 0) continue;

    const city = String(row.municipality || "").trim();
    const countryCode = String(row.iso_country || "").trim();
    const country = countryByCode[countryCode] || countryCode;
    const name = String(row.name || "").trim();
    const label = city ? `${city}, ${country}` : `${stripAirportName(name)}, ${country}`;
    const slug = countryCode && city
      ? `${countryCode.toLowerCase()}-${slugify(city)}`
      : "";

    byIata[iata] = {
      iata,
      name,
      city,
      country,
      countryCode,
      label,
      slug,
      type: row.type,
      scheduled: row.scheduled_service === "yes",
    };

    const cityKey = normalizeKey(city);
    if (cityKey) {
      const prev = cityBest.get(cityKey);
      if (!prev || sc > prev.score) cityBest.set(cityKey, { iata, score: sc });
    }
  }

  const aliases = {};
  const addAlias = (key, iata, force = false) => {
    const k = normalizeKey(key);
    if (!k || k.length < 2) return;
    if (!force && aliases[k] && aliases[k] !== iata) {
      // Garde l'existant si déjà mappé (évite écrasements aléatoires)
      return;
    }
    aliases[k] = iata;
  };

  for (const [iata, ap] of Object.entries(byIata)) {
    addAlias(iata, iata, true);
    if (ap.city) addAlias(ap.city, iata, true);
    addAlias(stripAirportName(ap.name), iata);
    const cityKey = normalizeKey(ap.city);
    const best = cityBest.get(cityKey);
    if (best?.iata === iata) addAlias(ap.city, iata, true);
  }

  // Keywords OurAirports
  for (const row of airportRows) {
    const iata = String(row.iata_code || "").trim().toUpperCase();
    if (!byIata[iata]) continue;
    const kw = String(row.keywords || "").split(",").map((k) => k.trim()).filter(Boolean);
    for (const k of kw) addAlias(k, iata);
  }

  // Alias FR → meilleur aéroport de la ville EN
  for (const [fr, enKey] of Object.entries(FR_CITY_ALIASES)) {
    const target = normalizeKey(enKey);
    const best = cityBest.get(target);
    if (best) aliases[normalizeKey(fr)] = best.iata;
  }

  // Hubs multi-aéroports : défaut explicite
  const hubDefaults = {
    paris: "CDG",
    london: "LHR",
    "new york": "JFK",
    "los angeles": "LAX",
    rome: "FCO",
    milan: "MXP",
    tokyo: "HND",
    moscow: "SVO",
    beijing: "PEK",
    shanghai: "PVG",
    istanbul: "IST",
    bangkok: "BKK",
    dubai: "DXB",
    singapore: "SIN",
    noumea: "NOU",
    nouméa: "NOU",
  };
  for (const [city, iata] of Object.entries(hubDefaults)) {
    if (byIata[iata]) aliases[city] = iata;
  }

  const payload = {
    version: 1,
    source: "OurAirports (public domain)",
    generatedAt: new Date().toISOString(),
    airportCount: Object.keys(byIata).length,
    aliasCount: Object.keys(aliases).length,
    byIata,
    aliases,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload));

  const stat = await fs.stat(OUT);
  console.log(
    `✓ ${OUT}\n  ${payload.airportCount} aéroports IATA · ${payload.aliasCount} alias · ${(stat.size / 1024 / 1024).toFixed(2)} Mo`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
