import { z } from "zod";
import { createLogger } from "../logger.js";
import { scrapeBooking, scrapeKayak, IATA_TO_CITY_SLUG } from "./scraper.js";
import { getStore } from "../db/index.js";
import { computeCommissions } from "./commissions.js";
import { uid } from "./ids.js";
import { generateDevisPdf } from "./pdf.js";
import { config } from "../config.js";
import { logAgentAction } from "./agentAudit.js";
import { setConversationLeadId } from "./conversation.js";

const log = createLogger("agent:tools");

const scrapeInputSchema = z.object({
  from: z.string().min(2).max(4),
  to: z.string().min(2).max(4),
  depart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ret: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional().default(""),
  adults: z.coerce.number().int().min(1).max(9).optional().default(1),
  limit: z.coerce.number().int().min(1).max(12).optional().default(6),
  prefer: z.enum(["booking", "kayak", "auto"]).optional().default("auto"),
});

const devisFromOfferSchema = z.object({
  lead_id: z.string().min(1).optional(),
  compagnie: z.string().optional().default(""),
  horaire_dep: z.string().optional().default(""),
  horaire_arr: z.string().optional().default(""),
  prix_marche: z.coerce.number().min(0).optional().default(0),
  // Prix public extrait (utilisé comme coût interne "prix_revient" dans cette V1)
  prix_public: z.coerce.number().min(0),
  // En € (montant). Si absent, calcul auto "commercial".
  marge_souhaitee: z.coerce.number().optional(),
  services_inclus: z.array(z.string()).optional().default([
    "Suivi personnalisé",
    "Optimisation de l'itinéraire",
    "Assistance avant / pendant le voyage",
  ]),
  // WhatsApp/IG désactivés tant que Meta n'est pas branché: on génère le PDF
  // et on renvoie son URL, mais on ne l'envoie pas automatiquement.
  generate_pdf: z.coerce.boolean().optional().default(true),
});

function parseIataFromDestinationText(t) {
  const s = String(t || "").toUpperCase();
  const m = s.match(/\b([A-Z]{3})\b/g);
  if (!m) return { from: null, to: null };
  const uniq = [...new Set(m)].slice(0, 2);
  return { from: uniq[0] || null, to: uniq[1] || null };
}

function normalizeMarginInput(v, basePrice) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 0.25 => 25% du prix public
  if (n > 0 && n < 1) return Math.round(basePrice * n);
  // 25 => 25% (si le modèle a pensé en %)
  if (n >= 1 && n <= 40) return Math.round(basePrice * (n / 100));
  return Math.round(n);
}

function suggestMarginEur({ toIata, classe, pricePublic, notes }) {
  const cabin = String(classe || "").toLowerCase();
  const isFirst = /first|premi(è|e)re/.test(cabin);
  const isBiz = /business|biz/.test(cabin);
  const hot = /chaud|urgent|asap|réserver|book|go/i.test(String(notes || ""));

  const longhaulHints = ["JFK", "EWR", "LAX", "SFO", "DXB", "DOH", "HND", "NRT", "SIN", "BKK", "MIA", "YYZ"];
  const shorthaulHints = ["MAD", "BCN", "LIS", "FCO", "MXP", "BRU", "AMS", "FRA", "MUC", "GVA", "ZRH", "LHR"];
  const t = String(toIata || "").toUpperCase();
  const isLonghaul = longhaulHints.includes(t);
  const isShorthaul = shorthaulHints.includes(t);

  let base;
  if (isLonghaul) base = 450;
  else if (isShorthaul) base = 180;
  else base = 280;

  if (isBiz) base += 120;
  if (isFirst) base += 220;

  if (pricePublic >= 800) base += 120;
  if (pricePublic >= 2000) base += 220;

  if (hot) base += 80;

  const min = isLonghaul ? 350 : 150;
  const max = Math.max(min + 50, Math.round(pricePublic * 0.45));
  return Math.min(Math.max(base, min), max);
}

const leadUpsertSchema = z.object({
  id: z.string().optional(),
  client_name: z.string().optional(),
  client_contact: z.string().optional(),
  // Le modèle peut proposer "web" : on normalise côté app.
  canal: z.string().optional(),
  destination: z.string().optional(),
  dates: z.string().optional(),
  classe: z.string().optional(),
  passagers: z.coerce.number().int().min(1).optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  apporteur_name: z.string().nullable().optional(),
  closer_name: z.string().nullable().optional(),
  urgent: z.coerce.boolean().optional(),
}).passthrough();

export const OLA_AGENT_TOOLS = [
  {
    name: "scrape_flights",
    description:
      "Scrape des offres de vols publiques (Booking/Kayak) à partir d'une route IATA et dates. Retourne une liste d'offres triées par prix.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "IATA départ, ex: CDG" },
        to: { type: "string", description: "IATA arrivée, ex: DXB" },
        depart: { type: "string", description: "YYYY-MM-DD" },
        ret: { type: "string", description: "YYYY-MM-DD ou vide si aller simple" },
        adults: { type: "integer" },
        limit: { type: "integer" },
        prefer: { type: "string", enum: ["booking", "kayak", "auto"] },
      },
      required: ["from", "to", "depart"],
    },
  },
  {
    name: "upsert_lead",
    description:
      "Crée ou met à jour un lead CRM (client, route, dates, statut, notes). Utiliser pour garder le CRM synchronisé.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        client_name: { type: "string" },
        client_contact: { type: "string" },
        canal: { type: "string", enum: ["whatsapp", "instagram"] },
        destination: { type: "string" },
        dates: { type: "string" },
        classe: { type: "string" },
        passagers: { type: "integer" },
        status: { type: "string" },
        notes: { type: "string" },
        apporteur_name: { type: "string" },
        closer_name: { type: "string" },
        urgent: { type: "boolean" },
      },
    },
  },
  {
    name: "create_devis_from_offer",
    description:
      "Crée un devis interne Ola Flight à partir d'un prix public (scrapé). Génère un PDF et renvoie l'URL pour suivi CRM (sans envoi WhatsApp/IG).",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        compagnie: { type: "string" },
        horaire_dep: { type: "string" },
        horaire_arr: { type: "string" },
        prix_marche: { type: "number" },
        prix_public: { type: "number" },
        marge_souhaitee: { type: "number" },
        services_inclus: { type: "array", items: { type: "string" } },
        generate_pdf: { type: "boolean" },
      },
      required: ["prix_public"],
    },
  },
];

async function doScrapeFlights(input) {
  const args = scrapeInputSchema.parse(input);
  const from = args.from.toUpperCase();
  const to = args.to.toUpperCase();
  const fromSlug = IATA_TO_CITY_SLUG[from] || "";
  const toSlug = IATA_TO_CITY_SLUG[to] || "";

  let offers = [];
  let debug = {};

  const tryBooking = async () => {
    const r = await scrapeBooking({
      from,
      to,
      depart: args.depart,
      ret: args.ret,
      adults: args.adults,
      limit: args.limit,
      fromSlug,
      toSlug,
    });
    debug = r.debug || {};
    offers = r.offers || [];
  };

  const tryKayak = async () => {
    offers = await scrapeKayak({
      from,
      to,
      depart: args.depart,
      ret: args.ret,
      adults: args.adults,
      limit: args.limit,
    });
  };

  if (args.prefer === "booking") {
    await tryBooking();
  } else if (args.prefer === "kayak") {
    await tryKayak();
  } else {
    try {
      await tryBooking();
    } catch (e) {
      log.warn(`booking scrape failed: ${e?.message || e}`);
      offers = [];
    }
    if (!offers.length) {
      await tryKayak();
    }
  }

  const normalized = (offers || [])
    .filter((o) => typeof o?.price === "number" && o.price > 0)
    .slice(0, args.limit)
    .map((o) => ({
      external_id: o.external_id,
      from: o.from,
      to: o.to,
      depart: o.depart,
      ret: o.ret || "",
      price: o.price,
      currency: o.currency || "EUR",
      url: o.url,
      company: o.company || o.compagnie || "",
      depart_time: o.depart_time || "",
      arrive_time: o.arrive_time || "",
      meta: o.meta || {},
    }));

  normalized.sort((a, b) => a.price - b.price);

  // Best effort: persister un cache flights pour suivi admin/CRM.
  try {
    const store = await getStore();
    if (store.flights?.insert) {
      for (const o of normalized.slice(0, Math.min(12, normalized.length))) {
        await store.flights.insert({
          id: `flt-${uid().slice(0, 10)}`,
          external_id: o.external_id,
          title: `${o.from}→${o.to} ${o.depart}${o.ret ? `/${o.ret}` : ""}`,
          url: o.url,
          price: o.price,
          currency: o.currency,
          source: "agent",
          status: "scraped",
          route: { from: o.from, to: o.to, depart: o.depart, ret: o.ret, adults: args.adults },
          meta: { company: o.company, depart_time: o.depart_time, arrive_time: o.arrive_time },
        });
      }
    }
  } catch (e) {
    log.warn(`persist flights failed: ${e?.message || e}`);
  }

  return { offers: normalized, debug };
}

async function doUpsertLead(input, { context }) {
  const args = leadUpsertSchema.parse(input);
  const store = await getStore();

  const isUuid = (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ""));
  const safeId = args.id && isUuid(args.id) ? args.id : null;

  const allowedStatus = new Set([
    "qualification",
    "devis_pending",
    "devis_sent",
    "interested",
    "call_booked",
    "won",
    "lost",
    "archived",
    "new",
    "contacted",
    "offer",
    "nego",
  ]);
  const normalizedStatus = allowedStatus.has(String(args.status || "").trim())
    ? String(args.status).trim()
    : "qualification";
  const normalizedCanal =
    String(args.canal || "").toLowerCase().includes("insta") ? "instagram" : "whatsapp";

  const payload = {
    // Sur Supabase, leads.id est un uuid: si on ne fournit pas d'id, la DB le génère.
    // Si on fournit un id non-uuid, on l'ignore pour éviter des erreurs.
    ...(safeId ? { id: safeId } : {}),
    client_name: args.client_name || "Client",
    client_contact: args.client_contact || "",
    canal: normalizedCanal,
    destination: args.destination || "",
    dates: args.dates || "",
    classe: args.classe || "",
    passagers: Number(args.passagers || 1) || 1,
    status: normalizedStatus,
    apporteur_name: args.apporteur_name ?? null,
    closer_name: args.closer_name ?? null,
    notes: args.notes || "",
    urgent: Boolean(args.urgent),
  };

  const existing = safeId ? await store.leads.findById(safeId) : null;
  const saved = existing ? await store.leads.update(existing.id, payload) : await store.leads.insert(payload);

  // On rattache au contexte de conversation si présent.
  if (saved?.id && context?.channel && context?.contact) {
    try {
      // conversation.js peut rattacher plus tard; ici on laisse le caller le faire.
    } catch {
      /* no-op */
    }
  }
  return { lead_id: saved?.id || null, status: saved?.status || null };
}

async function doCreateDevisFromOffer(input, { context }) {
  const args = devisFromOfferSchema.parse(input);
  const store = await getStore();

  const isUuid = (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ""));
  const safeLeadId =
    (args.lead_id && isUuid(args.lead_id) ? args.lead_id : null) ||
    (context?.lead_id && isUuid(context.lead_id) ? context.lead_id : null);
  const lead = safeLeadId ? await store.leads.findById(safeLeadId) : null;
  const leadId = safeLeadId || lead?.id || null;

  const prix_revient = args.prix_public;
  const marginHint = normalizeMarginInput(args.marge_souhaitee, prix_revient);
  const { to: toIata } = parseIataFromDestinationText(lead?.destination || "");
  const marginAuto = suggestMarginEur({
    toIata,
    classe: lead?.classe || "",
    pricePublic: prix_revient,
    notes: lead?.notes || "",
  });
  const marge_souhaitee = marginHint ?? marginAuto;
  const prix_vente = Math.max(0, prix_revient + marge_souhaitee);
  // Prix marché doit être COMPARABLE au tarif Ola Flight (même niveau de service).
  // Si on n'a que le prix public scrapé (souvent éco), on estime un prix marché
  // premium (business/first) pour ne pas afficher un comparatif défavorable.
  const explicitMarket = typeof args.prix_marche === "number" && args.prix_marche > 0 ? args.prix_marche : 0;
  const cabin = String(lead?.classe || "").toLowerCase();
  const isFirst = /first|premi(è|e)re/.test(cabin);
  const isBiz = /business|biz/.test(cabin);
  const premiumFactor = isFirst ? 6.5 : isBiz ? 4.2 : 2.2;
  const estimatedMarket = Math.round(prix_revient * premiumFactor);
  const prix_marche = explicitMarket > 0 ? explicitMarket : Math.max(estimatedMarket, prix_vente);

  const { marge, closer_commission, apporteur_commission } = computeCommissions({
    prix_vente,
    prix_revient,
    apporteur_name: lead?.apporteur_name || null,
  });

  const isSupabase = config.storage.driver === "supabase";
  const devis = {
    id: `OLA-${uid().slice(0, 6)}`,
    lead_id: leadId || "",
    compagnie: args.compagnie || "",
    horaire_dep: args.horaire_dep || "",
    horaire_arr: args.horaire_arr || "",
    prix_revient,
    prix_vente,
    prix_marche,
    // Supabase: marge/commissions sont des generated columns (001_init.sql)
    ...(isSupabase
      ? {}
      : { marge, closer_commission, apporteur_commission }),
    apporteur_name: lead?.apporteur_name || null,
    services_inclus: args.services_inclus || [],
    pdf_url: null,
    // SQLite: INTEGER ms. Supabase: timestamptz (selon migration).
    // On envoie un format compatible selon le driver.
    valide_jusqu_au: isSupabase
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : Date.now() + 24 * 60 * 60 * 1000,
    paiement_recu: false,
  };

  const inserted = await store.devis.insert(devis);

  // PDF (sans envoi WhatsApp/IG pour l'instant)
  let pdf = null;
  if (args.generate_pdf) {
    const leadForPdf = inserted.lead_id ? await store.leads.findById(inserted.lead_id) : null;
    const { publicUrl, filename } = await generateDevisPdf({ devis: inserted, lead: leadForPdf });
    await store.devis.update(inserted.id, { pdf_url: publicUrl });
    pdf = { pdf_url: publicUrl, filename };
  }

  // Met à jour le lead pour suivi CRM (comme la route /api/devis).
  if (inserted.lead_id) {
    try {
      await store.leads.update(inserted.lead_id, {
        status: "devis_sent",
        value: inserted.prix_vente,
        margin: inserted.marge ?? (prix_vente - prix_revient),
      });
    } catch (e) {
      log.warn(`lead update after devis failed: ${e?.message || e}`);
    }
  }

  return {
    devis_id: inserted.id,
    lead_id: inserted.lead_id || null,
    prix_vente,
    marge_souhaitee,
    pdf,
    public_pdf_url: pdf?.pdf_url ? `${config.publicUrl}${pdf.pdf_url}` : null,
  };
}

export async function runOlaTool({ name, input }, { context = {} } = {}) {
  const baseCtx = {
    channel: context.channel || "web",
    conversation_id: context.conversation_id || null,
    lead_id: context.lead_id || null,
    contact: context.contact || null,
    lang: context.lang || "fr",
    name: context.name || "",
  };
  const startedAt = Date.now();
  try {
    let out;
    switch (name) {
      case "scrape_flights":
        out = await doScrapeFlights(input);
        break;
      case "upsert_lead":
        out = await doUpsertLead(input, { context });
        if (out?.lead_id) baseCtx.lead_id = out.lead_id;
        break;
      case "create_devis_from_offer":
        out = await doCreateDevisFromOffer(input, { context });
        if (out?.lead_id) baseCtx.lead_id = out.lead_id;
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Associe la conversation web au lead pour le tracking + décisions UI.
    if (out?.lead_id && baseCtx.channel && baseCtx.contact) {
      setConversationLeadId({ channel: baseCtx.channel, contact: baseCtx.contact, lead_id: out.lead_id }).catch(() => {});
    }

    await logAgentAction({
      channel: baseCtx.channel,
      conversation_id: baseCtx.conversation_id,
      lead_id: baseCtx.lead_id,
      action: name,
      status: "ok",
      input,
      output: { ...out, _ms: Date.now() - startedAt },
      context: baseCtx,
    });
    return out;
  } catch (e) {
    await logAgentAction({
      channel: baseCtx.channel,
      conversation_id: baseCtx.conversation_id,
      lead_id: baseCtx.lead_id,
      action: name,
      status: "error",
      input,
      output: null,
      error: e?.message || String(e),
      context: baseCtx,
    });
    throw e;
  }
}

