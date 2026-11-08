// Réglages modifiables par la direction (table app_settings, une ligne par clé).

import { getStore } from "../db/index.js";
import { config } from "../config.js";

export const DEFAULT_SETTINGS = {
  // Classement visible par les concierges et closers.
  leaderboard_visible: true,
  // Montants (CA, commissions) des autres visibles dans le classement.
  leaderboard_amounts: false,
};

const asDb = (ms) => (config.storage.driver === "supabase" ? new Date(ms).toISOString() : ms);

export async function getSettings() {
  const store = await getStore();
  if (!store.app_settings) return { ...DEFAULT_SETTINGS };
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const row = await store.app_settings.findById(key).catch(() => null);
    if (row && row.value !== undefined && row.value !== null) out[key] = row.value;
  }
  return out;
}

export async function setSettings(patch) {
  const store = await getStore();
  const now = Date.now();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const exists = await store.app_settings.findById(key).catch(() => null);
    if (exists) await store.app_settings.update(key, { value });
    else await store.app_settings.insert({ id: key, value, created_at: asDb(now), updated_at: asDb(now) });
  }
  return getSettings();
}
