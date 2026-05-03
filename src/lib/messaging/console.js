import { createLogger } from "../../logger.js";

const log = createLogger("msg:console");

// Adapter de fallback : log en console + persiste dans data/outbox.json.
// Utilisé quand aucun token Meta n'est configuré → l'ensemble du système
// tourne sans erreur, et on voit dans les logs ce qu'on AURAIT envoyé.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";

const outboxPath = path.join(config.dataDir, "outbox.json");

async function appendToOutbox(entry) {
  await fs.mkdir(config.dataDir, { recursive: true });
  let items = [];
  try {
    const raw = await fs.readFile(outboxPath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch { /* premier write */ }
  items.unshift({ ...entry, sent_at: Date.now() });
  await fs.writeFile(outboxPath, JSON.stringify({ items: items.slice(0, 200) }, null, 2), "utf8");
}

export async function send({ channel, to, text, attachments = [] }) {
  const entry = { channel, to, text, attachments };
  log.warn(`[fallback] ${channel} → ${to} : ${String(text || "").slice(0, 80)}${attachments.length ? ` (+${attachments.length} att.)` : ""}`);
  await appendToOutbox(entry);
  return { id: `console-${Date.now()}`, fallback: true };
}
