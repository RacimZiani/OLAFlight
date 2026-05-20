/**
 * Construit la liste des destinations bloquées depuis sources publiques.
 * @returns {Promise<object>} blocked-destinations.json payload
 */

export const BLOCKED_SOURCES = {
  usRss: "https://travel.state.gov/_res/rss/TAsTWs.xml",
  countriesCsv:
    "https://raw.githubusercontent.com/stefangabos/world_countries/master/data/countries/en/countries.csv",
};

const BLOCK_LEVELS = new Set([3, 4]);

export const OLA_EXTRA_COUNTRY_CODES = ["PS"];
export const OLA_EXTRA_PLACES = [
  "gaza",
  "bande de gaza",
  "rafah",
  "kiev",
  "kyiv",
  "crimee",
  "donetsk",
  "luhansk",
  "marioupol",
  "sebastopol",
  "sevastopol",
  "simferopol",
  "new caledonia",
];

const TITLE_TO_ALPHA2 = {
  burma: "MM",
  russia: "RU",
  myanmar: "MM",
  "new caledonia": "NC",
  "burkina faso": "BF",
  "cote d ivoire": "CI",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  "the gambia": "GM",
  "north korea": "KP",
  "south sudan": "SS",
  "west bank and gaza": "PS",
  "israel the west bank and gaza": "PS",
  "israel, the west bank and gaza": "PS",
  "hong kong sar": "HK",
  macau: "MO",
  taiwan: "TW",
  "trinidad and tobago": "TT",
  "bosnia and herzegovina": "BA",
  "costa rica": "CR",
  "el salvador": "SV",
  "saudi arabia": "SA",
  "sri lanka": "LK",
  "timor-leste": "TL",
  ukraine: "UA",
  venezuela: "VE",
  haiti: "HT",
  lebanon: "LB",
  iran: "IR",
  iraq: "IQ",
  syria: "SY",
  yemen: "YE",
  sudan: "SD",
  somalia: "SO",
  afghanistan: "AF",
  belarus: "BY",
  cuba: "CU",
  nicaragua: "NI",
  pakistan: "PK",
};

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "OlaFlight-blocked-build/1.0 (+https://olaflight.fr)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

function parseCsvLine(line) {
  const parts = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseCountriesCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const byNorm = new Map();
  for (const line of lines) {
    const parts = parseCsvLine(line);
    if (parts.length < 4) continue;
    const alpha2 = parts[1].toUpperCase();
    const name = parts[3].trim();
    byNorm.set(normalizeName(name), { alpha2, name });
    const short = normalizeName(name.split(",")[0]);
    if (short) byNorm.set(short, { alpha2, name });
  }
  return byNorm;
}

function resolveCountryName(titleCountry, byNorm) {
  const key = normalizeName(titleCountry);
  if (TITLE_TO_ALPHA2[key]) {
    return { alpha2: TITLE_TO_ALPHA2[key], name: titleCountry };
  }
  if (byNorm.has(key)) return byNorm.get(key);
  const first = key.split(" and ")[0].trim();
  if (byNorm.has(first)) return byNorm.get(first);
  for (const [norm, entry] of byNorm) {
    if (norm.length >= 5 && (key.includes(norm) || norm.includes(key))) return entry;
  }
  return null;
}

function parseUsTravelRss(xml, byNorm) {
  const entries = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let block;
  while ((block = itemRe.exec(xml))) {
    const item = block[1];
    const titleM = item.match(/<title>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/title>/i);
    if (!titleM) continue;
    const title = titleM[1].trim();
    const levelM = title.match(/^(.+?)\s*-\s*Level\s*([1-4])\s*:/i);
    if (!levelM) continue;
    const level = Number(levelM[2]);
    if (!BLOCK_LEVELS.has(level)) continue;
    const countryPart = levelM[1].trim();
    const resolved = resolveCountryName(countryPart, byNorm);
    entries.push({
      source: "us_state_dept",
      level,
      title,
      countryName: countryPart,
      alpha2: resolved?.alpha2 || null,
    });
  }
  return entries;
}

export async function fetchBlockedDestinations() {
  const countriesCsv = await fetchText(BLOCKED_SOURCES.countriesCsv);
  const byNorm = parseCountriesCsv(countriesCsv);
  const rss = await fetchText(BLOCKED_SOURCES.usRss);
  const usEntries = parseUsTravelRss(rss, byNorm);

  const countryMap = new Map();
  const unresolved = [];

  for (const e of usEntries) {
    if (!e.alpha2) {
      unresolved.push(e);
      continue;
    }
    const code = e.alpha2.toUpperCase();
    const prev = countryMap.get(code);
    if (!prev || e.level > prev.level) {
      countryMap.set(code, {
        code,
        name: e.countryName,
        level: e.level,
        source: e.source,
        advisoryTitle: e.title,
      });
    }
  }

  for (const code of OLA_EXTRA_COUNTRY_CODES) {
    if (!countryMap.has(code)) {
      countryMap.set(code, {
        code,
        name: code,
        level: 4,
        source: "ola_extra",
        advisoryTitle: "Ola Flight policy",
      });
    }
  }

  const countries = [...countryMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  const countryCodes = countries.map((c) => c.code);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    policy:
      "Block US State Dept Level 3 (Reconsider Travel) and Level 4 (Do Not Travel), plus Ola extras.",
    sources: [
      { id: "us_state_dept_rss", url: BLOCKED_SOURCES.usRss, levels: [3, 4] },
      { id: "ola_extra", countryCodes: OLA_EXTRA_COUNTRY_CODES, places: OLA_EXTRA_PLACES },
    ],
    countryCodes,
    countries,
    places: [...OLA_EXTRA_PLACES],
    countryNames: countries.map((c) => normalizeName(c.name)).filter(Boolean),
    unresolved: unresolved.map((u) => ({ title: u.title, countryName: u.countryName })),
    stats: {
      blockedCountries: countryCodes.length,
      usEntriesParsed: usEntries.length,
      unresolvedCount: unresolved.length,
    },
  };
}
