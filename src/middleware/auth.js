import { config } from "../config.js";
import { verifySession } from "../lib/jwt.js";

// ─────────────────────────────────────────────────────────────────────────
// Auth runtime : on attache `req.user = { id, email, role, name }` à chaque
// requête en lisant le cookie de session JWT. Fallback : header X-Admin-Token
// (legacy compat) en attendant la suppression du header X-Admin-Token.
//
// Rôles : admin | dalsim | closeuse | agent | guest
// ─────────────────────────────────────────────────────────────────────────

function readCookieToken(req) {
  // cookieParser middleware fournit req.cookies. Si pas branché, on parse à la main.
  if (req.cookies && req.cookies[config.auth.cookieName]) {
    return req.cookies[config.auth.cookieName];
  }
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${config.auth.cookieName}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export function attachUser(req, _res, next) {
  // 1) JWT cookie (prod path).
  const token = readCookieToken(req);
  if (token) {
    const claims = verifySession(token);
    if (claims) {
      req.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        name: claims.name || null,
        source: "jwt",
      };
      return next();
    }
  }

  // 2) Legacy X-Admin-Token (déprécié).
  const legacy = String(req.header("X-Admin-Token") || "").trim();
  if (legacy && config.auth.legacyAdminTokens.includes(legacy)) {
    req.user = { id: null, email: null, role: "admin", name: null, source: "legacy-token" };
    return next();
  }

  req.user = { id: null, email: null, role: "guest", name: null, source: null };
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user || req.user.role === "guest") {
    return res.status(401).json({ error: "Authentification requise" });
  }
  next();
}

export function requireRole(...allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    if (!req.user || req.user.role === "guest") {
      return res.status(401).json({ error: "Authentification requise" });
    }
    if (!set.has(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé pour le rôle '${req.user.role}'` });
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");
export const requireDalsim = requireRole("admin", "dalsim");
export const requireBackoffice = requireRole("admin", "dalsim", "closeuse");
