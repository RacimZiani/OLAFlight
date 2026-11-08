// Commission concierge : rattache un devis à sa concierge et calcule sa part.
//
// Le devis appartient à une concierge si :
//   1) c'est elle qui le crée, ou
//   2) son lead est closé par une concierge (lead.closer_name = son email).
// La commission est un % de la marge (users.commission_rate, 15 % par défaut),
// figée sur le devis au moment du calcul (snapshot, comme les autres commissions).

import { normalizeRole, ROLES } from "./roles.js";
import { computeConciergeCommission, conciergeRate } from "./commissions.js";

async function findUserByEmail(store, email) {
  if (!email || !store.users) return null;
  if (store.users.findByField) return store.users.findByField("email", String(email).toLowerCase());
  const all = await store.users.list();
  return all.find((u) => u.email === email) || null;
}

/** Renvoie l'utilisateur concierge propriétaire, ou null. */
export async function resolveConciergeOwner(store, { user, lead, conciergeName } = {}) {
  if (user && normalizeRole(user.role) === ROLES.CONCIERGE && user.email) {
    return (await findUserByEmail(store, user.email)) || { email: user.email, role: ROLES.CONCIERGE };
  }
  const email = conciergeName || lead?.closer_name;
  if (!email) return null;
  const owner = await findUserByEmail(store, email);
  return owner && normalizeRole(owner.role) === ROLES.CONCIERGE ? owner : null;
}

/** Champs à poser sur le devis : { concierge_name, concierge_commission } ou {}. */
export async function conciergeFields(store, { user, lead, conciergeName, prix_vente, prix_revient }) {
  const owner = await resolveConciergeOwner(store, { user, lead, conciergeName });
  if (!owner) return {};
  return {
    concierge_name: owner.email,
    concierge_commission: computeConciergeCommission({ prix_vente, prix_revient, rate: conciergeRate(owner) }),
  };
}

/** Une concierge voit aussi les devis qui portent son nom, même sans lead. */
export function isOwnConciergeDevis(user, devis) {
  return (
    normalizeRole(user?.role) === ROLES.CONCIERGE &&
    Boolean(user.email) &&
    devis?.concierge_name === user.email
  );
}
