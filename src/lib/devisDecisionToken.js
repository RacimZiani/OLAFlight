import crypto from "node:crypto";
import { config } from "../config.js";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  return config.auth.jwtSecret || "ola-devis-decision-fallback";
}

export function signDevisDecisionToken(devisId, action) {
  const payload = {
    id: String(devisId),
    action: String(action),
    exp: Date.now() + TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyDevisDecisionToken(token, devisId, action) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return false;
    const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.id !== devisId || payload.action !== action) return false;
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildDecisionUrl(baseUrl, devisId, action) {
  const token = signDevisDecisionToken(devisId, action);
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}/api/public/devis/${encodeURIComponent(devisId)}/decision?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
}
