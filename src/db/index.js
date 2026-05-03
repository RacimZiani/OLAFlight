import { config } from "../config.js";
import { jsonStore } from "./jsonStore.js";
import { createLogger } from "../logger.js";

const log = createLogger("db");

let store;

async function buildStore() {
  if (config.storage.driver === "supabase") {
    try {
      const { createSupabaseStore } = await import("./supabase.js");
      const s = createSupabaseStore();
      await s.ready();
      log.info("storage = supabase");
      return s;
    } catch (e) {
      log.warn(`Supabase indisponible (${e.message}) — fallback SQLite.`);
    }
  }
  if (config.storage.driver === "json") {
    log.info("storage = json (legacy)");
    return jsonStore;
  }
  // Default : sqlite
  try {
    const { createSqliteStore } = await import("./sqliteStore.js");
    const { runSqliteMigrations } = await import("./migrate.js");
    const s = createSqliteStore();
    await s.ready();
    runSqliteMigrations(s.raw());
    log.info("storage = sqlite");
    return s;
  } catch (e) {
    log.error(`SQLite indisponible (${e.message}) — fallback JSON.`);
    return jsonStore;
  }
}

export async function getStore() {
  if (!store) store = await buildStore();
  await store.ready?.();
  return store;
}
