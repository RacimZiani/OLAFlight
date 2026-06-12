import { Resend } from "resend";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { buildPublicDevisPdfUrl } from "./publicUrl.js";
import { buildDecisionUrl } from "./devisDecisionToken.js";
import { pickDisplayPriceFromOption } from "./draftDevis.js";

const log = createLogger("email");

function getResend() {
  if (!config.resend.apiKey) return null;
  return new Resend(config.resend.apiKey);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );
}

function buildOptionsHtml(devis, lead) {
  const opts = Array.isArray(devis.options) ? devis.options : [];
  return opts
    .filter((o) => o && (o.compagnie || o.prix_vente > 0))
    .map((o, i) => {
      const pv = pickDisplayPriceFromOption(o, lead);
      const biz = Number(o.prix_vente_business) || 0;
      const first = Number(o.prix_vente_first) || 0;
      return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #2a2a2a;font-family:Georgia,serif;color:#f8f5f0 !important;background:#111111">
          <strong style="color:#f8f5f0 !important">${escapeHtml(o.label || `Option ${i + 1}`)}</strong><br>
          <span style="font-size:13px;color:#888888 !important;font-family:Arial,sans-serif">${escapeHtml(o.compagnie || "—")}</span>
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #2a2a2a;text-align:right;color:#f8f5f0 !important;font-size:14px;font-family:Arial,sans-serif;background:#111111">
          ${biz > 0 ? `<span style="color:#cccccc !important">Business : ${formatMoney(biz)}</span><br>` : ""}
          ${first > 0 ? `<span style="color:#cccccc !important">First : ${formatMoney(first)}</span><br>` : ""}
          <strong style="color:#c9a96e !important;font-size:16px">${formatMoney(pv)}</strong>
        </td>
      </tr>`;
    })
    .join("");
}

function buildExtrasHtml(devis, lead) {
  const parts = [];
  if (lead?.needs_hotel && Array.isArray(devis.hotels) && devis.hotels.length) {
    parts.push(
      `<p style="margin:16px 0 0;color:#ccc;font-size:13px"><strong>Hôtel</strong> — ${devis.hotels.map((h) => escapeHtml(h.name)).join(", ")}</p>`
    );
  }
  if (lead?.needs_driver && devis.driver && Number(devis.driver.total_price) > 0) {
    parts.push(
      `<p style="margin:8px 0 0;color:#ccc;font-size:13px"><strong>Chauffeur privé</strong> — ${formatMoney(devis.driver.total_price)}</p>`
    );
  }
  return parts.join("");
}

function buildDevisEmailHtml({ devis, lead, baseUrl, lang = "fr" }) {
  const pdfUrl = buildPublicDevisPdfUrl(devis.id, { publicBaseUrl: baseUrl });
  const acceptUrl = buildDecisionUrl(baseUrl, devis.id, "accept");
  const refuseUrl = buildDecisionUrl(baseUrl, devis.id, "refuse");
  const negotiateUrl = buildDecisionUrl(baseUrl, devis.id, "negotiate");
  const name = escapeHtml((lead?.client_name || "").split(" ")[0] || "Client");
  const dest = escapeHtml(lead?.destination || "");
  const fr = lang !== "en";

  const btn = (href, label, bg) =>
    `<a href="${href}" style="display:inline-block;margin:6px 8px;padding:14px 28px;background:${bg};color:#000;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="${fr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  :root { color-scheme: dark; }
  body { margin:0 !important; padding:0 !important; background:#0a0a0a !important; }
  * { -webkit-text-size-adjust:none; }
</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a !important;background-color:#0a0a0a !important;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;background-color:#0a0a0a;min-height:100vh">
  <tr><td align="center" style="padding:32px 16px;background:#0a0a0a;background-color:#0a0a0a">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111111;background-color:#111111;border:1px solid #2a2a2a">
      <tr><td style="padding:40px 32px;background:#111111;background-color:#111111">

        <div style="margin:0 0 32px"><img src="${baseUrl}/images/logo-texte.png" alt="Ola Flight" style="height:100px;width:auto;display:block"></div>

        <h1 style="font-family:Georgia,serif;font-weight:300;font-size:26px;color:#f8f5f0 !important;margin:0 0 14px;line-height:1.3">
          ${fr ? `Votre proposition, ${name}` : `Your proposal, ${name}`}
        </h1>
        <p style="color:#999999 !important;font-size:14px;line-height:1.7;margin:0 0 28px;font-family:Arial,sans-serif">
          ${fr
            ? `Voici votre comparatif pour <strong style="color:#f8f5f0 !important">${dest}</strong>. Tarif valable 24 h.`
            : `Here is your comparison for <strong style="color:#f8f5f0 !important">${dest}</strong>. Valid 24 hours.`}
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${buildOptionsHtml(devis, lead)}</table>
        ${buildExtrasHtml(devis, lead)}

        <p style="margin:28px 0 12px">
          <a href="${pdfUrl}" style="color:#c9a96e !important;font-size:13px;font-family:Arial,sans-serif">${fr ? "Télécharger le PDF" : "Download PDF"}</a>
        </p>

        <div style="text-align:center;margin:32px 0 8px">
          ${btn(acceptUrl, fr ? "ACCEPTER" : "ACCEPT", "#f8f5f0")}
          ${btn(negotiateUrl, fr ? "NÉGOCIER" : "DISCUSS", "#2a2a2a")}
          ${btn(refuseUrl, fr ? "REFUSER" : "DECLINE", "transparent")}
        </div>

        <p style="font-size:11px;color:#444444 !important;line-height:1.6;margin-top:28px;font-family:Arial,sans-serif">
          ${fr ? "Un conseiller Ola Flight vous recontacte après votre choix." : "An Ola Flight advisor will follow up after your choice."}
        </p>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function isEmailConfigured() {
  return Boolean(config.resend.apiKey);
}

/**
 * Envoi simplifié d'un devis (sans options multi-compagnies).
 * Utilisé par dalsim / closeuse pour les devis "simples".
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendSimpleDevisEmail({ devis, toEmail, baseUrl }) {
  const resend = getResend();
  if (!resend) return { ok: false, error: "RESEND_API_KEY manquante — configurer dans Railway" };
  if (!toEmail) return { ok: false, error: "Email destinataire manquant" };

  const pdfUrl = buildPublicDevisPdfUrl(devis.id, { publicBaseUrl: baseUrl });
  const trajet = [devis.ville_dep, devis.ville_arr].filter(Boolean).join(" → ");
  const retour = [devis.horaire_dep_retour, devis.horaire_arr_retour].filter(Boolean).join(" → ");
  const services = Array.isArray(devis.services_inclus) ? devis.services_inclus.join(" · ") : String(devis.services_inclus || "");
  const firstName = escapeHtml((devis.client_name || "Client").split(" ")[0]);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><style>body{margin:0;padding:0;background:#0a0a0a !important;}*{-webkit-text-size-adjust:none;}</style></head>
<body style="margin:0;padding:0;background:#0a0a0a !important;background-color:#0a0a0a !important;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;background-color:#0a0a0a;min-height:100vh">
  <tr><td align="center" style="padding:32px 16px;background:#0a0a0a">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111111;background-color:#111111;border:1px solid #2a2a2a">
      <tr><td style="padding:40px 32px;background:#111111;background-color:#111111">
        <div style="margin:0 0 32px"><img src="${escapeHtml(baseUrl)}/images/logo-texte.png" alt="Ola Flight" style="height:100px;width:auto;display:block"></div>
        <h1 style="font-family:Georgia,serif;font-weight:300;font-size:26px;color:#f8f5f0 !important;margin:0 0 14px;line-height:1.3">Votre devis, ${firstName}</h1>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
          ${trajet ? `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Trajet</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#f8f5f0 !important">${escapeHtml(trajet)}</td></tr>` : ""}
          ${devis.compagnie ? `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Compagnie</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#f8f5f0 !important">${escapeHtml(devis.compagnie)}</td></tr>` : ""}
          ${devis.horaire_dep ? `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Aller</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#f8f5f0 !important">${escapeHtml(devis.horaire_dep)}${devis.horaire_arr ? " → " + escapeHtml(devis.horaire_arr) : ""}</td></tr>` : ""}
          ${retour ? `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Retour</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#f8f5f0 !important">${escapeHtml(retour)}</td></tr>` : ""}
          ${services ? `<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Inclus</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#f8f5f0 !important">${escapeHtml(services)}</td></tr>` : ""}
          ${Number(devis.prix_vente) > 0 ? `<tr><td style="padding:14px 0;font-family:Arial,sans-serif;font-size:13px;color:#888 !important">Prix de vente</td><td style="padding:14px 0;text-align:right;font-family:Georgia,serif;font-size:22px;color:#c9a96e !important;font-weight:600">${formatMoney(devis.prix_vente)}</td></tr>` : ""}
        </table>
        <p style="margin:24px 0 8px;text-align:center">
          <a href="${escapeHtml(pdfUrl)}" style="display:inline-block;padding:14px 28px;background:#f8f5f0;color:#000 !important;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif">TÉLÉCHARGER LE PDF</a>
        </p>
        <p style="font-size:11px;color:#444 !important;line-height:1.6;margin-top:28px;font-family:Arial,sans-serif">Un conseiller Ola Flight reste disponible pour toute question.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from: config.smtp.from || "Ola Flight <noreply@olaflight.fr>",
      to: toEmail,
      subject: `Ola Flight — Votre devis`,
      html,
    });
    if (error) {
      log.error(`resend simple error: ${JSON.stringify(error)}`);
      return { ok: false, error: error.message || JSON.stringify(error) };
    }
    log.info(`simple devis email sent → ${toEmail} (${devis.id})`);
    return { ok: true, messageId: data?.id };
  } catch (e) {
    log.error(`sendSimpleDevisEmail failed: ${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendDevisEmailToClient({ devis, lead, baseUrl, lang = "fr" }) {
  const resend = getResend();
  const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const recipient = [lead?.client_contact, lead?.notes]
    .map(s => String(s || "").match(emailRegex)?.[0])
    .find(Boolean) || "";

  if (!recipient) {
    return { ok: false, error: "Aucune adresse email client sur le lead (renseigner dans contact ou notes)" };
  }
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY manquante — configurer dans Railway" };
  }

  const html = buildDevisEmailHtml({ devis, lead, baseUrl, lang });
  const subject =
    lang === "en"
      ? `Ola Flight — Your quote ${devis.id}`
      : `Ola Flight — Votre devis ${devis.id}`;

  try {
    const { data, error } = await resend.emails.send({
      from: config.smtp.from || "Ola Flight <noreply@olaflight.fr>",
      to: recipient,
      subject,
      html,
    });
    if (error) {
      log.error(`resend error: ${JSON.stringify(error)}`);
      return { ok: false, error: error.message || JSON.stringify(error) };
    }
    log.info(`devis email sent via Resend → ${recipient} (${devis.id}) id=${data?.id}`);
    return { ok: true, messageId: data?.id };
  } catch (e) {
    log.error(`send devis email failed: ${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}
