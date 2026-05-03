import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { hashPassword } from "../lib/passwords.js";
import { uid } from "../lib/ids.js";
import { createLogger } from "../logger.js";

const log = createLogger("seed");

// ─────────────────────────────────────────────────────────────────────────
// Crée le premier admin si la table users est vide.
// 3 sources possibles, dans l'ordre de priorité :
//   1. ADMIN_PASSWORD défini → crée avec ce mot de passe
//   2. .env vide → génère un mot de passe random + l'imprime UNE fois en log
//   3. Storage = json (legacy) → skip (pas de table users)
// ─────────────────────────────────────────────────────────────────────────

function genPassword() {
  // 16 caractères alphanumériques.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function seedAdminIfNeeded() {
  if (config.storage.driver === "json") {
    log.warn("storage=json : table users non disponible — auth désactivée. Passez en sqlite.");
    return;
  }
  const store = await getStore();
  if (!store.users) return;

  const existing = await store.users.list();
  if (existing.length > 0) return;

  const email = config.auth.seedEmail.toLowerCase();
  let password = config.auth.seedPassword;
  let generated = false;
  if (!password) {
    password = genPassword();
    generated = true;
  }

  const password_hash = await hashPassword(password);
  await store.users.insert({
    id: uid(),
    email,
    password_hash,
    role: "admin",
    display_name: config.auth.seedName,
    whatsapp: null,
    active: 1,
  });

  log.info("──────────────────────────────────────────────────");
  log.info("ADMIN INITIAL CRÉÉ");
  log.info(`  email    : ${email}`);
  if (generated) {
    log.info(`  password : ${password}    ⚠ NOTER MAINTENANT — ne sera plus affiché`);
  } else {
    log.info(`  password : (depuis ADMIN_PASSWORD env)`);
  }
  log.info("──────────────────────────────────────────────────");
}
