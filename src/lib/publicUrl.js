import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("public-url");

/** Hôtes invalides pour les liens clients (S3, bucket mort, etc.). */
const BAD_PUBLIC_URL_RE =
  /amazonaws\.com|\.s3[.-]|cloudfront\.net\/(?!ola)|NoSuchBucket/i;

export function isBadPublicUrl(url) {
  const u = String(url || "").trim();
  if (!u || !/^https?:\/\//i.test(u)) return true;
  return BAD_PUBLIC_URL_RE.test(u);
}

/**
 * Base URL pour liens PDF / notifs — priorité à la requête HTTP (Railway, olaflight.fr).
 */
export function resolvePublicBaseUrl(req) {
  if (req) {
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    const proto = String(req.get("x-forwarded-proto") || req.protocol || "https")
      .split(",")[0]
      .trim();
    if (host) {
      const derived = `${proto}://${host}`.replace(/\/$/, "");
      if (!isBadPublicUrl(derived)) return derived;
    }
  }

  const env = String(config.publicUrl || "").replace(/\/$/, "");
  if (env && !isBadPublicUrl(env)) return env;

  if (env && isBadPublicUrl(env)) {
    log.warn(
      `PUBLIC_URL invalide (${env}) — utilisez https://olaflight.fr ou laissez vide pour déduction auto`
    );
  }

  return env || `http://localhost:${config.port}`;
}

export function getPublicBaseUrlFromRequest(req) {
  return resolvePublicBaseUrl(req);
}

/** Chemin relatif stable (servi par GET /api/public/devis/:id/pdf). */
export function publicDevisPdfPath(devisId) {
  return `/api/public/devis/${encodeURIComponent(String(devisId))}/pdf`;
}

export function buildPublicDevisPdfUrl(devisId, context = {}) {
  const base = context.publicBaseUrl || resolvePublicBaseUrl(context.req);
  return `${base.replace(/\/$/, "")}${publicDevisPdfPath(devisId)}`;
}
