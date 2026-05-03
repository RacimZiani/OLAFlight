import { createLogger } from "../logger.js";

const log = createLogger("http:error");

// Erreurs métier qu'on lève volontairement avec un code HTTP donné.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg, details) => new HttpError(404, msg, details);
export const forbidden = (msg, details) => new HttpError(403, msg, details);

// 404 handler — placé après toutes les routes /api.
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: `Endpoint introuvable : ${req.method} ${req.path}` });
  }
  next();
}

// Centralisé : log + JSON cohérent.
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) {
    log.error(`${req.method} ${req.path} → ${status}: ${err.message}`, {
      stack: err.stack?.split("\n").slice(0, 3).join(" | "),
    });
  } else {
    log.warn(`${req.method} ${req.path} → ${status}: ${err.message}`);
  }
  res.status(status).json({
    error: err.message || "Erreur inconnue",
    ...(err.details ? { details: err.details } : {}),
  });
}
