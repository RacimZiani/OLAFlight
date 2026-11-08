// Catalogue des prestations de conciergerie.
//
// Source unique : utilisé par l'API (validation, PDF) et servi au front
// (GET /api/devis/catalog) pour construire le formulaire de devis.
// Ajouter un service = ajouter une entrée ici, rien d'autre à toucher.
//
// fields : détails propres au service, affichés sous la ligne dans le PDF.

export const SERVICE_CATALOG = [
  {
    type: "vol",
    label: "Vol",
    defaultTitle: "Vol en classe affaires",
    fields: [
      { key: "trajet", label: "Trajet", placeholder: "Paris → Dubaï" },
      { key: "dates", label: "Dates", placeholder: "12 → 19 décembre" },
      { key: "classe", label: "Classe", placeholder: "Business" },
      { key: "passagers", label: "Passagers", placeholder: "2" },
    ],
  },
  {
    type: "hotel",
    label: "Hôtel & villa",
    defaultTitle: "Séjour",
    fields: [
      { key: "etablissement", label: "Établissement", placeholder: "Four Seasons George V" },
      { key: "ville", label: "Ville", placeholder: "Paris" },
      { key: "dates", label: "Dates", placeholder: "12 → 15 décembre" },
      { key: "chambre", label: "Chambre", placeholder: "Suite, vue Tour Eiffel" },
    ],
  },
  {
    type: "chauffeur",
    label: "Chauffeur privé",
    defaultTitle: "Chauffeur privé",
    fields: [
      { key: "prise_en_charge", label: "Prise en charge", placeholder: "CDG terminal 2E" },
      { key: "depose", label: "Dépose", placeholder: "Hôtel Plaza Athénée" },
      { key: "date", label: "Date", placeholder: "12 décembre, 14 h" },
      { key: "vehicule", label: "Véhicule", placeholder: "Mercedes Classe S" },
      { key: "duree", label: "Durée", placeholder: "Mise à disposition 4 h" },
    ],
  },
  {
    type: "personal_shopping",
    label: "Personal shopping",
    defaultTitle: "Personal shopping",
    fields: [
      { key: "marque", label: "Maison", placeholder: "Hermès" },
      { key: "article", label: "Article", placeholder: "Birkin 30" },
      { key: "reference", label: "Coloris / référence", placeholder: "Gold, Togo, GHW" },
      { key: "delai", label: "Délai", placeholder: "Livraison sous 10 jours" },
    ],
  },
  {
    type: "horlogerie",
    label: "Horlogerie & joaillerie",
    defaultTitle: "Horlogerie",
    fields: [
      { key: "marque", label: "Maison", placeholder: "Patek Philippe" },
      { key: "modele", label: "Modèle", placeholder: "Nautilus" },
      { key: "reference", label: "Référence", placeholder: "5711/1A-010" },
      { key: "etat", label: "État", placeholder: "Neuve, boîte et papiers" },
      { key: "delai", label: "Délai", placeholder: "Disponible sous 7 jours" },
    ],
  },
  {
    type: "jet_yacht",
    label: "Jet privé & yacht",
    defaultTitle: "Jet privé",
    fields: [
      { key: "appareil", label: "Appareil / bateau", placeholder: "Falcon 7X" },
      { key: "trajet", label: "Trajet / zone", placeholder: "Nice → Mykonos" },
      { key: "date", label: "Date", placeholder: "3 juillet" },
      { key: "passagers", label: "Passagers", placeholder: "6" },
    ],
  },
  {
    type: "experience",
    label: "Expérience & événement",
    defaultTitle: "Expérience privée",
    fields: [
      { key: "lieu", label: "Lieu", placeholder: "Monaco" },
      { key: "date", label: "Date", placeholder: "Grand Prix, 25 mai" },
      { key: "personnes", label: "Personnes", placeholder: "4" },
    ],
  },
  {
    type: "sur_mesure",
    label: "Sur-mesure",
    defaultTitle: "Prestation sur-mesure",
    fields: [],
  },
];

const BY_TYPE = new Map(SERVICE_CATALOG.map((s) => [s.type, s]));

export function getServiceType(type) {
  return BY_TYPE.get(type) || BY_TYPE.get("sur_mesure");
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Nettoie les lignes reçues du front et calcule les totaux.
 * Une ligne « sur devis » n'a pas de prix et n'entre pas dans le total.
 * @returns {{ prestations, prix_vente, prix_revient, has_sur_devis }}
 */
export function normalizePrestations(lines) {
  const prestations = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      const def = getServiceType(l?.type);
      const details = {};
      for (const f of def.fields) {
        const v = String(l?.details?.[f.key] ?? "").trim();
        if (v) details[f.key] = v.slice(0, 200);
      }
      const sur_devis = Boolean(l?.sur_devis);
      return {
        type: def.type,
        titre: String(l?.titre || "").trim().slice(0, 160) || def.defaultTitle,
        details,
        description: String(l?.description || "").trim().slice(0, 1000),
        quantite: Math.max(1, Math.round(num(l?.quantite) || 1)),
        prix_unitaire: sur_devis ? null : num(l?.prix_unitaire),
        prix_achat_unitaire: num(l?.prix_achat_unitaire),
        sur_devis,
      };
    })
    .filter((l) => l.titre);

  let prix_vente = 0;
  let prix_revient = 0;
  for (const l of prestations) {
    if (l.sur_devis) continue;
    prix_vente += l.prix_unitaire * l.quantite;
    prix_revient += l.prix_achat_unitaire * l.quantite;
  }
  return {
    prestations,
    prix_vente: Math.round(prix_vente * 100) / 100,
    prix_revient: Math.round(prix_revient * 100) / 100,
    has_sur_devis: prestations.some((l) => l.sur_devis),
  };
}

/** Version publique (PDF, closers) : sans prix d'achat. */
export function publicPrestations(prestations) {
  return (Array.isArray(prestations) ? prestations : []).map(({ prix_achat_unitaire, ...rest }) => rest);
}
