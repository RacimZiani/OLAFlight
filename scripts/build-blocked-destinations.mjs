#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBlockedDestinations } from "../src/lib/fetchBlockedDestinations.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/blocked-destinations.json");

const out = await fetchBlockedDestinations();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`✓ ${OUT}`);
console.log(`  ${out.countryCodes.length} pays bloqués (US State Dept L3+L4 + extras Ola)`);
if (out.unresolved?.length) {
  console.warn(`  ⚠ ${out.unresolved.length} entrées RSS non résolues`);
  out.unresolved.slice(0, 8).forEach((u) => console.warn("   -", u.title));
}
