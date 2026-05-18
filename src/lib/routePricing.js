// Fourchettes de prix indicatives (aller simple / A-R) quand le scrape échoue ou pour valider le LLM.

const LONGHAUL = new Set([
  "JFK", "EWR", "LAX", "MIA", "DXB", "DOH", "HND", "NRT", "SIN", "BKK", "HKG", "GRU", "YYZ", "YUL",
]);

const MAGHREB = new Set(["ALG", "ORN", "AAE", "CZL", "TUN", "CMN", "RAK", "DSS", "TNG", "FEZ"]);

function isLonghaul(from, to) {
  return LONGHAUL.has(from) || LONGHAUL.has(to);
}

function isMaghreb(from, to) {
  return MAGHREB.has(from) || MAGHREB.has(to);
}

/**
 * Fourchettes € pour 1 adulte (indicatif marché public).
 * @returns {{ express: [number,number], confort: [number,number], premium: [number,number], note: string, one_way: boolean }}
 */
export function getRoutePriceHints({ from, to, oneWay = true, cabin = "" }) {
  const f = String(from || "").toUpperCase();
  const t = String(to || "").toUpperCase();
  const ar = oneWay ? 1 : 1.75;
  const isBiz = /business|biz/i.test(cabin);
  const isFirst = /first|premi/i.test(cabin);

  let express;
  let confort;
  let premium;
  let note;

  if (isMaghreb(f, t)) {
    express = [Math.round(75 * ar), Math.round(165 * ar)];
    confort = [Math.round(140 * ar), Math.round(240 * ar)];
    premium = isBiz || isFirst
      ? [Math.round(280 * ar), Math.round(480 * ar)]
      : [Math.round(200 * ar), Math.round(360 * ar)];
    note = "Europe–Maghreb : eco aller simple souvent 80–180 € ; Business 280–480 €.";
  } else if (isLonghaul(f, t)) {
    express = [Math.round(450 * ar), Math.round(750 * ar)];
    confort = [Math.round(900 * ar), Math.round(1400 * ar)];
    premium = [Math.round(2200 * ar), Math.round(3800 * ar)];
    note = "Long-courrier : fourchettes A/R premium ; diviser ~1,7 pour aller simple.";
  } else {
    express = [Math.round(60 * ar), Math.round(140 * ar)];
    confort = [Math.round(120 * ar), Math.round(220 * ar)];
    premium = isBiz
      ? [Math.round(250 * ar), Math.round(450 * ar)]
      : [Math.round(180 * ar), Math.round(320 * ar)];
    note = "Court/moyen courrier Europe : eco 60–180 € AS ; Business 250–450 € AS.";
  }

  return { express, confort, premium, note, one_way: oneWay, route: `${f}-${t}` };
}

/** Vérifie si un prix aller simple semble aberrant pour la route. */
export function isPricePlausible({ price, from, to, oneWay = true, cabin = "" }) {
  const hints = getRoutePriceHints({ from, to, oneWay, cabin });
  const max = hints.premium[1] * 1.35;
  const min = hints.express[0] * 0.65;
  return price >= min && price <= max;
}
