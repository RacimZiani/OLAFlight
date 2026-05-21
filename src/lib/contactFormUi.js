// Détection / marqueur formulaire identité (chat web).

export const CONTACT_FORM_MARKER = "<!--OLA_CONTACT_FORM-->";

const CONTACT_PATTERNS = [
  /pr[ée]nom.*nom.*(?:email|e-mail|mail|t[ée]l[ée]phone|num[ée]ro)/is,
  /(?:email|e-mail|mail).*(?:t[ée]l[ée]phone|num[ée]ro|whatsapp)/is,
  /pour pr[ée]parer le devis.*(?:pr[ée]nom|nom|email|t[ée]l)/is,
  /your (?:first name|last name|email|phone)/i,
  /first name.*last name.*email/i,
];

export function shouldShowContactForm(assistantText, { channel = "web" } = {}) {
  if (String(channel || "").toLowerCase() !== "web") return false;
  const t = String(assistantText || "");
  if (t.includes(CONTACT_FORM_MARKER)) return true;
  return CONTACT_PATTERNS.some((re) => re.test(t));
}

export function stripContactFormMarker(text) {
  return String(text || "").replace(CONTACT_FORM_MARKER, "").trim();
}

/** Message utilisateur structuré après soumission du formulaire (ne pas parser comme route). */
export function isContactFormUserMessage(text) {
  const t = String(text || "").trim();
  return (
    /^\s*Identit[eé]\s+client\s*\(formulaire\s+web\)/i.test(t) ||
    /^\s*Client identity\s*\(web form\)/i.test(t)
  );
}

/** Message utilisateur structuré après soumission du formulaire. */
/** Extrait identité depuis le message formulaire web dans l'historique chat. */
export function extractContactFromMessages(messages) {
  for (const m of messages || []) {
    if (m.role !== "user") continue;
    const t = String(m.content || "").trim();
    if (!isContactFormUserMessage(t)) continue;

    const prenom =
      t.match(/(?:pr[ée]nom|first\s*name)\s*:\s*(.+)/i)?.[1]?.trim() || "";
    const nom =
      t.match(/(?:^|\n)\s*[-•]?\s*nom\s*:\s*(.+)/im)?.[1]?.trim() ||
      t.match(/(?:last\s*name|family\s*name)\s*:\s*(.+)/i)?.[1]?.trim() ||
      "";
    const email =
      t.match(/(?:e-?mail|email)\s*:\s*([^\s\n]+)/i)?.[1]?.trim() || "";
    const phone =
      t.match(/(?:t[ée]l[ée]phone|phone|whatsapp|mobile)\s*:\s*([+\d\s().-]+)/i)?.[1]
        ?.trim() || "";

    const client_name = [prenom, nom].filter(Boolean).join(" ").trim();
    if (!client_name && !email && !phone) return null;

    return {
      first_name: prenom,
      last_name: nom,
      client_name,
      email,
      phone,
      client_contact: phone || email,
    };
  }
  return null;
}

export function formatContactFormSubmission({ prenom, nom, email, phoneE164 }) {
  const lines = [
    "Identité client (formulaire web) :",
    `- Prénom : ${prenom}`,
    `- Nom : ${nom}`,
    `- Email : ${email}`,
    `- Téléphone : ${phoneE164}`,
  ];
  return lines.join("\n");
}
