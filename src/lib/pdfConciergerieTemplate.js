// Template PDF des devis de conciergerie multi-prestations.
// Même langage visuel que pdfTemplate.js (devis vol) : Cormorant Garamond +
// Montserrat, noir et crème, accents or.
//
// ⚠ Le devis reçu est déjà SANITIZÉ : ni prix_revient, ni prix d'achat par
//    ligne, ni commissions (voir sanitizeDevisForRole / pdf.js).

import { OLA_LOGO_DATA_URI } from "./olaLogo.js";
import { getServiceType } from "./serviceCatalog.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n));
}

function fmtDate(ts, withTime = false) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  } catch { return ""; }
}

function renderLine(l) {
  const def = getServiceType(l.type);
  const details = def.fields
    .filter((f) => l.details?.[f.key])
    .map((f) => `<div class="d"><span>${esc(f.label)}</span>${esc(l.details[f.key])}</div>`)
    .join("");
  const qte = Number(l.quantite) || 1;
  const total = l.sur_devis ? null : (Number(l.prix_unitaire) || 0) * qte;
  return `
  <article class="line">
    <div class="line-main">
      <div class="line-type">${esc(def.label)}</div>
      <h3 class="line-title">${esc(l.titre)}</h3>
      ${details ? `<div class="details">${details}</div>` : ""}
      ${l.description ? `<p class="line-desc">${esc(l.description)}</p>` : ""}
    </div>
    <div class="line-price">
      ${l.sur_devis
        ? `<div class="p-sur">Sur devis</div>`
        : `<div class="p-total">${money(total)}</div>${qte > 1 ? `<div class="p-unit">${qte} × ${money(l.prix_unitaire)}</div>` : ""}`}
    </div>
  </article>`;
}

/** Marges et bandes noires à passer à page.pdf() pour ce gabarit. */
const BAND = (h) => `<div style="width:100%;height:${h};margin:0;background:#0a0a0a;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>`;
export const CONCIERGERIE_PDF_OPTIONS = {
  margin: { top: "14mm", right: "0", bottom: "12mm", left: "0" },
  displayHeaderFooter: true,
  headerTemplate: `<style>#header,#footer{padding:0!important;margin:0!important;}</style>${BAND("14mm")}`,
  footerTemplate: BAND("12mm"),
};

export function renderConciergerieDevisHtml({ devis, lead, companyLogo = OLA_LOGO_DATA_URI }) {
  const lignes = Array.isArray(devis.prestations) ? devis.prestations : [];
  const priced = lignes.filter((l) => !l.sur_devis);
  const hasSurDevis = lignes.some((l) => l.sur_devis);
  const total = Number(devis.prix_vente) || 0;
  const clientName = lead?.client_name || devis.client_name || "";
  const jours = Number(devis.validite_jours) || 7;
  const titre = lignes.length === 1 ? lignes[0].titre : "Votre sélection sur-mesure";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Ola Flight · Devis ${esc(devis.id)}</title>
<style>
  /* Les marges haut/bas sont posées par pdf.js (PDF_MARGINS) et peintes en
     noir par l'en-tête / pied de page Chrome : chaque page respire, sans bord blanc. */
  @page { size: A4; }
  *{ margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  :root{ --b:#0a0a0a; --b2:#111; --b3:#161616; --w:#f5f3ef; --g:rgba(245,243,239,0.6); --g2:rgba(245,243,239,0.4);
         --l:rgba(245,243,239,0.10); --l2:rgba(245,243,239,0.18); --gold:#C9A96E; }
  html, body{ background:var(--b); color:var(--w); font-family:'Cormorant Garamond','Times New Roman',serif; font-weight:300; }
  .page{ width:210mm; min-height:271mm; padding:8mm 20mm 4mm; display:flex; flex-direction:column; }
  .head{ display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12mm; border-bottom:1px solid var(--l); }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand img{ height:48px; width:auto; max-width:70mm; object-fit:contain; }
  .brand-name{ font-size:22px; font-weight:200; letter-spacing:1px; }
  .brand-sub{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:5px; text-transform:uppercase; color:var(--g); }
  .ref{ text-align:right; font-family:'Montserrat',sans-serif; }
  .ref-l{ font-size:7px; letter-spacing:3px; text-transform:uppercase; color:var(--g2); margin-bottom:4px; }
  .ref-id{ font-size:13px; letter-spacing:2px; }
  .ref-d{ font-size:9px; color:var(--g); margin-top:6px; }

  .intro{ padding:12mm 0 9mm; }
  .eyebrow{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:5px; text-transform:uppercase; color:var(--gold); margin-bottom:10px; }
  .title{ font-size:42px; font-weight:200; line-height:1.08; letter-spacing:-0.5px; }
  .title em{ font-style:italic; color:var(--gold); }
  .sub{ font-size:14px; color:var(--g); margin-top:10px; max-width:135mm; line-height:1.7; }

  .lines{ border-top:1px solid var(--l); }
  .line{ display:grid; grid-template-columns:1fr auto; gap:10mm; padding:6mm 0; border-bottom:1px solid var(--l); break-inside:avoid; }
  .line-type{ font-family:'Montserrat',sans-serif; font-size:7px; letter-spacing:4px; text-transform:uppercase; color:var(--gold); }
  .line-title{ font-size:22px; font-weight:300; margin-top:4px; }
  .details{ display:grid; grid-template-columns:1fr 1fr; gap:3px 10mm; margin-top:8px; }
  .d{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--w); line-height:1.5; }
  .d span{ display:block; font-size:6.5px; letter-spacing:2.5px; text-transform:uppercase; color:var(--g2); }
  .line-desc{ font-size:13px; color:var(--g); line-height:1.6; margin-top:8px; max-width:120mm; }
  .line-price{ text-align:right; min-width:38mm; }
  .p-total{ font-size:26px; font-weight:200; }
  .p-unit{ font-family:'Montserrat',sans-serif; font-size:8px; color:var(--g); margin-top:3px; }
  .p-sur{ font-family:'Montserrat',sans-serif; font-size:9px; letter-spacing:3px; text-transform:uppercase; color:var(--gold); padding-top:8px; }

  .total{ margin-top:8mm; padding:7mm 6mm; background:var(--b2); border:1px solid var(--l); display:flex; justify-content:space-between; align-items:baseline; break-inside:avoid; }
  .total-l{ font-family:'Montserrat',sans-serif; font-size:9px; letter-spacing:3px; text-transform:uppercase; color:var(--g); }
  .total-l small{ display:block; letter-spacing:1px; text-transform:none; font-size:9px; color:var(--g2); margin-top:4px; }
  .total-v{ font-size:38px; font-weight:200; color:var(--gold); }

  .notes{ margin-top:8mm; break-inside:avoid; }
  .notes-t{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:4px; text-transform:uppercase; padding-bottom:6px; border-bottom:1px solid var(--l); margin-bottom:8px; }
  .notes p{ font-size:13px; color:var(--g); line-height:1.7; white-space:pre-line; }

  .foot{ margin-top:auto; padding-top:10mm; display:flex; justify-content:space-between; align-items:flex-end; border-top:1px solid var(--l); }
  .foot-l{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:3px; text-transform:uppercase; color:var(--gold); }
  .foot-d{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g); margin-top:4px; }
  .foot-note{ text-align:right; font-size:11px; color:var(--g); font-style:italic; max-width:90mm; line-height:1.6; }
</style>
</head>
<body>
<div class="page">
  <header class="head">
    <div class="brand">
      ${companyLogo ? `<img src="${companyLogo}" alt="Ola Flight">` : ""}
      <div>
        <div class="brand-name">Ola Flight</div>
        <div class="brand-sub">Conciergerie privée · Paris</div>
      </div>
    </div>
    <div class="ref">
      <div class="ref-l">Référence devis</div>
      <div class="ref-id">${esc(devis.id)}</div>
      <div class="ref-d">Émis le ${fmtDate(devis.created_at)}</div>
    </div>
  </header>

  <section class="intro">
    <div class="eyebrow">Proposition de conciergerie</div>
    <h1 class="title">${esc(titre)}${clientName ? `<br><em>pour ${esc(clientName)}</em>` : ""}</h1>
    <p class="sub">Une proposition préparée sur-mesure par votre concierge Ola. Chaque prestation est vérifiée et coordonnée de bout en bout par notre équipe.</p>
  </section>

  <section class="lines">
    ${lignes.map(renderLine).join("")}
  </section>

  ${priced.length ? `
  <section class="total">
    <div class="total-l">Total de la proposition${hasSurDevis ? `<small>Hors prestations sur devis, chiffrées séparément</small>` : ""}</div>
    <div class="total-v">${money(total)}</div>
  </section>` : ""}

  ${devis.notes ? `
  <section class="notes">
    <div class="notes-t">Informations</div>
    <p>${esc(devis.notes)}</p>
  </section>` : ""}

  <footer class="foot">
    <div>
      <div class="foot-l">Proposition valable ${jours} jour${jours > 1 ? "s" : ""}</div>
      <div class="foot-d">Jusqu'au ${fmtDate(devis.valide_jusqu_au)}</div>
    </div>
    <div class="foot-note">Ola Flight, conciergerie privée.<br>Votre concierge reste à votre disposition pour ajuster chaque détail.</div>
  </footer>
</div>
</body>
</html>`;
}
