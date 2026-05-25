import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Racine du dépôt (dossier contenant package.json, public/, src/, db/).
const ROOT_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = ROOT_DIR;

function bool(v, def = false) {
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function csv(envVal) {
  return String(envVal || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const PORT = num(process.env.PORT, 5179);
const NODE_ENV = process.env.NODE_ENV || "development";
/** Docker / PaaS : écouter sur toutes les interfaces ; surcharge avec LISTEN_HOST. */
const listenHost =
  (process.env.LISTEN_HOST && String(process.env.LISTEN_HOST).trim()) ||
  (NODE_ENV === "production" ? "0.0.0.0" : undefined);
/** Vercel injecte VERCEL=1 sur les déploiements serverless. */
const isVercel = process.env.VERCEL === "1";

// Playwright : en Docker, définir PLAYWRIGHT_BROWSERS_PATH=/ms-playwright (image mcr.microsoft.com/playwright).
const playwrightBrowsersDir =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.resolve(ROOT_DIR, ".playwright-browsers");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersDir;
}

export const config = {
  env: NODE_ENV,
  port: PORT,
  listenHost,
  rootDir: ROOT_DIR,
  repoRoot: REPO_ROOT,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}`,

  staticDir: path.resolve(ROOT_DIR, "public"),
  dataDir: path.resolve(ROOT_DIR, "data"),

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    maxTokens: num(process.env.ANTHROPIC_MAX_TOKENS, 600),
  },

  // Storage backend: "sqlite" (default), "json" (legacy), "supabase" (prod)
  storage: {
    driver: (process.env.STORAGE_DRIVER || "sqlite").toLowerCase(),
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  },

  // SQLite : fichier unique data/ola-flight.db. Migrations auto au boot.
  sqlite: {
    dir: path.resolve(ROOT_DIR, "data"),
    path: process.env.SQLITE_PATH || path.resolve(ROOT_DIR, "data", "ola-flight.db"),
  },

  // Auth : JWT cookie + bcrypt. JWT_SECRET DOIT être défini en prod.
  auth: {
    jwtSecret: process.env.JWT_SECRET || "",
    sessionTtl: process.env.SESSION_TTL || "7d",
    cookieName: "ola_session",
    cookieSecure: bool(process.env.COOKIE_SECURE, false), // true en prod (HTTPS)
    // Compte admin auto-créé sur premier boot si users vide.
    seedEmail: process.env.ADMIN_EMAIL || "admin@olaflight.local",
    seedPassword: process.env.ADMIN_PASSWORD || "",
    seedName: process.env.ADMIN_NAME || "Seth",
    // Legacy : tokens X-Admin-Token (à retirer).
    legacyAdminTokens: csv(process.env.ADMIN_TOKENS),
  },

  // Playwright : PDF + scraping (voir PLAYWRIGHT_BROWSERS_PATH en tête de fichier).
  playwrightBrowsersDir,

  logging: {
    level: process.env.LOG_LEVEL || "info",
    pretty: bool(process.env.LOG_PRETTY, true),
  },

  // ─── Generation PDF (T05) ────────────────────────────────────────────
  pdf: {
    // Sur Vercel le filesystem du bundle est en lecture seule ; /tmp est writable.
    outDir: isVercel ? path.join("/tmp", "ola-pdfs") : path.resolve(ROOT_DIR, "pdfs"),
    publicPath: "/pdfs", // route static servie par Express
  },

  /** Indique un déploiement Vercel (serverless) — Playwright souvent indisponible. */
  isVercel,

  // ─── Meta WhatsApp / Instagram (T02 + T07) ────────────────────────────
  meta: {
    appSecret: process.env.META_APP_SECRET || "",
    verifyToken: process.env.META_VERIFY_TOKEN || "",
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  },
  instagram: {
    token: process.env.INSTAGRAM_TOKEN || "",
    pageId: process.env.INSTAGRAM_PAGE_ID || "",
  },

  // ─── Calendly (T06) ──────────────────────────────────────────────────
  calendly: {
    token: process.env.CALENDLY_TOKEN || "",
    eventTypeUri: process.env.CALENDLY_EVENT_TYPE_URI || "",
    fallbackLink: process.env.CALENDLY_LINK || "",
    webhookSigningKey: process.env.CALENDLY_WEBHOOK_KEY || "",
  },

  // ─── Notifications internes (T04) ────────────────────────────────────
  notifications: {
    dalsimWhatsapp: csv(process.env.DALSIM_WHATSAPP),
    defaultCloserWhatsapp: process.env.DEFAULT_CLOSER_WHATSAPP || "",
  },

  // ─── Push ntfy.sh (mobile / desktop) ─────────────────────────────────
  ntfy: {
    enabled: bool(process.env.NTFY_ENABLED, false) || Boolean(process.env.NTFY_TOPIC_SECRET),
    server: (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, ""),
    topicSecret: process.env.NTFY_TOPIC_SECRET || "",
    topicPrefix: (process.env.NTFY_TOPIC_PREFIX || "olaflight").replace(/[^a-z0-9-]/gi, "-").slice(0, 32),
    token: process.env.NTFY_TOKEN || "",
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
  },

  /** Email transactionnel (Hostinger SMTP — noreply@olaflight.fr) */
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "noreply@olaflight.fr",
  },
};

export function assertCriticalConfig() {
  const issues = [];
  if (!config.anthropic.apiKey) {
    issues.push(
      "ANTHROPIC_API_KEY manquante — l'endpoint /api/chat répondra 500. Copier .env.example → .env."
    );
  }
  if (!config.auth.jwtSecret) {
    issues.push(
      "JWT_SECRET manquant — auto-généré (NON-PERSISTANT, sessions invalidées à chaque restart). À fixer en .env pour la prod."
    );
    // En dev : on génère une clé en mémoire pour ne pas planter le boot.
    config.auth.jwtSecret =
      Buffer.from(`${Date.now()}-${Math.random()}-${process.pid}`).toString("base64");
  }
  if (config.storage.driver === "supabase") {
    if (!config.storage.supabaseUrl || !config.storage.supabaseServiceKey) {
      issues.push(
        "STORAGE_DRIVER=supabase mais SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants."
      );
    }
  }
  return issues;
}
