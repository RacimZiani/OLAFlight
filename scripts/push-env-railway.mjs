#!/usr/bin/env node
/**
 * Pousse le fichier .env local vers les variables du service Railway lié (`railway link`).
 * Les valeurs ne sont pas affichées (stdin par variable).
 *
 * Prérequis : `npx @railway/cli login` puis `railway link` à la racine du repo.
 *
 * Usage :
 *   node scripts/push-env-railway.mjs https://ton-service.up.railway.app
 *   RAILWAY_PUBLIC_URL=https://... node scripts/push-env-railway.mjs
 *
 * Notes :
 *   - PORT n'est pas envoyé : Railway injecte process.env.PORT.
 *   - NODE_ENV=production, COOKIE_SECURE=true, LOG_PRETTY=false, PUBLIC_URL=<argument> sont forcés.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

function parseEnvFile(raw) {
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    const hashIdx = value.search(/\s+#(?:\s|$)/);
    if (hashIdx !== -1 && !/^["']/.test(value)) {
      value = value.slice(0, hashIdx).trim();
    }
    if (key) map.set(key, value);
  }
  return map;
}

function railway(args, stdin) {
  return spawnSync("npx", ["--yes", "@railway/cli", ...args], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    input: stdin,
    cwd: ROOT,
  });
}

const publicUrl = (process.argv[2] || process.env.RAILWAY_PUBLIC_URL || "").trim().replace(/\/$/, "");
if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
  console.error("Indique l’URL publique HTTPS du service Railway, par exemple :");
  console.error("  node scripts/push-env-railway.mjs https://olaflight-production-xxxx.up.railway.app");
  console.error("ou : RAILWAY_PUBLIC_URL=https://... node scripts/push-env-railway.mjs");
  process.exit(1);
}

if (!fs.existsSync(ENV_PATH)) {
  console.error("Fichier .env introuvable :", ENV_PATH);
  process.exit(1);
}

const map = parseEnvFile(fs.readFileSync(ENV_PATH, "utf8"));
map.delete("PORT");
map.set("NODE_ENV", "production");
map.set("COOKIE_SECURE", "true");
map.set("PUBLIC_URL", publicUrl);
map.set("LOG_PRETTY", "false");

const entries = [...map.entries()].filter(([, v]) => String(v).length > 0);

for (let i = 0; i < entries.length; i++) {
  const [key, value] = entries[i];
  const isLast = i === entries.length - 1;
  const args = ["variable", "set", key, "--stdin"];
  if (!isLast) args.push("--skip-deploys");
  const res = railway(args, String(value));
  if (res.status !== 0) {
    console.error(`Échec pour la clé « ${key} ».`);
    console.error(res.stderr || res.stdout || res.error);
    process.exit(res.status || 1);
  }
  console.error(`OK ${key}`);
}

console.error("");
console.error("Terminé. Un déploiement a été déclenché par la dernière variable (si Railway est configuré ainsi). Sinon, redeploy manuellement.");
