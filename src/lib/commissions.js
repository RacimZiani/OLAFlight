// ─────────────────────────────────────────────────────────────
// Règles métier Ola Flight — calcul marge & commissions.
// Source de vérité unique : aussi utilisée par le PDF, le CRM, l'agent IA.
// Si tu changes une formule ici, elle change PARTOUT — c'est volontaire.
// ─────────────────────────────────────────────────────────────

import { publicPrestations } from "./serviceCatalog.js";

export const COMMISSION_RATES = {
  closer: 0.10,   // 10 % de la marge nette
  apporteur: 0.05, // 5 % de la marge nette (uniquement si apporteur attribué)
  concierge: 0.15, // 15 % de la marge nette — taux par défaut, réglable par concierge (users.commission_rate)
};

/** Taux effectif d'une concierge (fraction) : users.commission_rate en %, sinon 15 %. */
export function conciergeRate(user) {
  const pct = Number(user?.commission_rate);
  if (Number.isFinite(pct) && pct >= 0 && pct <= 100 && user?.commission_rate !== null && user?.commission_rate !== "") {
    return pct / 100;
  }
  return COMMISSION_RATES.concierge;
}

/** Commission concierge : un % de la marge, 0 si la marge est négative. */
export function computeConciergeCommission({ prix_vente, prix_revient, rate }) {
  const marge = computeMargin(prix_vente, prix_revient);
  return marge > 0 ? Math.round(marge * rate) : 0;
}

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
  if (r === "concierge") {
    // La concierge fixe elle-même prix d'achat et prix de vente : elle voit sa
    // marge et SA commission, jamais celles des autres rôles. Le filtrage par
    // propriétaire (ses clients uniquement) est fait en amont dans les routes.
    delete clone.closer_commission;
    delete clone.apporteur_commission;
    return clone;
  }
  for (const f of PRIVATE_FINANCIAL_FIELDS) delete clone[f];
  delete clone.concierge_commission;
  // Prix d'achat ligne par ligne (devis conciergerie) : même règle que prix_revient.
  if (Array.isArray(clone.prestations)) clone.prestations = publicPrestations(clone.prestations);
  return clone;
}
