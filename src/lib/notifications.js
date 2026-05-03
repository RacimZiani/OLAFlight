// Orchestration des notifications transverses :
//   - Dalsim quand un nouveau lead arrive en `devis_pending` (T04)
//   - Closeuse quand un lead est `interested` → brief auto (T06)
//
// Toutes les notifs passent par sendMessage() → si Meta n'est pas configuré,
// elles tombent en fallback console / outbox.json (rien ne casse).

import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { sendMessage } from "./messaging/index.js";

const log = createLogger("notifs");

function fmtNewLeadMessage(lead) {
  const lines = [
    "🟡 NOUVEAU LEAD — Devis à préparer",
    "",
    `Client : ${lead.client_name}${lead.client_contact ? ` (${lead.client_contact})` : ""}`,
    `Canal  : ${lead.canal === "instagram" ? "Instagram" : "WhatsApp"}`,
    `Trajet : ${lead.destination || "—"}`,
    `Dates  : ${lead.dates || "—"}`,
    `Classe : ${lead.classe || "—"} × ${lead.passagers || 1}`,
    "",
    `Ouvrir : ${config.publicUrl}/dalsim.html`,
  ];
  return lines.join("\n");
}

export async function notifyDalsimOfNewLead(lead) {
  const recipients = config.notifications.dalsimWhatsapp;
  if (!recipients.length) {
    log.warn("aucun DALSIM_WHATSAPP configuré — notif sautée");
    return [];
  }
  const text = fmtNewLeadMessage(lead);
  const results = [];
  for (const to of recipients) {
    try {
      const r = await sendMessage({ channel: "whatsapp", to, text });
      results.push({ to, ok: true, id: r.id });
    } catch (e) {
      log.error(`dalsim ${to}: ${e.message}`);
      results.push({ to, ok: false, error: e.message });
    }
  }
  return results;
}

function fmtCloserBriefMessage({ lead, devis, calendlyLink }) {
  const lines = [
    "🟢 LEAD INTÉRESSÉ — Closeuse, à toi.",
    "",
    `Client : ${lead.client_name}${lead.client_contact ? ` (${lead.client_contact})` : ""}`,
    `Trajet : ${lead.destination || "—"} (${lead.dates || "—"})`,
    `Classe : ${lead.classe || "—"} × ${lead.passagers || 1}`,
    "",
    devis ? `Devis : ${devis.id} · ${devis.compagnie || "—"} · ${devis.prix_vente || "—"} €` : "Pas de devis lié.",
    calendlyLink ? `\n📅 Booking : ${calendlyLink}` : "",
    "",
    `CRM : ${config.publicUrl}/crm.html`,
  ];
  return lines.filter((x) => x !== undefined).join("\n");
}

export async function notifyCloserOfBookedLead({ lead, devis, calendlyLink, closerWhatsApp }) {
  const to = closerWhatsApp || config.notifications.defaultCloserWhatsapp;
  if (!to) {
    log.warn("aucun CLOSER_WHATSAPP — notif sautée");
    return null;
  }
  const text = fmtCloserBriefMessage({ lead, devis, calendlyLink });
  try {
    return await sendMessage({ channel: "whatsapp", to, text });
  } catch (e) {
    log.error(`closeuse ${to}: ${e.message}`);
    return null;
  }
}
