import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "public/index.html");
let h = fs.readFileSync(p, "utf8");
const start = h.indexOf("<!-- ═══════════ I18N FR / EN ═══════════ -->");
const end = h.indexOf("<!-- ═══════════ CHATBOT FLOTTANT");
if (start < 0 || end < 0) throw new Error("markers not found");
h = h.slice(0, start) + '<script src="/i18n.js"></script>\n\n' + h.slice(end);
fs.writeFileSync(p, h);
console.log("✓ index.html patched");
