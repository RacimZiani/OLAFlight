import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("db:json");

const FILES = {
  flights: path.join(config.dataDir, "flights.json"),
  leads: path.join(config.dataDir, "leads.json"),
  devis: path.join(config.dataDir, "devis.json"),
  apporteurs: path.join(config.dataDir, "apporteurs.json"),
  conversations_ola: path.join(config.dataDir, "conversations_ola.json"),
};

// Sérialise les écritures par fichier — évite que deux requêtes concurrentes
// écrasent l'une le travail de l'autre (read-modify-write).
const writeQueues = new Map();

async function ensureFiles() {
  await fs.mkdir(config.dataDir, { recursive: true });
  for (const file of Object.values(FILES)) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, JSON.stringify({ items: [] }, null, 2), "utf8");
      log.info(`init ${path.basename(file)}`);
    }
  }
}

async function readCollection(file) {
  await ensureFiles();
  const raw = await fs.readFile(file, "utf8");
  const parsed = (() => {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  })();
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function writeCollection(file, items) {
  await ensureFiles();
  // Une seule écriture en vol par fichier.
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fs.writeFile(file, JSON.stringify({ items }, null, 2), "utf8"));
  writeQueues.set(file, next);
  return next;
}

function makeCollection(name, file) {
  return {
    list: () => readCollection(file),
    save: (items) => writeCollection(file, items),
    async insert(item) {
      const items = await readCollection(file);
      items.unshift(item);
      await writeCollection(file, items);
      return item;
    },
    async update(id, patch) {
      const items = await readCollection(file);
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch, id, updated_at: Date.now() };
      await writeCollection(file, items);
      return items[idx];
    },
    async remove(id) {
      const items = await readCollection(file);
      const next = items.filter((x) => x.id !== id);
      await writeCollection(file, next);
      return items.length - next.length;
    },
    async findById(id) {
      const items = await readCollection(file);
      return items.find((x) => x.id === id) || null;
    },
  };
}

export const jsonStore = {
  flights: makeCollection("flights", FILES.flights),
  leads: makeCollection("leads", FILES.leads),
  devis: makeCollection("devis", FILES.devis),
  apporteurs: makeCollection("apporteurs", FILES.apporteurs),
  conversations_ola: makeCollection("conversations_ola", FILES.conversations_ola),
  async ready() {
    await ensureFiles();
  },
};
