// Probe la page résultats Google Flights et dump le DOM pour analyse.
import path from "node:path";
import fs from "node:fs/promises";

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.resolve(process.cwd(), ".playwright-browsers");

const { chromium } = await import("playwright");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
});
await ctx.addCookies([
  { name: "CONSENT", value: "YES+", domain: ".google.com", path: "/" },
]);
const page = await ctx.newPage();

const url =
  "https://www.google.com/travel/flights?tfs=CBwQARomEgoyMDI2LTA2LTE1agsIAhIHL20vMGszcHILCAMSBy9tLzBtZ3AaGmoLCAMSBy9tLzBtZ3ByCwgCEgcvbS8wazNwQAFIAXABggELCP___________wGYAQE&tfu=KgIIAw&hl=fr&curr=EUR";

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  () => /\d{2,5}\s?€|€\s?\d{2,5}/.test(document.body?.innerText || ""),
  { timeout: 60000 }
).catch(() => {});
await page.waitForTimeout(3000);

const snippet = await page.evaluate(() => {
  // Cherche tout élément qui contient un texte du type "12,34 €"
  const re = /(\d{2,5}\s?€|€\s?\d{2,5})/;
  const all = [];
  function visit(el, depth) {
    if (depth > 25 || !el) return;
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 600) {
      for (const c of el.children || []) visit(c, depth + 1);
      return;
    }
    if (re.test(t)) {
      // Garde le plus petit conteneur qui contient un prix
      let hasChildWithPrice = false;
      for (const c of el.children) {
        const ct = (c.innerText || "").trim();
        if (re.test(ct)) { hasChildWithPrice = true; break; }
      }
      if (!hasChildWithPrice) {
        all.push({
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 80),
          role: el.getAttribute("role"),
          text: t.slice(0, 200),
        });
      } else {
        for (const c of el.children) visit(c, depth + 1);
      }
    } else {
      for (const c of el.children) visit(c, depth + 1);
    }
  }
  visit(document.body, 0);
  return all.slice(0, 20);
});

console.log("PRICED_NODES:");
console.log(JSON.stringify(snippet, null, 2));

const html = await page.content();
await fs.writeFile("/tmp/gflights-results.html", html);
console.log("html → /tmp/gflights-results.html");

await browser.close();
