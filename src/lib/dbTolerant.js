// Écritures tolérantes au schéma : si la base ne connaît pas une colonne
// (migration pas encore passée, différence SQLite / Supabase), on retire ce
// champ et on réessaie au lieu de faire échouer toute l'action métier.
//
// Messages reconnus :
//   Supabase  : Could not find the 'notes' column of 'devis' in the schema cache
//   Postgres  : column "notes" of relation "devis" does not exist

import { createLogger } from "../logger.js";

const log = createLogger("db:tolerant");

export function missingColumn(err) {
  const msg = err?.message || String(err || "");
  return (/Could not find the '([a-z0-9_]+)' column/i.exec(msg) || /column "?([a-z0-9_]+)"? (?:of relation "?[a-z0-9_]+"? )?does not exist/i.exec(msg))?.[1] || null;
}

/** Exécute write(row) ; retire au plus `max` colonnes inconnues de la base. */
export async function writeTolerant(write, row, { table = "?", max = 5 } = {}) {
  let current = { ...row };
  for (let i = 0; i <= max; i++) {
    try {
      return await write(current);
    } catch (e) {
      const col = missingColumn(e);
      if (!col || !(col in current)) throw e;
      log.warn(`colonne ${table}.${col} absente de la base : champ ignoré (migration à passer)`);
      const { [col]: _dropped, ...rest } = current;
      current = rest;
    }
  }
  return write(current);
}
