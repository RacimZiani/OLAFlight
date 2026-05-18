// Dates de voyage : contexte « aujourd'hui » + parsing FR (ex. « 15 août » → 2026).

const MONTHS_FR = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

const MONTH_LABEL_FR = [
  "",
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function getTodayContext(ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const d = ref.getDate();
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  const labelFr = `${d} ${MONTH_LABEL_FR[m]} ${y}`;
  return { iso, year: y, month: m, day: d, labelFr, date: ref };
}

/**
 * Année intelligente : « 15 août » sans année → année courante ou suivante si déjà passé.
 */
export function inferTravelYear(month, day, ref = new Date()) {
  const y = ref.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (candidate < startOfToday) return y + 1;
  return y;
}

/** Corrige une année explicite trop dans le passé (ex. 2024 alors qu'on est en 2026). */
export function normalizeTravelYear(year, month, day, ref = new Date()) {
  const y = Number(year);
  if (!Number.isFinite(y)) return ref.getFullYear();
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const asDate = new Date(y, month - 1, day);
  if (asDate < startOfToday && y <= ref.getFullYear()) {
    return inferTravelYear(month, day, ref);
  }
  return y;
}

export function toIsoDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function formatFrenchDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "";
  const month = Number(m[2]);
  const day = Number(m[3]);
  return `${day} ${MONTH_LABEL_FR[month] || m[2]} ${m[1]}`;
}

/**
 * Parse un fragment (« 15 août », « 15/08/2026 », « 2026-08-15 »).
 * @returns {{ depart: string|null, ret: string|null, label: string }}
 */
export function parseTravelDatesFromText(text, ref = new Date()) {
  const s = String(text || "").trim();
  if (!s) return { depart: null, ret: null, label: "" };

  // ISO
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const label = formatFrenchDate(iso[0]);
    return { depart: iso[0], ret: null, label };
  }

  // 15/08/2026 ou 15-08-2026
  const dmy = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = normalizeTravelYear(Number(dmy[3]), month, day, ref);
    const depart = toIsoDate(year, month, day);
    return { depart, ret: null, label: formatFrenchDate(depart) };
  }

  // 15 août 2026 ou 15 août
  const fr = s.match(
    /\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(20\d{2}))?\b/i
  );
  if (fr) {
    const day = Number(fr[1]);
    const month = MONTHS_FR[fr[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] || MONTHS_FR[fr[2].toLowerCase()];
    if (month) {
      const year = fr[3]
        ? normalizeTravelYear(Number(fr[3]), month, day, ref)
        : inferTravelYear(month, day, ref);
      const depart = toIsoDate(year, month, day);
      return { depart, ret: null, label: formatFrenchDate(depart) };
    }
  }

  // « mi-août », « début septembre » → 15 du mois
  const monthOnly = s.match(
    /\b(?:mi-|début |debut |fin )?(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(20\d{2}))?\b/i
  );
  if (monthOnly) {
    const key = monthOnly[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const month = MONTHS_FR[key];
    if (month) {
      const day = /début|debut/i.test(s) ? 5 : /fin/i.test(s) ? 25 : 15;
      const year = monthOnly[2]
        ? normalizeTravelYear(Number(monthOnly[2]), month, day, ref)
        : inferTravelYear(month, day, ref);
      const depart = toIsoDate(year, month, day);
      return { depart, ret: null, label: formatFrenchDate(depart) };
    }
  }

  return { depart: null, ret: null, label: s };
}

const DATE_PATTERNS = [
  /\b(?:le\s+)?(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(20\d{2}))?\b/gi,
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g,
  /\b(20\d{2})-(\d{2})-(\d{2})\b/g,
  /\b(?:mi-|début |debut |fin )?(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(20\d{2}))?\b/gi,
];

/**
 * Extrait dates de voyage depuis les messages utilisateur.
 */
export function extractTravelDatesFromMessages(messages, ref = new Date()) {
  let depart = null;
  let ret = null;
  let label = "";
  let oneWay = false;
  let passagers = null;

  const userTexts = (messages || [])
    .filter((m) => m.role === "user")
    .map((m) => String(m.content || ""));

  for (const text of userTexts) {
    if (/\b(aller\s+simple|one\s*way|sans\s+retour)\b/i.test(text)) oneWay = true;
    if (/\b(aller[-\s]?retour|round\s*trip|a\/r)\b/i.test(text)) oneWay = false;

    const pax = text.match(/\b(\d)\s*(?:personnes?|pax|passagers?|adultes?)\b/i)
      || text.match(/\b(?:pour|seul(?:e)?)\s+(?:moi|1)\b/i);
    if (pax) passagers = pax[1] ? Number(pax[1]) : 1;
    if (/\b(?:seul|solo|une\s+personne|1\s+pax)\b/i.test(text)) passagers = 1;

    for (const re of DATE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const parsed = parseTravelDatesFromText(m[0], ref);
        if (parsed.depart) {
          if (!depart) depart = parsed.depart;
          else if (!ret && parsed.depart !== depart) ret = parsed.depart;
          label = parsed.label || label;
        }
      }
    }

    const whole = parseTravelDatesFromText(text, ref);
    if (whole.depart) {
      if (!depart) depart = whole.depart;
      else if (!ret && whole.depart !== depart) ret = whole.depart;
      if (whole.label) label = whole.label;
    }
  }

  if (depart && !label) label = formatFrenchDate(depart);
  if (oneWay) ret = "";

  return { depart, ret: ret || "", label, oneWay, passagers };
}

export function reconcileScrapeDepart({ depart, confirmed, ref = new Date() }) {
  const out = { depart: String(depart || ""), corrected: false, reason: "" };
  const today = getTodayContext(ref);

  if (confirmed?.depart && /^\d{4}-\d{2}-\d{2}$/.test(confirmed.depart)) {
    if (out.depart !== confirmed.depart) {
      out.depart = confirmed.depart;
      out.corrected = true;
      out.reason = `date corrigée → ${confirmed.depart}`;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(out.depart) && out.depart < today.iso) {
    const [, y, m, d] = out.depart.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
    const year = inferTravelYear(Number(m), Number(d), ref);
    const fixed = toIsoDate(year, Number(m), Number(d));
    out.reason = (out.reason ? out.reason + "; " : "") + `date passée ${out.depart} → ${fixed}`;
    out.depart = fixed;
    out.corrected = true;
  }

  return out;
}

export function formatLeadDatesLabel({ depart, ret, oneWay, label }) {
  const parts = [];
  if (label) parts.push(label);
  else if (depart) parts.push(formatFrenchDate(depart));
  if (oneWay) parts.push("aller simple");
  else if (ret) parts.push(`retour ${formatFrenchDate(ret)}`);
  if (depart && !label?.includes(depart.slice(0, 4))) {
    return `${parts.join(" · ")} (${depart}${ret ? ` → ${ret}` : ""})`;
  }
  return parts.join(" · ");
}
