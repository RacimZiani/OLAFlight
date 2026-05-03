import { createApp } from "./app.js";
import { config, assertCriticalConfig } from "./config.js";
import { logger } from "./logger.js";
import { getStore } from "./db/index.js";
import { seedAdminIfNeeded } from "./seeds/admin.js";

async function main() {
  for (const issue of assertCriticalConfig()) logger.warn(issue);

  await getStore();           // ouvre la DB + applique les migrations
  await seedAdminIfNeeded();  // crée l'admin si users vide

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`Ola Flight server → ${config.publicUrl}`);
    logger.info(`storage: ${config.storage.driver} · env: ${config.env}`);
  });
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err?.stack || err}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`unhandledRejection: ${reason}`);
});
process.on("uncaughtException", (err) => {
  logger.error(`uncaughtException: ${err?.stack || err}`);
});
