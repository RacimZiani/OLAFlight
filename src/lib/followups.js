// Relances automatiques : quand recontacter un client, sans y penser.
//
// Règles (la concierge peut toujours reporter ou fixer la date à la main) :
//   • premier contact / relance sans réponse → J+2, puis J+7, puis J+15
//   • après la 3e relance sans réponse      → plus de relance auto (client « froid »)
//   • le client répond (DM reçu)            → on lui répond le jour même, la séquence repart à zéro
//   • devis envoyé                          → relance J+2 pour avoir son retour
//   • gagné / perdu / archivé               → plus de relance
//
// Les jours comptent à partir de maintenant, à 10 h (heure de Paris), pour que la
// relance tombe dans la journée de travail et pas au milieu de la nuit.

import { config } from "../config.js";

export const SEQUENCE_DAYS = [2, 5, 8]; // J+2, puis +5 (= J+7), puis +8 (= J+15)
export const MAX_STEPS = SEQUENCE_DAYS.length;
const CLOSED = new Set(["won", "lost", "archived"]);
const DAY = 24 * 60 * 60 * 1000;

const asDb = (ms) => (ms == null ? null : config.storage.driver === "supabase" ? new Date(ms).toISOString() : ms);
export const toMs = (v) => (v == null || v === "" ? 0 : typeof v === "number" ? v : Date.parse(v) || 0);

/** Date à J+n, ramenée à 10 h heure de Paris. */
export function dayAt10(days, from = Date.now()) {
  const d = new Date(from + days * DAY);
  const parisNoon = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const offset = d.getTime() - parisNoon.getTime(); // écart UTC ↔ Paris
  parisNoon.setHours(10, 0, 0, 0);
  return parisNoon.getTime() + offset;
}

/**
 * Patch à appliquer au lead après un événement.
 * @param {object} lead
 * @param {"dm_out"|"call"|"meeting"|"dm_in"|"devis_sent"|"status"} event
 */
export function followupPatch(lead, event) {
  const step = Number(lead.followup_step) || 0;
  if (CLOSED.has(lead.status)) return { next_followup: null, followup_step: 0 };

  switch (event) {
    case "dm_in":
      // Le client a répondu : on lui répond aujourd'hui, la séquence repart de zéro.
      return { next_followup: asDb(Date.now()), followup_step: 0 };
    case "devis_sent":
      return { next_followup: asDb(dayAt10(2)), followup_step: 0 };
    case "meeting":
      // Après un rendez-vous, on fait le point le lendemain.
      return { next_followup: asDb(dayAt10(1)), followup_step: 0 };
    case "dm_out":
    case "call": {
      const nextStep = step + 1;
      if (nextStep > MAX_STEPS) return { next_followup: null, followup_step: nextStep };
      return { next_followup: asDb(dayAt10(SEQUENCE_DAYS[nextStep - 1])), followup_step: nextStep };
    }
    default:
      return {};
  }
}

/** Le lead est-il dans la liste « à relancer » ? */
export function followupState(lead, now = Date.now()) {
  if (CLOSED.has(lead.status)) return null;
  const at = toMs(lead.next_followup);
  if (!at) return (Number(lead.followup_step) || 0) > MAX_STEPS ? "froid" : null;
  const endOfToday = dayAt10(0, now) + 14 * 60 * 60 * 1000; // jusqu'à minuit
  if (at < dayAt10(0, now) - 10 * 60 * 60 * 1000) return "en_retard"; // avant aujourd'hui 0 h
  if (at <= endOfToday) return "aujourdhui";
  return "a_venir";
}

/** Catégorie de message conseillée pour la prochaine relance. */
export function suggestedCategory(lead) {
  const step = Number(lead.followup_step) || 0;
  if (["devis_sent", "offer"].includes(lead.status)) return step === 0 ? "devis" : `relance_${Math.min(step, 3)}`;
  // step = messages déjà envoyés sans réponse : après le 1er contact vient la relance 1, etc.
  if (step === 0) return ["qualification", "new"].includes(lead.status) ? "premier_contact" : "relance_1";
  return `relance_${Math.min(step, 3)}`;
}
