// ─────────────────────────────────────────────────────────────────────────
// Template PDF brandé Ola Flight (DSL identique à brief.html / index.html :
// Cormorant Garamond + Montserrat, palette black/cream).
//
// ⚠ RÈGLE S01 (brief.html section 05) :
//    `prix_revient` ne DOIT JAMAIS apparaître dans ce template — on ne le
//    reçoit même pas en argument. C'est le call-site qui sanitize avant.
// ─────────────────────────────────────────────────────────────────────────

import { OLA_LOGO_DATA_URI } from "./olaLogo.js";

const FALLBACK_LOGO = OLA_LOGO_DATA_URI;

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
  // Particulier : on cache complètement le comparatif marché (rien de barré,
  // aucune mention de "Référence marché" — le client peut être déstabilisé).
  const isParticulier = String(lead?.client_type || devis?.client_type || "").toLowerCase() === "particulier";
  const marche = Number(devis.prix_marche) || 0;
  const ola = Number(devis.prix_vente) || 0;
  const showMarketCompare = !isParticulier && marche > 0 && ola > 0 && marche > ola * 1.05;
  const economie = showMarketCompare ? Math.max(0, marche - ola) : 0;
  const economiePct = showMarketCompare ? Math.round((economie / marche) * 100) : 0;
  const trajet = lead?.destination || "—";

  // Options : si plusieurs options (max 3), on bascule en mode comparatif.
  const optsRaw = Array.isArray(devis.options) ? devis.options : [];
  const opts = optsRaw.filter((o) => o && Number(o.prix_vente) > 0).slice(0, 3);
  const multi = opts.length >= 2;

  // Extras (toujours affichés s'ils sont présents).
  const hotelsRaw = Array.isArray(devis.hotels) ? devis.hotels : [];
  const hotels = hotelsRaw.filter((h) => h && (h.name || h.total_price));
  const driver = devis.driver && (devis.driver.pickup || devis.driver.vehicle || devis.driver.total_price)
    ? devis.driver
    : null;

  const logoSrc = companyLogo || FALLBACK_LOGO;
  const brandLogoHtml = logoSrc
    ? `<img class="brand-logo-img" src="${logoSrc}" alt="Ola Flight" />`
    : `<div class="brand-logo-fallback">Ō</div>`;

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
  .brand-logo-fallback{ width:40px; height:40px; border:1px solid var(--l2); display:flex; align-items:center; justify-content:center; font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:200; }
  .brand-logo-img{
    height:52px; width:auto; max-width:72mm;
    display:block; object-fit:contain;
    background:transparent;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
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

  /* OPTIONS COMPARATIVES */
  .opts{ margin-top:6mm; display:grid; grid-template-columns: repeat(${Math.max(1, opts.length || 1)}, 1fr); gap:1px; background:var(--l); border:1px solid var(--l); }
  .opt{ background:var(--b2); padding:6mm 5mm; display:flex; flex-direction:column; gap:6px; position:relative; }
  .opt.recommended{ background:var(--b3); }
  .opt-badge{ position:absolute; top:-1px; left:-1px; background:var(--gold); color:var(--b); font-family:'Montserrat',sans-serif; font-size:7px; font-weight:300; letter-spacing:2px; text-transform:uppercase; padding:4px 9px; }
  .opt-label{ font-family:'Montserrat',sans-serif; font-size:8px; font-weight:300; letter-spacing:3px; text-transform:uppercase; color:var(--gold); margin-top:8px; }
  .opt-name{ font-size:18px; color:var(--w); margin-top:2px; }
  .opt-meta{ font-family:'Montserrat',sans-serif; font-size:8px; color:var(--g); letter-spacing:1px; margin-top:4px; }
  .opt-price{ font-family:'Cormorant Garamond',serif; font-size:28px; font-weight:200; color:var(--w); margin-top:8px; }
  .opt-market{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g2); text-decoration:line-through; }
  .opt-saving{ font-family:'Montserrat',sans-serif; font-size:8px; color:var(--green); letter-spacing:1px; margin-top:2px; }
  .opt-services{ list-style:none; padding:0; margin-top:8px; display:flex; flex-direction:column; gap:3px; }
  .opt-services li{ font-size:12px; color:var(--g); padding-left:10px; position:relative; }
  .opt-services li::before{ content:'›'; color:var(--gold); position:absolute; left:0; top:-1px; }

  .services{ margin-top:8mm; }
  .services-title{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:4px; text-transform:uppercase; color:var(--w); padding-bottom:6px; border-bottom:1px solid var(--l); margin-bottom:8px; }
  .services-grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; }
  .service{ display:flex; align-items:flex-start; gap:8px; padding:5px 0; font-size:13px; color:var(--g); }
  .service::before{ content:'›'; color:var(--gold); font-family:'Cormorant Garamond',serif; font-size:18px; line-height:1; margin-top:2px; }

  /* EXTRAS — hôtels & chauffeur */
  .extras{ margin-top:8mm; }
  .extra-title{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:4px; text-transform:uppercase; color:var(--gold); padding-bottom:6px; border-bottom:1px solid var(--l); margin-bottom:8px; }
  .hotels-grid{ display:grid; grid-template-columns:repeat(${Math.max(1, hotels.length || 1)}, 1fr); gap:1px; background:var(--l); border:1px solid var(--l); }
  .hotel-card{ background:var(--b2); padding:5mm 4mm; }
  .hotel-name{ font-size:15px; color:var(--w); margin-bottom:2px; }
  .hotel-meta{ font-family:'Montserrat',sans-serif; font-size:8px; letter-spacing:1px; color:var(--g); }
  .hotel-stars{ color:var(--gold); letter-spacing:2px; font-size:11px; }
  .hotel-price{ font-family:'Cormorant Garamond',serif; font-size:20px; color:var(--w); margin-top:4px; }
  .hotel-price-sub{ font-family:'Montserrat',sans-serif; font-size:8px; color:var(--g); }
  .driver-card{ background:var(--b2); padding:6mm 5mm; border:1px solid var(--l); display:grid; grid-template-columns:1fr auto; gap:14px; align-items:center; }
  .driver-l{ display:flex; flex-direction:column; gap:3px; }
  .driver-vehicle{ font-size:16px; color:var(--w); }
  .driver-route{ font-family:'Montserrat',sans-serif; font-size:9px; color:var(--g); letter-spacing:1px; line-height:1.5; }
  .driver-price{ font-family:'Cormorant Garamond',serif; font-size:24px; color:var(--gold); }

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
      ${brandLogoHtml}
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
      <div class="cell-label">Aéroports</div>
      <div class="cell-val">${escapeHtml((opts[0]?.aeroport_dep || devis.horaire_dep || "—").split(" · ")[0])}</div>
      <div class="cell-sub">→ ${escapeHtml((opts[0]?.aeroport_arr || devis.horaire_arr || "—").split(" · ")[0])}</div>
    </div>
  </div>

  ${multi ? `
  <section class="opts">
    ${opts.map((o, i) => {
      const oMarche = Number(o.prix_marche) || 0;
      const oVente  = Number(o.prix_vente)  || 0;
      const showCmp = !isParticulier && oMarche > 0 && oVente > 0 && oMarche > oVente * 1.05;
      const eco     = showCmp ? Math.max(0, oMarche - oVente) : 0;
      const ecoPct  = showCmp ? Math.round((eco / oMarche) * 100) : 0;
      const isReco  = i === Math.min(1, opts.length - 1); // option du milieu = recommandée
      const stopsTxt = (typeof o.stops === "number")
        ? (o.stops === 0 ? "Sans escale" : `${o.stops} escale${o.stops > 1 ? "s" : ""}`)
        : "";
      return `
      <div class="opt${isReco ? " recommended" : ""}">
        ${isReco ? `<div class="opt-badge">Recommandé</div>` : ""}
        <div class="opt-label">${escapeHtml(o.label || (i === 0 ? "Express" : i === 1 ? "Confort" : "Premium"))}</div>
        <div class="opt-name">${escapeHtml(o.compagnie || "Compagnie à confirmer")}</div>
        <div class="opt-meta">
          ${o.aeroport_dep ? `<strong>Départ :</strong> ${escapeHtml(o.aeroport_dep)}<br>` : ""}
          ${o.aeroport_arr ? `<strong>Arrivée :</strong> ${escapeHtml(o.aeroport_arr)}` : escapeHtml(o.horaire_dep || "—") + " → " + escapeHtml(o.horaire_arr || "—")}
          ${o.duration ? " · " + escapeHtml(o.duration) : ""}${stopsTxt ? " · " + stopsTxt : ""}
        </div>
        ${showCmp ? `<div class="opt-market">${fmtMoney(o.prix_marche)}</div>` : ""}
        <div class="opt-price" ${isReco ? `style="color:var(--gold)"` : ""}>${fmtMoney(o.prix_vente)}</div>
        ${eco > 0 ? `<div class="opt-saving">économie ${fmtMoney(eco)} (${ecoPct}%)</div>` : ""}
        ${(Array.isArray(o.services_inclus) && o.services_inclus.length) ? `
        <ul class="opt-services">
          ${o.services_inclus.slice(0,5).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ul>` : ""}
      </div>`;
    }).join("")}
  </section>
  ` : `
  <section class="price-block">
    ${showMarketCompare ? `
    <div class="price-row">
      <div class="pr-l">Référence marché (équivalent)</div>
      <div class="pr-v pr-strike">${fmtMoney(devis.prix_marche)}</div>
    </div>
    <div class="price-sep"></div>
    ` : `
    <div class="price-row">
      <div class="pr-l">Pack Ola Flight</div>
      <div class="pr-v" style="color:var(--g)">Services premium + réservation</div>
    </div>
    <div class="price-sep"></div>
    `}
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
  `}

  ${(!multi && services.length > 0) ? `
  <section class="services">
    <div class="services-title">Services inclus</div>
    <div class="services-grid">
      ${services.map((s) => `<div class="service">${escapeHtml(s)}</div>`).join("")}
    </div>
  </section>` : ""}

  ${hotels.length > 0 ? `
  <section class="extras">
    <div class="extra-title">Hôtels proposés</div>
    <div class="hotels-grid">
      ${hotels.map((h) => {
        const stars = Number(h.stars) > 0 ? "★".repeat(Math.min(5, Number(h.stars))) : "";
        const total = Number(h.total_price) > 0 ? fmtMoney(h.total_price) : "—";
        const ppn = Number(h.price_per_night) > 0
          ? `${fmtMoney(h.price_per_night)} / nuit${h.nights ? ` × ${h.nights} nuits` : ""}`
          : (h.nights ? `${h.nights} nuit${h.nights > 1 ? "s" : ""}` : "");
        return `
        <div class="hotel-card">
          <div class="hotel-stars">${stars}</div>
          <div class="hotel-name">${escapeHtml(h.name || "Hôtel")}</div>
          <div class="hotel-meta">${escapeHtml(h.area || "")}</div>
          <div class="hotel-price">${total}</div>
          ${ppn ? `<div class="hotel-price-sub">${escapeHtml(ppn)}</div>` : ""}
          ${h.notes ? `<div class="hotel-meta" style="margin-top:6px">${escapeHtml(h.notes)}</div>` : ""}
        </div>`;
      }).join("")}
    </div>
  </section>` : ""}

  ${driver ? `
  <section class="extras">
    <div class="extra-title">Chauffeur privé</div>
    <div class="driver-card">
      <div class="driver-l">
        <div class="driver-vehicle">${escapeHtml(driver.vehicle || "Véhicule premium")}${driver.hours ? ` · ${driver.hours} h` : ""}</div>
        <div class="driver-route">
          ${driver.pickup ? `<strong>Prise en charge :</strong> ${escapeHtml(driver.pickup)}<br>` : ""}
          ${driver.dropoff ? `<strong>Dépose :</strong> ${escapeHtml(driver.dropoff)}` : ""}
          ${driver.notes ? `<br><em>${escapeHtml(driver.notes)}</em>` : ""}
        </div>
      </div>
      <div class="driver-price">${Number(driver.total_price) > 0 ? fmtMoney(driver.total_price) : "Sur devis"}</div>
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
