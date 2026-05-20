import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/i18n.js"), "utf8");
const m = src.match(/const I18N = (\{[\s\S]*?\n\});/);
const I18N = eval(`(${m[1]})`);
const fr = Object.keys(I18N.fr);
const en = Object.keys(I18N.en);
const onlyFr = fr.filter((k) => !I18N.en[k]);
const onlyEn = en.filter((k) => !I18N.fr[k]);
console.log("FR keys:", fr.length, "EN keys:", en.length);
if (onlyFr.length) console.log("Missing EN:", onlyFr);
if (onlyEn.length) console.log("Missing FR:", onlyEn);

const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const lines = html.split("\n");
const issues = [];
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (/data-i18n|script|style|svg|<!--|base64|viewBox|xmlns|d=\"M/i.test(L)) continue;
  if (/[àâäéèêëïîôùûüçœæ]/i.test(L) && />|</.test(L) && !/data-i18n/.test(L)) {
    issues.push(`${i + 1}: ${L.trim().slice(0, 140)}`);
  }
}
console.log("\nindex.html accent lines without data-i18n:", issues.length);
issues.forEach((x) => console.log(x));
