import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const tagRe = /<([a-z][a-z0-9]*)[^>]*>([^<]{3,})<\//gi;
const frWords = /\b(nous|vous|votre|notre|avec|pour|chez|devis|voyage|connexion|équipe|discuter|accepter|envoyer|prénom|confidentialité|mentions|légales|disponible|maintenant|conciergerie|coordonnées)\b/i;
let n = 0;
let m;
while ((m = tagRe.exec(body)) && n < 50) {
  const full = m[0];
  const text = m[2].replace(/&nbsp;/g, " ").trim();
  if (text.length < 4 || /^[\d\s©·]+$/.test(text)) continue;
  if (!frWords.test(text) && !/[àâäéèêëïîôùûüç]/i.test(text)) continue;
  if (/data-i18n/.test(full)) continue;
  // parent might have data-i18n in opening tag only on child
  console.log("?", text.slice(0, 80));
  n++;
}
