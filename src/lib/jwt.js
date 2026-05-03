import jwt from "jsonwebtoken";
import { config } from "../config.js";

const ISSUER = "ola-flight";

export function signSession(user) {
  if (!config.auth.jwtSecret) throw new Error("JWT_SECRET non configuré");
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.display_name || null,
  };
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.sessionTtl,
    issuer: ISSUER,
  });
}

export function verifySession(token) {
  if (!token || !config.auth.jwtSecret) return null;
  try {
    return jwt.verify(token, config.auth.jwtSecret, { issuer: ISSUER });
  } catch {
    return null;
  }
}
