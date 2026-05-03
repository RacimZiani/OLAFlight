import crypto from "node:crypto";

// Vérifie la signature Meta `X-Hub-Signature-256: sha256=...` calculée sur
// le body brut JSON et signée avec META_APP_SECRET.
// On utilise `timingSafeEqual` pour éviter les attaques timing.
//
// Ce module est indépendant — il reçoit raw body + secret + header.
// L'app doit fournir un raw body parser sur les routes webhook.
export function verifyMetaSignature({ rawBody, signatureHeader, secret }) {
  if (!secret) return false; // pas de secret configuré → on refuse par défaut
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  if (expected.length !== computed.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}
