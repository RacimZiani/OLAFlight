// Test direct du scraper Google Flights.
// Usage: node scripts/probe-gflights.js CDG MAD 2026-06-15 [retour]
import path from "node:path";
import fs from "node:fs/promises";

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.resolve(process.cwd(), ".playwright-browsers");
process.env.LOG_PRETTY = process.env.LOG_PRETTY || "true";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "debug";

const { scrapeGoogleFlights } = await import("../src/lib/scraper.js");

const [, , from = "CDG", to = "MAD", depart = "2026-06-15", ret = ""] = process.argv;

console.log(`probe → ${from}→${to} ${depart}${ret ? ` / ${ret}` : ""}`);
const t0 = Date.now();
const offers = await scrapeGoogleFlights({
  from,
  to,
  depart,
  ret,
  adults: 1,
  limit: 6,
});
console.log(`done in ${Date.now() - t0}ms, ${offers.length} offers`);
for (const o of offers) {
  console.log(`  · ${o.price} ${o.currency} · ${o.meta?.airline || "?"} · ${o.meta?.duration || "?"} · ${o.meta?.stops != null ? `${o.meta.stops} esc.` : "?"} · ${o.url.slice(0, 80)}…`);
}
