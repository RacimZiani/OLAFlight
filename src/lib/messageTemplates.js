// Messages types pour les DM (Instagram / WhatsApp).
//
// Variables remplacées automatiquement :
//   {prenom}    prénom du client          {besoin}  besoin noté sur la fiche
//   {concierge} prénom de la concierge    {devis}   lien du dernier devis
// Une phrase contenant une variable vide est retirée proprement.

import { config } from "../config.js";
import { uid, uuidv4 } from "./ids.js";

export const CATEGORIES = [
  { key: "premier_contact", label: "Premier contact" },
  { key: "relance_1", label: "Relance 1" },
  { key: "relance_2", label: "Relance 2" },
  { key: "relance_3", label: "Dernière relance" },
  { key: "devis", label: "Suivi de devis" },
  { key: "apres_vente", label: "Après-vente" },
  { key: "autre", label: "Autre" },
];

export const DEFAULT_TEMPLATES = [
  { category: "premier_contact", title: "Présentation", body: "Bonjour {prenom}, je suis {concierge}, concierge chez Ola. Nous accompagnons nos clients sur tout ce qui compte : voyages, chauffeurs, pièces rares, réservations introuvables. Y a-t-il quelque chose sur lequel je peux vous aider en ce moment ?" },
  { category: "premier_contact", title: "Suite à une demande", body: "Bonjour {prenom}, merci pour votre message. Je m'occupe personnellement de votre demande ({besoin}). Pouvez-vous me préciser vos dates et vos préférences ? Je reviens vers vous très vite avec une proposition." },
  { category: "relance_1", title: "Petit rappel", body: "Bonjour {prenom}, je me permets de revenir vers vous. Avez-vous eu le temps de réfléchir à votre projet ({besoin}) ? Je reste disponible pour en parler." },
  { category: "relance_2", title: "Nouvelle idée", body: "Bonjour {prenom}, j'ai pensé à vous : nous avons en ce moment de belles disponibilités qui pourraient vous plaire. Voulez-vous que je vous prépare une sélection ?" },
  { category: "relance_3", title: "Dernier message", body: "Bonjour {prenom}, je ne veux pas vous déranger, c'est mon dernier message à ce sujet. Si un jour vous avez besoin de quoi que ce soit, je suis là. Belle journée." },
  { category: "devis", title: "Retour sur la proposition", body: "Bonjour {prenom}, avez-vous pu consulter la proposition que je vous ai envoyée ? Je peux l'ajuster selon vos envies, il suffit de me le dire. La voici : {devis}" },
  { category: "devis", title: "Validité bientôt terminée", body: "Bonjour {prenom}, la proposition que je vous ai préparée arrive bientôt à expiration. Souhaitez-vous que je bloque les disponibilités ?" },
  { category: "apres_vente", title: "Remerciement", body: "Bonjour {prenom}, merci encore pour votre confiance. J'espère que tout s'est passé comme vous le souhaitiez. N'hésitez pas pour la suite, je suis à votre disposition." },
];

/** Remplit les variables ; retire les phrases dont une variable est vide. */
export function renderTemplate(body, vars) {
  const values = {
    prenom: String(vars.prenom || "").trim(),
    besoin: String(vars.besoin || "").trim(),
    concierge: String(vars.concierge || "").trim(),
    devis: String(vars.devis || "").trim(),
  };
  // « (…{besoin}) » vide : on retire juste la parenthèse, la phrase reste.
  const text = String(body).replace(/\s*\(\{(\w+)\}\)/g, (m, k) => (values[k] ? m : ""));
  // Découpe en phrases, garde celles dont toutes les variables sont remplies.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    const used = [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return used.every((k) => k === "prenom" || values[k]);
  });
  return kept
    .join(" ")
    .replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "")
    .replace(/Bonjour ,/g, "Bonjour,")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

/** Insère les messages par défaut si la bibliothèque est vide. */
export async function ensureDefaultTemplates(store) {
  if (!store.message_templates) return [];
  const existing = await store.message_templates.list().catch(() => null);
  if (!existing || existing.length) return existing || [];
  const isSupabase = config.storage.driver === "supabase";
  const now = Date.now();
  for (const [i, t] of DEFAULT_TEMPLATES.entries()) {
    await store.message_templates.insert({
      id: isSupabase ? uuidv4() : uid(),
      ...t,
      sort: i,
      active: true,
      created_at: isSupabase ? new Date(now).toISOString() : now,
      updated_at: isSupabase ? new Date(now).toISOString() : now,
    }).catch(() => {});
  }
  return store.message_templates.list();
}
