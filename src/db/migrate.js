// Runner de migrations SQLite : exécute toutes les *.sqlite.sql présentes
// dans db/migrations/ par ordre alphabétique, en mémorisant celles déjà
// appliquées dans une table `_migrations`.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate");

const MIGRATIONS_DIR = path.join(config.rootDir, "db", "migrations");

export function runSqliteMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sqlite.sql"))
    .sort();

  const applied = new Set(
    db.prepare("SELECT id FROM _migrations").all().map((r) => r.id)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    log.info(`applying ${file}`);
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(file, Date.now());
    });
    tx();
  }
  log.info(`migrations OK (${files.length} files, ${files.length - applied.size} new)`);
}
