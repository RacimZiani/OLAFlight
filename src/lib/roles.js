// Rôles Ola Flight — source de vérité (admin / prospecteur / closer).

export const ROLES = {
  ADMIN: "admin",
  PROSPECTEUR: "prospecteur",
  CLOSER: "closer",
};

/** Rôles legacy encore acceptés en base / JWT. */
export const LEGACY_ROLE_ALIASES = {
  dalsim: ROLES.PROSPECTEUR,
  closeuse: ROLES.CLOSER,
  agent: ROLES.PROSPECTEUR,
};

export function normalizeRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (LEGACY_ROLE_ALIASES[r]) return LEGACY_ROLE_ALIASES[r];
  if (r === ROLES.ADMIN || r === ROLES.PROSPECTEUR || r === ROLES.CLOSER) return r;
  return r || "guest";
}

export function roleLabel(role) {
  const r = normalizeRole(role);
  if (r === ROLES.ADMIN) return "Admin";
  if (r === ROLES.PROSPECTEUR) return "Prospecteur";
  if (r === ROLES.CLOSER) return "Closer";
  return r;
}

export const BACKOFFICE_ROLES = [
  ROLES.ADMIN,
  ROLES.PROSPECTEUR,
  ROLES.CLOSER,
  "dalsim",
  "closeuse",
  "agent",
];

export const DEVIS_ROLES = [...BACKOFFICE_ROLES];

export function isBackofficeRole(role) {
  return BACKOFFICE_ROLES.includes(normalizeRole(role)) || BACKOFFICE_ROLES.includes(String(role || ""));
}

export function hasRole(user, ...allowed) {
  if (!user?.role) return false;
  const norm = normalizeRole(user.role);
  const expanded = new Set(
    allowed.flatMap((a) => {
      const n = normalizeRole(a);
      return [a, n, ...Object.entries(LEGACY_ROLE_ALIASES).filter(([, v]) => v === n).map(([k]) => k)];
    })
  );
  return expanded.has(user.role) || expanded.has(norm);
}

export function isAdmin(user) {
  return normalizeRole(user?.role) === ROLES.ADMIN;
}

/** Le lead appartient-il à cet utilisateur ? */
export function canAccessLead(user, lead) {
  if (!user || !lead) return false;
  const role = normalizeRole(user.role);
  if (role === ROLES.ADMIN) return true;
  if (role === ROLES.CLOSER) {
    return Boolean(lead.closer_name && lead.closer_name === user.email);
  }
  if (role === ROLES.PROSPECTEUR) {
    return Boolean(lead.apporteur_name && lead.apporteur_name === user.email);
  }
  return false;
}

export function filterLeadsForUser(items, user) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.CLOSER) {
    return items.filter((l) => l.closer_name && l.closer_name === user.email);
  }
  if (role === ROLES.PROSPECTEUR) {
    return items.filter((l) => l.apporteur_name && l.apporteur_name === user.email);
  }
  return items;
}

/** Notifications prospecteur : négociation + gagné, pas perdu. */
export function prospecteurWantsNotif(status) {
  return ["nego", "won", "devis_sent", "interested", "call_booked"].includes(String(status || ""));
}
