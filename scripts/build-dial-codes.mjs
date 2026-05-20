/**
 * Génère public/dial-codes.js — tous les indicatifs pays (REST Countries).
 * Usage: node scripts/build-dial-codes.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../public/dial-codes.js");

function dialFromIdd(idd) {
  if (!idd?.root) return null;
  const root = String(idd.root).replace(/\s/g, "");
  const suf = (idd.suffixes && idd.suffixes[0]) ? String(idd.suffixes[0]) : "";
  const full = `${root}${suf}`.replace(/\+{2,}/g, "+");
  if (!/^\+\d{1,4}$/.test(full)) return null;
  return full;
}

const res = await fetch(
  "https://restcountries.com/v3.1/all?fields=name,cca2,idd,flag"
);
if (!res.ok) throw new Error(`REST Countries HTTP ${res.status}`);
const countries = await res.json();

const rows = [];
for (const c of countries) {
  const dial = dialFromIdd(c.idd);
  if (!dial) continue;
  const name = c.name?.common || c.cca2;
  rows.push({
    iso: c.cca2,
    name,
    dial,
    flag: c.flag || "",
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name, "fr"));

// France en tête pour UX FR
const frIdx = rows.findIndex((r) => r.iso === "FR");
if (frIdx > 0) {
  const [fr] = rows.splice(frIdx, 1);
  rows.unshift(fr);
}

const js = `// Auto-généré — node scripts/build-dial-codes.mjs
// ${rows.length} indicatifs (REST Countries)
window.OLA_DIAL_CODES = ${JSON.stringify(rows, null, 0)};
`;

writeFileSync(OUT, js, "utf8");
console.log(`✓ ${OUT} (${rows.length} pays)`);
