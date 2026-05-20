import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const h = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const keys = [
  ...h.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g),
].map((m) => m[1]);
const src = fs.readFileSync(path.join(root, "public/i18n.js"), "utf8");
const I18N = eval(`(${src.match(/const I18N = (\{[\s\S]*?\n\});/)[1]})`);
const uniq = [...new Set(keys)];
const miss = uniq.filter((k) => !I18N.fr[k] || !I18N.en[k]);
console.log("keys in html:", uniq.length);
if (miss.length) console.log("missing:", miss);
else console.log("all keys present in FR and EN");
