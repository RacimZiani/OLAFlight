/**
 * Message client pour les 3 options — même source de vérité que le PDF (prix_vente).
 */

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatStops(stops, lang) {
  if (typeof stops !== "number") return lang === "en" ? "stops TBC" : "escales à confirmer";
  if (stops === 0) return lang === "en" ? "nonstop" : "sans escale";
  if (lang === "en") return stops === 1 ? "1 stop" : `${stops} stops`;
  return stops === 1 ? "1 escale" : `${stops} escales`;
}

const TIER_BENEFIT = {
  Express: {
    fr: "Tarif le plus avantageux",
    en: "Best value fare",
  },
  Confort: {
    fr: "Meilleur équilibre confort / tarif",
    en: "Best comfort / value balance",
  },
  Premium: {
    fr: "Confort et service premium",
    en: "Premium comfort and service",
  },
};

/**
 * @param {object} p
 * @param {Array<object>} p.options — options après priceOption (triées, libellées)
 * @param {string} p.routeLabel — ex. Paris → Bali
 * @param {string} [p.publicPdfUrl]
 * @param {"fr"|"en"} [p.lang]
 * @param {Array} [p.hotels]
 * @param {object} [p.driver]
 */
export function buildClientQuoteMessage({
  options,
  routeLabel,
  publicPdfUrl,
  lang = "fr",
  hotels = [],
  driver = null,
}) {
  const en = lang === "en";
  const opts = (options || []).filter((o) => o && Number(o.prix_vente) > 0).slice(0, 3);
  if (!opts.length) return "";

  const intro = en
    ? `Here are ${opts.length} option${opts.length > 1 ? "s" : ""} for your trip ${routeLabel}:`
    : `Voici ${opts.length} option${opts.length > 1 ? "s" : ""} pour votre voyage ${routeLabel} :`;

  const lines = opts.map((o, i) => {
    const recoIndex = Math.min(1, opts.length - 1);
    const isReco = i === recoIndex;
    const baseLabel = o.label || (i === 0 ? "Express" : i === 1 ? "Confort" : "Premium");
    const label = isReco
      ? en
        ? baseLabel === "Confort"
          ? "Comfort (recommended)"
          : `${baseLabel} (recommended)`
        : baseLabel === "Confort"
          ? "Confort (recommandé)"
          : `${baseLabel} (recommandé)`
      : baseLabel;
    const compagnie = String(o.compagnie || "").trim() || (en ? "Airline TBC" : "Compagnie à confirmer");
    const stops = formatStops(o.stops, lang);
    const benefit = TIER_BENEFIT[baseLabel]?.[lang] || TIER_BENEFIT[baseLabel]?.fr || "";
    return `• **${label}** · ${compagnie} · ${stops} · **${fmtMoney(o.prix_vente)}** — ${benefit}`;
  });

  const parts = [intro, "", ...lines];

  const hotelList = (hotels || []).filter((h) => h && h.name);
  if (hotelList.length) {
    const names = hotelList.map((h) => h.name).join(", ");
    parts.push(
      "",
      en ? `Hotels: ${names}.` : `Côté hôtel : ${names}.`
    );
  }

  if (driver && (driver.vehicle || driver.pickup || driver.total_price)) {
    const veh = driver.vehicle || (en ? "Private transfer" : "Transfert privé");
    const route =
      driver.pickup && driver.dropoff
        ? `${driver.pickup} ↔ ${driver.dropoff}`
        : driver.pickup || driver.dropoff || "";
    parts.push(
      "",
      en
        ? `Private chauffeur: ${veh}${route ? ` · ${route}` : ""}.`
        : `Chauffeur privé : ${veh}${route ? ` · ${route}` : ""}.`
    );
  }

  if (publicPdfUrl) {
    parts.push(
      "",
      en
        ? `Full details: [View quote](${publicPdfUrl})`
        : `Détail complet : [Voir le devis](${publicPdfUrl})`
    );
  }

  return parts.join("\n");
}

/** Pour le tool output / debug — chiffres exacts du PDF. */
export function optionsForToolOutput(options) {
  return (options || []).map((o, i) => ({
    index: i + 1,
    label: o.label,
    compagnie: o.compagnie,
    stops: o.stops,
    prix_vente: o.prix_vente,
    prix_vente_display: fmtMoney(o.prix_vente),
    recommended: i === Math.min(1, (options || []).length - 1),
  }));
}
