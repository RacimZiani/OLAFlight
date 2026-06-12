// ─────────────────────────────────────────────────────────────
// Règles métier Ola Flight — calcul marge & commissions.
// Source de vérité unique : aussi utilisée par le PDF, le CRM, l'agent IA.
// Si tu changes une formule ici, elle change PARTOUT — c'est volontaire.
// ─────────────────────────────────────────────────────────────

export const COMMISSION_RATES = {
  closer: 0.10,   // 10 % de la marge nette
  apporteur: 0.05, // 5 % de la marge nette (uniquement si apporteur attribué)
};

// Marge négative → toutes les commissions tombent à 0 (règle S04 du brief).
export function computeMargin(prixVente, prixRevient) {
  const v = Number(prixVente) || 0;
  const r = Number(prixRevient) || 0;
  return v - r;
}

export function computeCommissions({ prix_vente, prix_revient, apporteur_name }) {
  const marge = computeMargin(prix_vente, prix_revient);
  const positive = marge > 0;
  return {
    marge,
    closer_commission: positive ? Math.round(marge * COMMISSION_RATES.closer) : 0,
    apporteur_commission:
      positive && apporteur_name ? Math.round(marge * COMMISSION_RATES.apporteur) : 0,
    margin_negative: marge < 0,
  };
}

// Champs financiers à supprimer selon le rôle (règles S01-S02 du brief).
const PRIVATE_FINANCIAL_FIELDS = [
  "prix_revient",
  "marge",
  "closer_commission",
  "apporteur_commission",
];

export function sanitizeDevisForRole(devis, role) {
  const r = String(role || "").toLowerCase();
  if (r === "admin") return devis; // prix_revient + marge : admin seulement
  const clone = { ...devis };
  for (const f of PRIVATE_FINANCIAL_FIELDS) delete clone[f];
  return clone;
}
