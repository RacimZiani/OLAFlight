import path from "node:path";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { makeId, safeJsonParse } from "./ids.js";

const log = createLogger("scrape");

// ─────────────────────────────────────────────────────────────
// Playwright écrit ses browsers dans .playwright-browsers/ (in-project,
// portable). On force la variable AVANT que playwright ne soit chargé.
// ─────────────────────────────────────────────────────────────
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = config.playwrightBrowsersDir;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Sec-Ch-Ua": '"Not)A;Brand";v="99", "Google Chrome";v="124", "Chromium";v="124"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  DNT: "1",
};

const AIRLINE_HINTS = [
  "Air France", "Air Côte d'Ivoire", "Air Cote d'Ivoire", "Brussels Airlines",
  "Turkish Airlines", "Lufthansa", "Royal Air Maroc", "Ethiopian Airlines",
  "Ethiopian", "KLM", "Iberia", "Qatar Airways", "Emirates", "ASKY", "Corsair",
  "TAP", "Air Algérie", "Tunisair", "Egyptair", "Delta", "United", "American",
  "British Airways",
];

const IATA_TO_CITY_SLUG = {
  COO: "bj-cotonou",
  CDG: "fr-paris",
  ORY: "fr-paris",
  PAR: "fr-paris",
  ABJ: "ci-abidjan",
  BRU: "be-brussels",
};

// ─────────────────────────────────────────────────────────────
// 1) Kayak via Playwright (source primaire — prix réels en EUR sur kayak.fr)
// ─────────────────────────────────────────────────────────────
export async function scrapeKayak({ from, to, depart, ret, limit, adults }) {
  const { chromium } = await import("playwright");

  const base = `https://www.kayak.fr/flights/${from}-${to}/${depart}${ret ? `/${ret}` : ""}`;
  const target = `${base}/${Math.max(1, adults || 1)}adults?sort=bestflight_a`;

  let browser;
  try {
    log.info(`launching chromium → ${target}`);
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7" },
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page
        .getByRole("button", { name: /accept all|agree|tout accepter|j'accepte/i })
        .first()
        .click({ timeout: 4000 });
    } catch {
      /* pas de bandeau cookies */
    }

    const priceInBody = () => {
      const t = document.body?.innerText || "";
      return /([$€£])\s?\d{2,5}|\d{2,5}\s?([$€£])/.test(t);
    };
    await page.waitForFunction(priceInBody, { timeout: 60000 }).catch(() => {});

    await page
      .waitForFunction(
        () => {
          const t = document.body?.innerText || "";
          const m = t.match(/(\d{1,3})\s*%\s*(complete|terminé|termin\u00e9)/i);
          if (!m) return true;
          return Number(m[1]) >= 95;
        },
        { timeout: 45000 }
      )
      .catch(() => {});

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 1.5);
      });
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(1500);

    const lines = await page.evaluate(() => {
      const out = [];
      const nodes = document.querySelectorAll(
        '[class*="result"], [data-resultid], [class*="Result"], li, article, div[role="article"], div[class*="nrc6"], div[class*="Fxw9"]'
      );
      for (const n of nodes) {
        const t = (n.innerText || "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 1500) continue;
        if (!/([$€£])\s?\d{2,5}|\d{2,5}\s?([$€£])/.test(t)) continue;
        out.push(t);
      }
      return out;
    });
    log.debug(`kayak lines: ${lines.length}`);

    await browser.close();
    browser = null;

    return parseKayakLines({ lines, target, from, to, depart, ret, limit });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    log.error(`kayak playwright: ${e?.message || e}`);
    return [];
  }
}

function parsePrice(raw) {
  const m1 = raw.match(/([$€£])\s?(\d{2,5})/);
  if (m1) {
    const sym = m1[1];
    return {
      price: Number(m1[2]),
      currency: sym === "€" ? "EUR" : sym === "£" ? "GBP" : "USD",
    };
  }
  const m2 = raw.match(/(\d{2,5})\s?([$€£])/);
  if (m2) {
    const sym = m2[2];
    return {
      price: Number(m2[1]),
      currency: sym === "€" ? "EUR" : sym === "£" ? "GBP" : "USD",
    };
  }
  return null;
}

function parseKayakLines({ lines, target, from, to, depart, ret, limit }) {
  // Groupe par prix+devise et garde l'entrée la plus "riche" (plus de signaux remplis).
  const byPrice = new Map();
  for (const raw of lines) {
    const parsed = parsePrice(raw);
    if (!parsed) continue;
    const { price, currency } = parsed;
    if (!price || price < 30 || price > 50000) continue;

    const airline =
      AIRLINE_HINTS.find((a) => raw.toLowerCase().includes(a.toLowerCase())) || null;

    const stopsMatch = raw.match(/(\d)\s*(?:escale|stop|arrêt)/i);
    const stops = stopsMatch
      ? Number(stopsMatch[1])
      : /sans\s?escale|\bnon[\s-]?stop|\bnonstop|\bdirect/i.test(raw)
        ? 0
        : null;

    const durationMatch = raw.match(/(\d{1,2})\s?h\s?(\d{1,2})?/);
    const duration = durationMatch
      ? `${durationMatch[1]}h${durationMatch[2] ? durationMatch[2].padStart(2, "0") : "00"}`
      : null;

    const signals = (airline ? 1 : 0) + (stops !== null ? 1 : 0) + (duration ? 1 : 0);
    const key = `${currency}:${price}`;
    const existing = byPrice.get(key);
    if (!existing || existing.signals < signals) {
      byPrice.set(key, { price, currency, airline, stops, duration, signals });
    }
  }

  const offers = [];
  for (const v of byPrice.values()) {
    offers.push({
      external_id: `kayak:${from}-${to}:${depart}:${ret || "ONEWAY"}:${v.currency}${v.price}`,
      title: `${from} → ${to}${ret ? " (A/R)" : " (Aller simple)"}`,
      url: target,
      price: v.price,
      currency: v.currency,
      route: {
        from,
        to,
        depart_date: depart,
        return_date: ret || null,
        trip_type: ret ? "ROUNDTRIP" : "ONEWAY",
      },
      location: "",
      image_url: null,
      source: "kayak",
      meta: { airline: v.airline, duration: v.duration, stops: v.stops },
    });
  }
  offers.sort((a, b) => (a.price || 0) - (b.price || 0));
  return offers.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// 2) Booking JSON + route page (Cheerio uniquement, plus rapide / pas de browser)
// ─────────────────────────────────────────────────────────────
function findItinerariesDeep(node) {
  const out = [];
  const seen = new Set();
  const isLikely = (x) => {
    if (!x || typeof x !== "object") return false;
    const hasPrice =
      "price" in x || "totalPrice" in x || "displayPrice" in x ||
      "pricing" in x || "priceBreakdown" in x;
    const hasLegs = Array.isArray(x.legs) || Array.isArray(x.legsInfo) || Array.isArray(x.segments);
    const hasId = typeof x.id === "string" || typeof x.itineraryId === "string";
    return Boolean((hasPrice && (hasLegs || hasId)) || (hasLegs && hasId));
  };
  function walk(v, depth) {
    if (depth > 10 || !v) return;
    if (Array.isArray(v)) { for (const it of v) walk(it, depth + 1); return; }
    if (typeof v !== "object") return;
    if (isLikely(v)) {
      const key = JSON.stringify(v).slice(0, 500);
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  }
  walk(node, 0);
  return out;
}

function pickFirst(obj, paths) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) { ok = false; break; }
      cur = cur[part];
    }
    if (ok && cur != null) return cur;
  }
  return null;
}

function normalizeBookingItinerary(it, { from, to, depart, ret, url }) {
  const currency =
    pickFirst(it, [
      "price.currency", "displayPrice.currency", "totalPrice.currency",
      "pricing.total.currency", "priceBreakdown.currency",
    ]) || "USD";

  const amountRaw =
    pickFirst(it, [
      "price.amount", "price.value", "displayPrice.amount", "displayPrice.value",
      "totalPrice.amount", "totalPrice.value", "pricing.total.amount", "pricing.total.value",
    ]) || null;
  const price = typeof amountRaw === "number"
    ? amountRaw
    : Number(String(amountRaw || "").replace(/[^\d.]/g, "")) || null;

  const legs = pickFirst(it, ["legs", "legsInfo", "segments"]) || [];
  const stopsCount = typeof it.stops === "number"
    ? it.stops
    : Array.isArray(legs) && legs.length ? Math.max(0, legs.length - 1) : null;

  const airline = pickFirst(it, [
    "marketingCarrier.name", "carrier.name", "airline.name", "airlines.0.name",
  ]) || null;

  const duration = pickFirst(it, [
    "duration", "totalDuration", "durationMinutes", "travelDuration",
  ]) || null;

  const title = `${String(from).toUpperCase()} → ${String(to).toUpperCase()}${ret ? " (A/R)" : " (Aller simple)"}`;
  const location = `Départ ${depart}${ret ? ` • Retour ${ret}` : ""}${airline ? ` • ${airline}` : ""}${
    stopsCount != null ? ` • ${stopsCount} escale${stopsCount > 1 ? "s" : ""}` : ""
  }`;

  return {
    external_id: `${url}#${it.id || it.itineraryId || makeId(JSON.stringify(it).slice(0, 200))}`,
    title,
    url,
    price,
    currency,
    route: {
      from: String(from).toUpperCase(),
      to: String(to).toUpperCase(),
      depart_date: depart,
      return_date: ret || null,
      trip_type: ret ? "ROUNDTRIP" : "ONEWAY",
    },
    location,
    image_url: null,
    source: "booking.com",
    meta: { airline, duration, stops: stopsCount },
  };
}

export async function scrapeBooking({ from, to, depart, ret, limit, adults, fromSlug, toSlug }) {
  const tripType = ret ? "ROUNDTRIP" : "ONEWAY";
  const base = `https://flights.booking.com/flights/${from}-${to}/`;
  const qs = new URLSearchParams({
    type: tripType,
    adults: String(adults),
    cabinClass: "ECONOMY",
    from,
    to,
    depart,
    sort: "BEST",
    locale: "fr-fr",
  });
  if (ret) qs.set("return", ret);
  const url = `${base}?${qs.toString()}`;

  const resp = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Referer: "https://www.google.com/" },
    redirect: "follow",
  });
  const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
  const raw = await resp.text();
  const $ = cheerio.load(raw);

  const offers = [];
  const seen = new Set();

  // (a) JSON direct si l'endpoint répond JSON.
  if (contentType.includes("application/json")) {
    const parsed = safeJsonParse(raw);
    if (parsed) {
      const candidates = findItinerariesDeep(parsed);
      for (const it of candidates.slice(0, limit * 4)) {
        const n = normalizeBookingItinerary(it, { from, to, depart, ret, url });
        if (n && !seen.has(n.external_id)) {
          seen.add(n.external_id); offers.push(n);
          if (offers.length >= limit) break;
        }
      }
    }
  }

  // (b) __NEXT_DATA__ embedded dans la SPA.
  const nextDataRaw = $('script[id="__NEXT_DATA__"]').first().text().trim();
  if (offers.length < limit && nextDataRaw) {
    const nextData = safeJsonParse(nextDataRaw);
    if (nextData) {
      const candidates = findItinerariesDeep(nextData);
      for (const it of candidates.slice(0, limit * 4)) {
        const n = normalizeBookingItinerary(it, { from, to, depart, ret, url });
        if (n && !seen.has(n.external_id)) {
          seen.add(n.external_id); offers.push(n);
          if (offers.length >= limit) break;
        }
      }
    }
  }

  // (c) Page route SSR sur www.booking.com (anchors → prix dans le bloc parent).
  if (offers.length === 0 && fromSlug && toSlug) {
    const routeUrl = ret
      ? `https://www.booking.com/flights/route/city-to-city/${fromSlug}-to-${toSlug}/${depart}/${ret}.html?prefer_site_type=mdot`
      : `https://www.booking.com/flights/route/city-to-city/${fromSlug}-to-${toSlug}/${depart}.html?prefer_site_type=mdot`;
    const routeHtml = await fetch(routeUrl, {
      headers: { ...BROWSER_HEADERS, Referer: "https://www.google.com/" },
      redirect: "follow",
    }).then((r) => r.text()).catch(() => "");

    if (routeHtml) {
      const $$ = cheerio.load(routeHtml);
      const seenHref = new Set();
      $$('a[href*="flights.booking.com/flights/"]').each((_i, a) => {
        const href = String($$(a).attr("href") || "").trim();
        if (!href || seenHref.has(href)) return;
        seenHref.add(href);
        const block = $$(a).closest("li, article, div, section").text().replace(/\s+/g, " ").trim();
        const priceMatch = block.match(/([$€£])\s?(\d[\d,]*)(\.\d{2})?/);
        const sym = priceMatch ? priceMatch[1] : null;
        const priceNum = priceMatch
          ? Number(`${priceMatch[2]}${priceMatch[3] || ""}`.replace(/,/g, "")) || null
          : null;
        let currency = "USD";
        if (sym === "€") currency = "EUR";
        if (sym === "£") currency = "GBP";
        offers.push({
          external_id: href,
          title: `${from} → ${to}${ret ? " (A/R)" : " (Aller simple)"}`,
          url: href,
          price: priceNum,
          currency,
          route: {
            from: String(from).toUpperCase(),
            to: String(to).toUpperCase(),
            depart_date: depart,
            return_date: ret || null,
            trip_type: ret ? "ROUNDTRIP" : "ONEWAY",
          },
          location: block.slice(0, 180) || `Départ ${depart}${ret ? ` • Retour ${ret}` : ""}`,
          image_url: null,
          source: "booking.com",
          meta: {},
        });
      });
    }
  }

  return {
    offers: offers.slice(0, limit),
    debug: {
      fetched_url: url,
      status: resp.status,
      content_type: contentType || null,
      title: $("title").first().text().trim().slice(0, 140) || null,
      from_slug: fromSlug || IATA_TO_CITY_SLUG[from] || null,
      to_slug: toSlug || IATA_TO_CITY_SLUG[to] || null,
    },
  };
}

export { IATA_TO_CITY_SLUG };
