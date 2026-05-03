// ─────────────────────────────────────────────────────────────────────────
// Template PDF brandé Ola Flight (DSL identique à brief.html / index.html :
// Cormorant Garamond + Montserrat, palette black/cream).
//
// ⚠ RÈGLE S01 (brief.html section 05) :
//    `prix_revient` ne DOIT JAMAIS apparaître dans ce template — on ne le
//    reçoit même pas en argument. C'est le call-site qui sanitize avant.
// ─────────────────────────────────────────────────────────────────────────

const FALLBACK_LOGO = ""; // base64 inline si on veut, sinon on reste typo

function fmtMoney(n, currency = "EUR") {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 })
    .format(Number(n));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

/**
 * Construit le HTML du devis client.
 * @param {object} args
 * @param {object} args.devis        - sans prix_revient (sanitize en amont)
 * @param {object} args.lead         - lead lié
 * @param {string} [args.companyLogo] - data URI du logo (optionnel)
 */
export function renderDevisHtml({ devis, lead, companyLogo = FALLBACK_LOGO }) {
  const services = Array.isArray(devis.services_inclus) ? devis.services_inclus : [];
  const economie = Math.max(
    0,
    (Number(devis.prix_marche) || 0) - (Number(devis.prix_vente) || 0)
  );
  const economiePct = devis.prix_marche
    ? Math.round((economie / Number(devis.prix_marche)) * 100)
    : 0;
  const trajet = lead?.destination || "—";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Ola Flight — Devis ${escapeHtml(devis.id)}</title>
<style>
  @page { size: A4; margin: 0; }
  *{ margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  :root{
    --b:#0a0a0a; --b2:#111; --b3:#161616;
    --w:#f5f3ef; --g:rgba(245,243,239,0.55); --g2:rgba(245,243,239,0.38);
    --l:rgba(245,243,239,0.10); --l2:rgba(245,243,239,0.18);
    --gold:#C9A96E; --green:#4ade80;
  }
  html, body{ background:var(--b); color:var(--w); font-family:'Cormorant Garamond', 'Times New Roman', serif; font-weight:300; }
  .page{ width:210mm; min-height:297mm; padding:24mm 22mm; display:flex; flex-direction:column; }
  .head{ display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:18mm; border-bottom:1px solid var(--l); }
  .brand{ display:flex; align-items:center; gap:10px; }
  .brand-logo{ width:40px; height:40px; border:1px solid var(--l2); display:flex; align-items:center; justify-content:center; font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:200; }
  .brand-name{ font-family:'Montserrat',sans-serif; font-size:9px; font-weight:300; letter-spacing:5px; text-transform:uppercase; color:var(--g); }
  .ref{ text-align:right; }
  .ref-label{ font-family:'Montserrat',sans-serif; font-size:7px; font-weight:300; letter-spacing:3px; text-transform:uppercase; color:var(--g2); margin-bottom:4px; }
  .ref-id{ font-family:'Montserrat',sans-serif; font-size:14px; letter-spacing:2px; color:var(--w); }
  .ref-date{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g); margin-top:6px; }

  .title-block{ padding:14mm 0 12mm; }
  .eyebrow{ font-family:'Montserrat',sans-serif; font-size:8px; font-weight:300; letter-spacing:5px; text-transform:uppercase; color:var(--gold); margin-bottom:10px; }
  .title{ font-size:48px; font-weight:200; line-height:1.05; letter-spacing:-1px; }
  .title em{ font-style:italic; color:var(--gold); }
  .sub{ font-size:14px; color:var(--g); margin-top:10px; max-width:120mm; line-height:1.7; }

  .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:0; border-top:1px solid var(--l); border-bottom:1px solid var(--l); }
  .cell{ padding:7mm 6mm; border-right:1px solid var(--l); }
  .cell:last-child{ border-right:none; }
  .cell-label{ font-family:'Montserrat',sans-serif; font-size:7px; font-weight:300; letter-spacing:3px; text-transform:uppercase; color:var(--g2); margin-bottom:5px; }
  .cell-val{ font-size:18px; color:var(--w); }
  .cell-sub{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g); margin-top:3px; }

  .price-block{ margin-top:8mm; padding:8mm 6mm; background:var(--b2); border:1px solid var(--l); }
  .price-row{ display:grid; grid-template-columns:1fr auto; align-items:baseline; padding:6px 0; }
  .pr-l{ font-family:'Montserrat',sans-serif; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--g); }
  .pr-v{ font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:200; color:var(--w); }
  .pr-strike{ text-decoration:line-through; color:var(--g2); }
  .pr-final{ font-size:34px; color:var(--gold); }
  .pr-saving{ color:var(--green); font-size:14px; font-family:'Montserrat',sans-serif; letter-spacing:1px; }
  .price-sep{ height:1px; background:var(--l); margin:8px 0; }

  .services{ margin-top:8mm; }
  .services-title{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:4px; text-transform:uppercase; color:var(--w); padding-bottom:6px; border-bottom:1px solid var(--l); margin-bottom:8px; }
  .services-grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; }
  .service{ display:flex; align-items:flex-start; gap:8px; padding:5px 0; font-size:13px; color:var(--g); }
  .service::before{ content:'›'; color:var(--gold); font-family:'Cormorant Garamond',serif; font-size:18px; line-height:1; margin-top:2px; }

  .validity{ margin-top:auto; padding-top:10mm; border-top:1px solid var(--l); display:flex; justify-content:space-between; align-items:flex-end; }
  .validity-l{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:3px; text-transform:uppercase; color:var(--gold); }
  .validity-d{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g); margin-top:4px; }
  .footer-note{ text-align:right; font-size:11px; color:var(--g); font-style:italic; max-width:90mm; line-height:1.6; }
</style>
</head>
<body>
<div class="page">

  <header class="head">
    <div class="brand">
      <div class="brand-logo">Ō</div>
      <div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:200;letter-spacing:1px;">Ola Flight</div>
        <div class="brand-name">Private Travel · Paris</div>
      </div>
    </div>
    <div class="ref">
      <div class="ref-label">Référence devis</div>
      <div class="ref-id">${escapeHtml(devis.id)}</div>
      <div class="ref-date">Émis le ${fmtDate(devis.created_at)}</div>
    </div>
  </header>

  <div class="title-block">
    <div class="eyebrow">Proposition de voyage</div>
    <h1 class="title">${escapeHtml(trajet.replace(/->|→/g, "→")) || "Votre vol"}<br><em>${escapeHtml(devis.compagnie || "Compagnie à confirmer")}</em></h1>
    <p class="sub">Préparé pour ${escapeHtml(lead?.client_name || "vous")}. Ce devis reprend la meilleure option disponible sur cette route, à conditions négociées Ola Flight.</p>
  </div>

  <div class="grid-2">
    <div class="cell">
      <div class="cell-label">Compagnie</div>
      <div class="cell-val">${escapeHtml(devis.compagnie || "—")}</div>
    </div>
    <div class="cell">
      <div class="cell-label">Classe</div>
      <div class="cell-val">${escapeHtml(lead?.classe || "—")}</div>
      <div class="cell-sub">${Number(lead?.passagers) || 1} passager${(Number(lead?.passagers) || 1) > 1 ? "s" : ""}</div>
    </div>
    <div class="cell">
      <div class="cell-label">Dates</div>
      <div class="cell-val">${escapeHtml(lead?.dates || "—")}</div>
    </div>
    <div class="cell">
      <div class="cell-label">Horaires</div>
      <div class="cell-val">${escapeHtml(devis.horaire_dep || "—")} → ${escapeHtml(devis.horaire_arr || "—")}</div>
    </div>
  </div>

  <section class="price-block">
    <div class="price-row">
      <div class="pr-l">Prix marché</div>
      <div class="pr-v pr-strike">${fmtMoney(devis.prix_marche)}</div>
    </div>
    <div class="price-sep"></div>
    <div class="price-row">
      <div class="pr-l">Tarif Ola Flight</div>
      <div class="pr-v pr-final">${fmtMoney(devis.prix_vente)}</div>
    </div>
    ${economie > 0 ? `
    <div class="price-row">
      <div class="pr-l">Votre économie</div>
      <div class="pr-saving">− ${fmtMoney(economie)} (${economiePct}%)</div>
    </div>` : ""}
  </section>

  ${services.length > 0 ? `
  <section class="services">
    <div class="services-title">Services inclus</div>
    <div class="services-grid">
      ${services.map((s) => `<div class="service">${escapeHtml(s)}</div>`).join("")}
    </div>
  </section>` : ""}

  <footer class="validity">
    <div>
      <div class="validity-l">Tarif valable 24 h</div>
      <div class="validity-d">Expiration : ${fmtDate(devis.valide_jusqu_au)}</div>
    </div>
    <div class="footer-note">
      Ola Flight — conciergerie de voyage premium.<br>
      Pour finaliser, votre conseillère prendra le relais en visio.
    </div>
  </footer>

</div>
</body>
</html>`;
}
