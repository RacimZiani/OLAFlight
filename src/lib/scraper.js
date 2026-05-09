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
// 1) Google Flights via Playwright (source primaire — prix réels en EUR)
// On pilote directement le formulaire (le param ?q= ouvre la home, pas la recherche).
// ─────────────────────────────────────────────────────────────
function dateToFrInput(yyyymmdd) {
  // "2026-06-15" → "15/06/2026" (format input Google Flights FR)
  const m = String(yyyymmdd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return yyyymmdd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function pickComboSuggestion(page, exactAriaLabel, dialogAriaLabel, value) {
  // Ouvre l'input combobox identifié par son aria-label, écrase la valeur,
  // attend la liste d'options dans le dialog "Saisir votre ..." et clique la première.
  // On matche en "starts with" pour tolérer les espaces de fin (ex: aria-label="À ").
  const sel = `input[aria-label^="${exactAriaLabel}"]`;
  const input = page.locator(sel).first();
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.click({ timeout: 4000 });
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Delete").catch(() => {});
  await input.fill("", { timeout: 2000 }).catch(() => {});
  await page.keyboard.type(value, { delay: 70 });
  await page.waitForTimeout(1000);
  const dialogSel = `[role="dialog"][aria-label="${dialogAriaLabel}"]`;
  const option = page
    .locator(`${dialogSel} li[role="option"]`)
    .or(page.locator('li[role="option"]'))
    .first();
  try {
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click({ timeout: 2500 });
  } catch {
    await page.keyboard.press("Enter").catch(() => {});
  }
}

export async function scrapeGoogleFlights({ from, to, depart, ret, limit, adults }) {
  // Stealth via playwright-extra + puppeteer-extra-plugin-stealth.
  const { chromium: chromiumBase } = await import("playwright");
  let chromium = chromiumBase;
  try {
    const { chromium: stealthChromium } = await import("playwright-extra");
    const stealthMod = await import("puppeteer-extra-plugin-stealth");
    const stealth = stealthMod.default ? stealthMod.default() : stealthMod();
    stealthChromium.use(stealth);
    chromium = stealthChromium;
  } catch (e) {
    log.warn(`stealth init failed (ok, fallback playwright): ${e?.message || e}`);
  }

  const target = "https://www.google.com/travel/flights?hl=fr&curr=EUR";

  let browser;
  try {
    log.info(`launching chromium (google flights) → ${target}`);
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

    // Pré-injecter les cookies de consentement Google (UE) pour court-circuiter l'écran consent.
    await context.addCookies([
      { name: "CONSENT", value: "YES+", domain: ".google.com", path: "/" },
      { name: "SOCS", value: "CAESHAgBEhJnd3NfMjAyNDA1MDgtMF9SQzIaAmZyIAEaBgiAg6OvBg", domain: ".google.com", path: "/" },
    ]);

    // Patches anti-fingerprinting (stealth maison) — appliqués avant le 1er document.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      window.chrome = { runtime: {}, app: {}, csi: () => ({}), loadTimes: () => ({}) };
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      }
    });

    const page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (/consent\.google\.com/.test(page.url())) {
      await page
        .evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
          const re = /tout accepter|accept all|j'accepte|i agree/i;
          const hit = btns.find((b) => re.test((b.innerText || b.value || "").trim()));
          if (hit) hit.click();
        })
        .catch(() => {});
      await page.waitForURL(/\/travel\/flights/i, { timeout: 15000 }).catch(() => {});
    }

    // Bandeau cookies inline
    try {
      await page
        .getByRole("button", { name: /tout accepter|accept all|j'accepte|i agree/i })
        .first()
        .click({ timeout: 3000 });
    } catch {
      /* pas de bandeau */
    }

    await page.waitForTimeout(1000);

    // Type de voyage : si aller simple, basculer sur "Aller simple".
    let oneWaySelected = false;
    if (!ret) {
      try {
        // Le combobox affiche le label courant ("Aller-retour" par défaut).
        const tripBtn = page
          .locator('[role="combobox"]:has-text("Aller-retour"), [role="combobox"]:has-text("Round trip"), button:has-text("Aller-retour")')
          .first();
        await tripBtn.waitFor({ state: "visible", timeout: 6000 });
        await tripBtn.click({ timeout: 4000 });
        const opt = page
          .locator('li[role="option"]:has-text("Aller simple"), [role="option"]:has-text("One way")')
          .first();
        await opt.waitFor({ state: "visible", timeout: 4000 });
        await opt.click({ timeout: 3000 });
        oneWaySelected = true;
        await page.waitForTimeout(400);
      } catch (e) {
        log.warn(`google flights: trip-type switch failed: ${e?.message || e}`);
      }
    }

    // Origine / Destination
    await pickComboSuggestion(page, "De", "Saisir votre point de départ", from);
    await page.waitForTimeout(700);
    await pickComboSuggestion(page, "À", "Saisir votre destination", to);
    await page.waitForTimeout(900);

    // Dates : input aria-label "Départ" / "Retour" (format JJ/MM/AAAA)
    const fillDate = async (exactAriaLabel, value) => {
      const sel = `input[aria-label="${exactAriaLabel}"]`;
      const input = page.locator(sel).first();
      await input.waitFor({ state: "visible", timeout: 10000 });
      await input.click({ timeout: 4000 });
      await page.keyboard.press("Meta+A").catch(() => {});
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Delete").catch(() => {});
      await input.fill("", { timeout: 2000 }).catch(() => {});
      await page.keyboard.type(dateToFrInput(value), { delay: 40 });
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(500);
    };

    try {
      await fillDate("Départ", depart);
    } catch (e) {
      log.warn(`google flights: depart date input failed: ${e?.message || e}`);
    }
    if (ret) {
      try {
        await fillDate("Retour", ret);
      } catch (e) {
        log.warn(`google flights: return date input failed: ${e?.message || e}`);
      }
    }

    // Refermer le picker
    try {
      await page
        .getByRole("button", { name: /^ok$|^terminé$|^done$/i })
        .first()
        .click({ timeout: 2000 });
    } catch {
      /* pas de bouton OK */
    }

    // Lancer la recherche
    try {
      const searchBtn = page
        .locator('button[aria-label*="Rechercher des vols" i]')
        .or(page.getByRole("button", { name: /^rechercher$|^search$/i }))
        .first();
      await searchBtn.click({ timeout: 6000 });
    } catch {
      await page.keyboard.press("Enter").catch(() => {});
    }

    // Attendre la bascule sur la page résultats (l'URL devient /travel/flights?tfs=...)
    await page.waitForURL(/[?&]tfs=/i, { timeout: 30000 }).catch(() => {});
    log.debug(`google flights after search → ${page.url()}`);

    if (!/[?&]tfs=/i.test(page.url())) {
      log.warn("google flights: search URL did not include tfs= (form submit failed?)");
    }

    // Au lieu de scroller (qui peut déclencher des heuristiques anti-bot), on attend
    // simplement l'apparition des cartes vol via un h3 / un texte "Meilleurs vols".
    await page
      .waitForFunction(
        () => {
          const t = document.body?.innerText || "";
          return /meilleurs (?:vols|résultats)|best departing|cheapest|vols les moins chers|other departing flights|autres vols/i.test(t);
        },
        { timeout: 45000 }
      )
      .catch(() => {});

    // Petit délai pour laisser les prix se stabiliser
    await page.waitForTimeout(2500);

    const finalUrl = page.url();
    const lines = await page.evaluate(() => {
      const re = /\d{2,5}\s?€|€\s?\d{2,5}/;
      const out = [];
      const seen = new Set();
      // Approche générique : tout élément qui contient un prix et n'a pas
      // d'enfant contenant déjà un prix (= conteneur "carte vol" minimal).
      const all = document.querySelectorAll('div, li, article, section');
      for (const n of all) {
        const t = (n.innerText || "").replace(/\s+/g, " ").trim();
        if (!t || t.length < 25 || t.length > 1500) continue;
        if (!re.test(t)) continue;
        let hasPricedChild = false;
        for (const c of n.children) {
          const ct = (c.innerText || "").trim();
          if (re.test(ct)) { hasPricedChild = true; break; }
        }
        if (hasPricedChild) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= 60) break;
      }
      return out;
    });
    log.debug(`google flights lines: ${lines.length} (url=${finalUrl})`);

    if (process.env.GFLIGHTS_DEBUG_DUMP) {
      try {
        const fs = await import("node:fs/promises");
        await fs.writeFile("/tmp/gflights-final.html", await page.content());
        await page.screenshot({ path: "/tmp/gflights-final.png", fullPage: true });
        log.debug("google flights debug dump → /tmp/gflights-final.html|.png");
      } catch (e) {
        log.warn(`debug dump failed: ${e?.message || e}`);
      }
    }

    await browser.close();
    browser = null;

    return parseFlightLines({
      lines,
      target: finalUrl,
      from,
      to,
      depart,
      ret,
      limit,
      source: "google_flights",
      idPrefix: "gflights",
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    log.error(`google flights playwright: ${e?.message || e}`);
    return [];
  }
}

// Compat ascendante: ancien nom utilisé dans olaAgentTools.js / admin.js / tests.
export const scrapeKayak = scrapeGoogleFlights;

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

function parseFlightLines({
  lines,
  target,
  from,
  to,
  depart,
  ret,
  limit,
  source = "google_flights",
  idPrefix = "gflights",
}) {
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
      external_id: `${idPrefix}:${from}-${to}:${depart}:${ret || "ONEWAY"}:${v.currency}${v.price}`,
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
      source,
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
