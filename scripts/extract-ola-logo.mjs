// OBSOLÈTE (16/11/2026) : le logo des PDF vient désormais de public/assets/ola-logo-blanc.png
// (texte blanc, fond transparent), embarqué dans src/lib/olaLogo.js. Ce script extrayait l'ancien
// logo JPEG à fond noir depuis index.html et écraserait la version actuelle : il ne fait plus rien.
console.error("Script obsolète : voir src/lib/olaLogo.js (source public/assets/ola-logo-blanc.png).");
process.exit(1);

/* Ancienne version, conservée pour mémoire :
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const m = html.match(/hero-logo-wrap[\s\S]*?<img src="(data:image\/png;base64,[^"]+)"/);
if (!m) throw new Error("Logo introuvable dans index.html");
const dataUri = m[1];
const b64 = dataUri.split(",")[1];
const outDir = path.join(root, "public/assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "ola-logo.png"), Buffer.from(b64, "base64"));
const js = `// Logo Ola Flight (PNG fond transparent) — généré par scripts/extract-ola-logo.mjs
export const OLA_LOGO_DATA_URI = ${JSON.stringify(dataUri)};
export const OLA_LOGO_PATH = "/assets/ola-logo.png";
`;
fs.writeFileSync(path.join(root, "src/lib/olaLogo.js"), js);
console.log("✓ public/assets/ola-logo.png");
console.log("✓ src/lib/olaLogo.js");

*/
