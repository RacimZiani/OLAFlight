import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain || ""), ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(String(plain), String(hash));
  } catch {
    return false;
  }
}

// Vérifie qu'un mot de passe est "raisonnable" — pas une politique stricte,
// juste un garde-fou pour ne pas accepter "1234".
export function isReasonablePassword(s) {
  return typeof s === "string" && s.length >= 8;
}
