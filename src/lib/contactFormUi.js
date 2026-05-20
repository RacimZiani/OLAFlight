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

/** Message utilisateur structuré après soumission du formulaire. */
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
