import { createLogger } from "../logger.js";

const log = createLogger("http");

// Log compact par requête (méthode, path, status, durée).
export function requestLogger(req, res, next) {
  if (!req.path.startsWith("/api/")) return next(); // on log uniquement les routes API
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const line = `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`;
    if (res.statusCode >= 500) log.error(line);
    else if (res.statusCode >= 400) log.warn(line);
    else log.info(line);
  });
  next();
}
