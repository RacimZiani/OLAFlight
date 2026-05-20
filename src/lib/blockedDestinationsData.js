// Charge / rafraîchit data/blocked-destinations.json (US State Dept + extras Ola).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const log = {
  info: (m) => console.log(`[blocked-data] ${m}`),
  warn: (m) => console.warn(`[blocked-data] ${m}`),
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "../../data/blocked-destinations.json");

const FALLBACK = {
  countryCodes: ["UA", "RU", "BY", "SY", "IR", "KP", "CU", "AF", "IQ", "YE", "SD", "SS", "PS"],
  places: ["gaza", "kiev", "kyiv", "rafah"],
  countryNames: ["ukraine", "russia", "gaza"],
  countries: [],
};

/** @type {ReturnType<typeof buildIndex> | null} */
let _cache = null;

function buildIndex(data) {
  const countries = data.countries || [];
  const nameKeys = new Set([
    ...(data.countryNames || []),
    ...countries.map((c) =>
      String(c.name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    ),
  ]);
  return {
    countryCodes: new Set((data.countryCodes || []).map((c) => String(c).toUpperCase())),
    places: [...(data.places || [])],
    countryNames: nameKeys,
    countries,
    meta: {
      generatedAt: data.generatedAt,
      policy: data.policy,
      stats: data.stats,
    },
  };
}

function loadFromDisk() {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch (e) {
    log.warn(`blocked-destinations.json indisponible (${e.message}) — fallback minimal`);
    return FALLBACK;
  }
}

export function getBlockedDestinationsIndex() {
  if (!_cache) _cache = buildIndex(loadFromDisk());
  return _cache;
}

export function invalidateBlockedCache() {
  _cache = null;
}

/** Rafraîchit depuis US State Dept RSS si le fichier a plus de maxAgeDays jours. */
export async function refreshBlockedDestinationsIfStale(maxAgeDays = 7) {
  const data = loadFromDisk();
  const generatedAt = data.generatedAt ? Date.parse(data.generatedAt) : 0;
  const ageMs = Date.now() - generatedAt;
  const maxMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (generatedAt && ageMs < maxMs) {
    log.info(
      `liste destinations bloquées : ${data.countryCodes?.length || 0} pays (âge ${Math.round(ageMs / 86400000)} j)`
    );
    return false;
  }

  log.info("liste destinations bloquées périmée — fetch US State Dept RSS…");
  try {
    const { fetchBlockedDestinations } = await import("./fetchBlockedDestinations.mjs");
    const out = await fetchBlockedDestinations();
    writeFileSync(DATA_PATH, JSON.stringify(out, null, 2), "utf8");
    invalidateBlockedCache();
    log.info(`liste mise à jour : ${out.countryCodes.length} pays`);
    return true;
  } catch (e) {
    log.warn(`refresh blocked list: ${e.message}`);
    return false;
  }
}

export function getBlockedDataPath() {
  return DATA_PATH;
}
