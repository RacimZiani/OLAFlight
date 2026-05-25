import nodemailer from "nodemailer";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { buildPublicDevisPdfUrl } from "./publicUrl.js";
import { buildDecisionUrl } from "./devisDecisionToken.js";
import { pickDisplayPriceFromOption } from "./draftDevis.js";

const log = createLogger("email");

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  const smtp = config.smtp;
  if (!smtp.host || !smtp.user || !smtp.pass) {
    return null;
  }
  _transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
  return _transport;
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
        <td style="padding:12px 0;border-bottom:1px solid #222;font-family:Georgia,serif;color:#f8f5f0">
          <strong>${escapeHtml(o.label || `Option ${i + 1}`)}</strong><br>
          <span style="font-size:13px;color:#aaa">${escapeHtml(o.compagnie || "—")}</span>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #222;text-align:right;color:#f8f5f0;font-size:14px">
          ${biz > 0 ? `Business : ${formatMoney(biz)}<br>` : ""}
          ${first > 0 ? `First : ${formatMoney(first)}<br>` : ""}
          <strong style="color:#c9a96e">${formatMoney(pv)}</strong>
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

  return `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto;background:#111;border:1px solid #333;padding:40px 32px">
    <div style="margin:0 0 28px"><img src="${baseUrl}/images/logo-texte.png" alt="Ola Flight" style="height:120px;width:auto;display:block"></div>
    <h1 style="font-family:Georgia,serif;font-weight:300;font-size:28px;color:#f8f5f0;margin:0 0 16px">
      ${fr ? `Votre proposition, ${name}` : `Your proposal, ${name}`}
    </h1>
    <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 24px">
      ${fr ? `Voici votre comparatif pour <strong style="color:#fff">${dest}</strong>. Tarif valable 24 h.` : `Here is your comparison for <strong style="color:#fff">${dest}</strong>. Valid 24 hours.`}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${buildOptionsHtml(devis, lead)}</table>
    ${buildExtrasHtml(devis, lead)}
    <p style="margin:28px 0 12px">
      <a href="${pdfUrl}" style="color:#c9a96e;font-size:13px">${fr ? "Télécharger le PDF" : "Download PDF"}</a>
    </p>
    <div style="text-align:center;margin:32px 0 8px">
      ${btn(acceptUrl, fr ? "Accepter" : "Accept", "#f8f5f0")}
      ${btn(negotiateUrl, fr ? "Négocier" : "Discuss", "#333")}
      ${btn(refuseUrl, fr ? "Refuser" : "Decline", "transparent")}
    </div>
    <p style="font-size:11px;color:#555;line-height:1.6;margin-top:24px">
      ${fr ? "Un conseiller Ola Flight vous recontacte après votre choix." : "An Ola Flight advisor will follow up after your choice."}
    </p>
  </div></body></html>`;
}

export function isEmailConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

/**
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendDevisEmailToClient({ devis, lead, baseUrl, lang = "fr" }) {
  const transport = getTransport();
  const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const recipient = [lead?.client_contact, lead?.notes]
    .map(s => String(s || "").match(emailRegex)?.[0])
    .find(Boolean) || "";

  if (!recipient) {
    return { ok: false, error: "Aucune adresse email client sur le lead (renseigner dans contact ou notes)" };
  }
  if (!transport) {
    log.warn("SMTP non configuré — email non envoyé");
    return { ok: false, error: "SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS)" };
  }

  const html = buildDevisEmailHtml({ devis, lead, baseUrl, lang });
  const subject =
    lang === "en"
      ? `Ola Flight — Your quote ${devis.id}`
      : `Ola Flight — Votre devis ${devis.id}`;

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SMTP timeout — vérifier SMTP_HOST et les credentials")), 20000)
  );
  try {
    const info = await Promise.race([
      transport.sendMail({
        from: config.smtp.from,
        to: recipient,
        subject,
        html,
        text:
          lang === "en"
            ? `Your Ola Flight quote ${devis.id} is ready. Open the email in HTML to respond.`
            : `Votre devis Ola Flight ${devis.id} est prêt. Ouvrez l'email en HTML pour répondre.`,
      }),
      timeout,
    ]);
    log.info(`devis email sent → ${recipient} (${devis.id})`);
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    log.error(`send devis email failed: ${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}
