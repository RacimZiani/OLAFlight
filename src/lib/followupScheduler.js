// Notification quotidienne des relances.
//
// Toutes les 10 minutes, à partir de 9 h (heure de Paris) : chaque membre de
// l'équipe qui a des clients à relancer aujourd'hui (ou en retard) reçoit UNE
// notification par jour — cloche du back-office + push téléphone (ntfy).
// L'envoi est mémorisé en base (type "followup_digest"), donc un redémarrage
// du serveur ne renvoie pas la notification.
//
// Ne tourne que sur un serveur permanent (Railway / Docker), pas en serverless.

import { getStore } from "../db/index.js";
import { createLogger } from "../logger.js";
import { notify } from "./notifBus.js";
import { followupState, toMs } from "./followups.js";

const log = createLogger("relances");
const EVERY_MS = 10 * 60 * 1000;
const START_HOUR = 9;
let timer = null;

const parisDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const parisHour = () => Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }));

export async function runFollowupDigest({ force = false } = {}) {
  if (!force && parisHour() < START_HOUR) return { sent: 0, skipped: "avant 9 h" };
  const store = await getStore();
  const [leads, notifications] = await Promise.all([
    store.leads.list(),
    store.notifications?.list?.().catch(() => []) ?? [],
  ]);

  const today = parisDay();
  const alreadySent = new Set(
    notifications
      .filter((n) => n.type === "followup_digest" && parisDay(toMs(n.created_at)) === today)
      .map((n) => n.user_email)
  );

  // Regroupe par responsable du client (concierge / closer, sinon prospecteur).
  const byOwner = new Map();
  for (const l of leads) {
    const state = followupState(l);
    if (state !== "en_retard" && state !== "aujourdhui") continue;
    const owner = l.closer_name || l.apporteur_name;
    if (!owner) continue;
    const list = byOwner.get(owner) || [];
    list.push({ lead: l, late: state === "en_retard" });
    byOwner.set(owner, list);
  }

  let sent = 0;
  for (const [email, list] of byOwner) {
    if (alreadySent.has(email)) continue;
    const late = list.filter((x) => x.late).length;
    const names = list.slice(0, 3).map((x) => x.lead.client_name).join(", ");
    await notify({
      recipients: [{ email }],
      type: "followup_digest",
      title: `${list.length} relance${list.length > 1 ? "s" : ""} aujourd'hui`,
      body: `${names}${list.length > 3 ? ` et ${list.length - 3} autre(s)` : ""}${late ? ` · ${late} en retard` : ""}`,
      meta: { url: "/relances.html", count: list.length, late },
    }).catch((e) => log.warn(`notify ${email} : ${e?.message || e}`));
    sent += 1;
  }
  if (sent) log.info(`résumé des relances envoyé à ${sent} personne(s)`);
  return { sent };
}

export function startFollowupScheduler() {
  if (timer || process.env.VERCEL) return;
  const tick = () => runFollowupDigest().catch((e) => log.warn(`relances : ${e?.message || e}`));
  setTimeout(tick, 30 * 1000); // premier passage peu après le démarrage
  timer = setInterval(tick, EVERY_MS);
  timer.unref?.();
  log.info("planificateur des relances actif (notification quotidienne à partir de 9 h, heure de Paris)");
}
