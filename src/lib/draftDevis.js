/**
 * Brouillon de devis (2 options compagnies) — tarifs saisis ensuite par un admin.
 */

import { getStore } from "../db/index.js";
import { uid, uuidv4 } from "./ids.js";
import { config } from "../config.js";
import { notify } from "./notifBus.js";

export function emptyAirlineOption(index) {
  return {
    label: index === 0 ? "Option 1" : "Option 2",
    compagnie: "",
    prix_vente_business: 0,
    prix_vente_first: 0,
    prix_vente: 0,
    prix_revient: 0,
    prix_marche: 0,
    horaire_dep: "",
    horaire_arr: "",
    services_inclus: [],
  };
}

export function pickDisplayPriceFromOption(opt, lead) {
  const cabin = String(lead?.classe || "").toLowerCase();
  const first = Number(opt.prix_vente_first) || 0;
  const biz = Number(opt.prix_vente_business) || 0;
  if (/first|premi(è|e)re/.test(cabin) && first > 0) return first;
  if (biz > 0) return biz;
  return Number(opt.prix_vente) || first || biz || 0;
}

export function normalizeAdminOptions(rawOptions, lead) {
  const opts = (rawOptions || []).slice(0, 2).map((o, i) => {
    const biz = Math.max(0, Number(o.prix_vente_business) || 0);
    const first = Math.max(0, Number(o.prix_vente_first) || 0);
    const prix_vente = pickDisplayPriceFromOption(
      { prix_vente_business: biz, prix_vente_first: first, prix_vente: o.prix_vente },
      lead
    );
    return {
      label: o.label || (i === 0 ? "Option 1" : "Option 2"),
      compagnie: String(o.compagnie || "").trim(),
      prix_vente_business: biz,
      prix_vente_first: first,
      prix_vente,
      prix_revient: Math.max(0, Number(o.prix_revient) || 0),
      prix_marche: Math.max(0, Number(o.prix_marche) || 0),
      horaire_dep: o.horaire_dep || "",
      horaire_arr: o.horaire_arr || "",
      duration: o.duration || "",
      stops: typeof o.stops === "number" ? o.stops : undefined,
      services_inclus: Array.isArray(o.services_inclus) ? o.services_inclus : [],
    };
  });
  while (opts.length < 2) opts.push(emptyAirlineOption(opts.length));
  return opts;
}

export function adminPricingComplete(options, lead) {
  const opts = normalizeAdminOptions(options, lead);
  if (!opts.every((o) => o.compagnie && o.prix_vente > 0)) return false;
  if (lead?.needs_hotel && !(Array.isArray(lead.hotels) || []).length) {
    /* hotels filled on devis not lead */
  }
  return true;
}

/**
 * @param {object} lead
 * @param {object} [ctx]
 */
export async function createDraftDevisForLead(lead, ctx = {}) {
  const store = await getStore();
  const isSupabase = config.storage.driver === "supabase";
  const now = Date.now();
  const options = [emptyAirlineOption(0), emptyAirlineOption(1)];

  const devis = {
    id: isSupabase ? uuidv4() : `OLA-${uid().slice(0, 6)}`,
    lead_id: lead?.id || "",
    compagnie: "",
    horaire_dep: "",
    horaire_arr: "",
    prix_revient: 0,
    prix_vente: 0,
    prix_marche: 0,
    ...(isSupabase ? {} : { marge: 0, closer_commission: 0, apporteur_commission: 0 }),
    apporteur_name: lead?.apporteur_name || null,
    services_inclus: ["Suivi personnalisé Ola Flight", "Assistance avant et pendant le voyage"],
    options,
    pricing_status: "pending_admin",
    pdf_url: null,
    valide_jusqu_au: isSupabase
      ? new Date(now + 24 * 60 * 60 * 1000).toISOString()
      : now + 24 * 60 * 60 * 1000,
    paiement_recu: false,
    email_sent_at: null,
    client_decision: null,
    created_at: now,
    updated_at: now,
  };

  if (lead?.needs_hotel) devis.hotels = [];
  if (lead?.needs_driver) {
    devis.driver = {
      vehicle: "Berline / van premium",
      pickup: lead.driver_pickup || "À préciser",
      dropoff: lead.driver_dropoff || "À préciser",
      total_price: 0,
      notes: "Tarif à confirmer",
    };
  }

  async function insertTolerant(row) {
    try {
      return await store.devis.insert(row);
    } catch (e) {
      const msg = e?.message || String(e);
      const optional = ["options", "hotels", "driver", "pricing_status", "email_sent_at", "client_decision"];
      const missing = optional.filter((c) => /column|schema|does not exist/i.test(msg) && new RegExp(c, "i").test(msg));
      if (!missing.length) throw e;
      const reduced = { ...row };
      for (const c of missing) delete reduced[c];
      return insertTolerant(reduced);
    }
  }

  const inserted = await insertTolerant(devis);

  await store.leads.update(lead.id, { status: "devis_pending" });

  const recipients = [{ role: "admin" }];
  await notify({
    recipients,
    type: "devis_prices_needed",
    title: `Tarifs à saisir — ${lead.client_name || "Client"}`,
    body: `${lead.destination || "Route"} · ${lead.dates || ""}`.trim(),
    lead_id: lead.id,
    devis_id: inserted.id,
    meta: {
      needs_hotel: !!lead.needs_hotel,
      needs_driver: !!lead.needs_driver,
      channel: ctx.channel || "web",
    },
  });

  return inserted;
}
