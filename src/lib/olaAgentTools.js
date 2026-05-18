import { z } from "zod";
import { createLogger } from "../logger.js";
import { scrapeBooking, scrapeGoogleFlights, IATA_TO_CITY_SLUG } from "./scraper.js";
import {
  reconcileScrapeRoute,
  formatDestinationLabel,
  iataToSearchLabel,
  iataToBookingSlug,
  parseRouteFromText,
} from "./airports.js";
import {
  reconcileScrapeDepart,
  formatLeadDatesLabel,
  parseTravelDatesFromText,
} from "./travelDates.js";
import { getRoutePriceHints, isPricePlausible } from "./routePricing.js";
import { getStore } from "../db/index.js";
import { computeCommissions } from "./commissions.js";
import { uid } from "./ids.js";
import { generateDevisPdf } from "./pdf.js";
import { config } from "../config.js";
import { logAgentAction } from "./agentAudit.js";
import { setConversationLeadId } from "./conversation.js";
import { pickCloserForLead } from "./closerAssign.js";
import { notify } from "./notifBus.js";

const log = createLogger("agent:tools");

const scrapeInputSchema = z.object({
  from: z.string().min(2).max(4),
  to: z.string().min(2).max(4),
  depart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ret: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional().default(""),
  adults: z.coerce.number().int().min(1).max(9).optional().default(1),
  limit: z.coerce.number().int().min(1).max(12).optional().default(6),
  prefer: z.enum(["booking", "google_flights", "kayak", "auto"]).optional().default("auto"),
});

const optionSchema = z.object({
  label: z.string().optional().default(""),
  compagnie: z.string().optional().default(""),
  horaire_dep: z.string().optional().default(""),
  horaire_arr: z.string().optional().default(""),
  duration: z.string().optional().default(""),
  stops: z.coerce.number().int().min(0).max(5).optional(),
  prix_public: z.coerce.number().min(0),
  prix_marche: z.coerce.number().min(0).optional(),
  services_inclus: z.array(z.string()).optional().default([]),
});

const devisFromOfferSchema = z.object({
  lead_id: z.string().min(1).optional(),
  compagnie: z.string().optional().default(""),
  horaire_dep: z.string().optional().default(""),
  horaire_arr: z.string().optional().default(""),
  prix_marche: z.coerce.number().min(0).optional().default(0),
  // Prix public extrait (utilisé comme coût interne "prix_revient" dans cette V1)
  prix_public: z.coerce.number().min(0).optional(),
  // En € (montant). Si absent, calcul auto "commercial".
  marge_souhaitee: z.coerce.number().optional(),
  services_inclus: z.array(z.string()).optional().default([
    "Suivi personnalisé",
    "Optimisation de l'itinéraire",
    "Assistance avant / pendant le voyage",
  ]),
  // Multi-options : 1 à 3 propositions à comparer dans le devis.
  // Si fourni, l'option "best deal" est utilisée pour les champs principaux et
  // toutes les options sont stockées dans devis.options pour le PDF.
  options: z.array(optionSchema).min(1).max(3).optional(),
  // Hôtels proposés (1+ options). Affichés dans le PDF si needs_hotel === true.
  hotels: z.array(z.object({
    name: z.string(),
    stars: z.coerce.number().int().min(1).max(5).optional(),
    area: z.string().optional(),
    nights: z.coerce.number().int().min(1).optional(),
    price_per_night: z.coerce.number().min(0).optional(),
    total_price: z.coerce.number().min(0).optional(),
    notes: z.string().optional(),
  })).optional(),
  // Forfait chauffeur privé. Affiché dans le PDF si needs_driver === true.
  driver: z.object({
    pickup: z.string().optional(),
    dropoff: z.string().optional(),
    vehicle: z.string().optional(),  // Mercedes Classe S, Tesla, BMW Série 7…
    hours: z.coerce.number().min(0).optional(),
    total_price: z.coerce.number().min(0).optional(),
    notes: z.string().optional(),
  }).optional(),
  // Indique au PDF de masquer le comparatif marché (override sur lead.client_type).
  client_type: z.enum(["particulier", "pro", "corporate"]).optional(),
  // WhatsApp/IG désactivés tant que Meta n'est pas branché: on génère le PDF
  // et on renvoie son URL, mais on ne l'envoie pas automatiquement.
  generate_pdf: z.coerce.boolean().optional().default(true),
});

function parseIataFromDestinationText(t) {
  const r = parseRouteFromText(t);
  return { from: r.from, to: r.to };
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
  // Type de client : "particulier" → pas de comparatif marché dans le PDF.
  client_type: z.enum(["particulier", "pro", "corporate"]).optional(),
  // Besoins extras (hôtel optionnel, chauffeur OBLIGATOIRE de demander).
  needs_hotel: z.coerce.boolean().optional(),
  hotel_preference: z.string().optional(),
  needs_driver: z.coerce.boolean().optional(),
  driver_pickup: z.string().optional(),
  driver_dropoff: z.string().optional(),
  extras_notes: z.string().optional(),
}).passthrough();

export const OLA_AGENT_TOOLS = [
  {
    name: "scrape_flights",
    description:
      "Scrape des offres de vols publiques (Booking + Google Flights en fallback) à partir d'une route IATA et dates. Retourne une liste d'offres triées par prix.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "IATA départ, ex: CDG" },
        to: { type: "string", description: "IATA arrivée, ex: DXB" },
        depart: { type: "string", description: "YYYY-MM-DD" },
        ret: { type: "string", description: "YYYY-MM-DD ou vide si aller simple" },
        adults: { type: "integer" },
        limit: { type: "integer" },
        prefer: { type: "string", enum: ["booking", "google_flights", "auto"] },
      },
      required: ["from", "to", "depart"],
    },
  },
  {
    name: "upsert_lead",
    description:
      "Crée ou met à jour un lead CRM (client, route, dates, statut, notes, type de client, besoins hôtel/chauffeur). Utiliser pour garder le CRM synchronisé.",
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
        client_type: {
          type: "string",
          enum: ["particulier", "pro", "corporate"],
          description: "Particulier (vol seul, pas de comparatif marché) / pro (indépendant, freelance) / corporate (entreprise)."
        },
        needs_hotel: { type: "boolean", description: "Le client veut-il un hôtel inclus ?" },
        hotel_preference: { type: "string", description: "Préférence : nom, marque, gamme (4*, 5*), zone." },
        needs_driver: { type: "boolean", description: "Le client veut-il un chauffeur privé ?" },
        driver_pickup: { type: "string", description: "Ex: 'CDG terminal 2E'." },
        driver_dropoff: { type: "string", description: "Ex: 'Hôtel Plaza Athénée'." },
        extras_notes: { type: "string", description: "Notes complémentaires sur extras." },
      },
    },
  },
  {
    name: "create_devis_from_offer",
    description:
      "Crée un devis Ola Flight (1 à 3 options comparables) + extras hôtels/chauffeur si nécessaires. Préférer fournir `options` (max 3 propositions : Express / Confort / Premium). Si lead.needs_hotel === true → fournir `hotels[]`. Si lead.needs_driver === true → fournir `driver`. Si client_type === 'particulier' → pas de comparatif marché dans le PDF. Génère un PDF et renvoie l'URL.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        compagnie: { type: "string", description: "Compagnie de l'option principale (legacy mono-option)" },
        horaire_dep: { type: "string" },
        horaire_arr: { type: "string" },
        prix_marche: { type: "number" },
        prix_public: { type: "number", description: "Prix public scrapé (mono-option). Inutile si `options` est fourni." },
        marge_souhaitee: { type: "number" },
        services_inclus: { type: "array", items: { type: "string" } },
        options: {
          type: "array",
          maxItems: 3,
          description: "Tableau de 1 à 3 propositions comparatives. Préféré pour donner du choix au client.",
          items: {
            type: "object",
            required: ["prix_public"],
            properties: {
              label: { type: "string", description: "Ex: 'Express', 'Confort', 'Premium'" },
              compagnie: { type: "string" },
              horaire_dep: { type: "string" },
              horaire_arr: { type: "string" },
              duration: { type: "string", description: "Ex: '7h45'" },
              stops: { type: "integer", description: "Nombre d'escales" },
              prix_public: { type: "number" },
              prix_marche: { type: "number" },
              services_inclus: { type: "array", items: { type: "string" } },
            },
          },
        },
        client_type: { type: "string", enum: ["particulier", "pro", "corporate"] },
        hotels: {
          type: "array",
          description: "Hôtels proposés (si le client a demandé un hôtel).",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              stars: { type: "integer", description: "1 à 5" },
              area: { type: "string" },
              nights: { type: "integer" },
              price_per_night: { type: "number" },
              total_price: { type: "number" },
              notes: { type: "string" },
            },
          },
        },
        driver: {
          type: "object",
          description: "Forfait chauffeur privé (si le client en veut un).",
          properties: {
            pickup: { type: "string" },
            dropoff: { type: "string" },
            vehicle: { type: "string" },
            hours: { type: "number" },
            total_price: { type: "number" },
            notes: { type: "string" },
          },
        },
        generate_pdf: { type: "boolean" },
      },
    },
  },
];

async function doScrapeFlights(input, { context } = {}) {
  const args = scrapeInputSchema.parse(input);
  let from = args.from.toUpperCase();
  let to = args.to.toUpperCase();

  const confirmed =
    context?.confirmedRoute ||
    (context?.leadDestination ? parseRouteFromText(context.leadDestination) : null);
  const reconciled = reconcileScrapeRoute({ from, to, confirmed });
  if (reconciled.corrected) {
    log.warn(`scrape_flights route fix: ${reconciled.reason}`);
    from = reconciled.from;
    to = reconciled.to;
  }

  let depart = args.depart;
  const travelConfirmed = context?.confirmedTravel || null;
  const departFix = reconcileScrapeDepart({ depart, confirmed: travelConfirmed });
  if (departFix.corrected) {
    log.warn(`scrape_flights date fix: ${departFix.reason}`);
    depart = departFix.depart;
  }

  const oneWay = travelConfirmed?.oneWay ?? !args.ret;
  const cabin = context?.leadClasse || "";
  const adults = args.adults || travelConfirmed?.passagers || 1;

  const fromSlug = IATA_TO_CITY_SLUG[from] || iataToBookingSlug(from) || "";
  const toSlug = IATA_TO_CITY_SLUG[to] || iataToBookingSlug(to) || "";
  const fromSearch = iataToSearchLabel(from);
  const toSearch = iataToSearchLabel(to);

  let offers = [];
  let debug = {};

  const tryBooking = async () => {
    const r = await scrapeBooking({
      from,
      to,
      depart,
      ret: oneWay ? "" : args.ret,
      adults,
      limit: args.limit,
      fromSlug,
      toSlug,
    });
    debug = r.debug || {};
    offers = r.offers || [];
  };

  const tryGoogleFlights = async () => {
    offers = await scrapeGoogleFlights({
      from,
      to,
      fromLabel: fromSearch,
      toLabel: toSearch,
      depart,
      ret: oneWay ? "" : args.ret,
      adults,
      limit: args.limit,
    });
  };

  if (args.prefer === "booking") {
    await tryBooking();
  } else if (args.prefer === "google_flights" || args.prefer === "kayak") {
    await tryGoogleFlights();
  } else {
    try {
      await tryBooking();
    } catch (e) {
      log.warn(`booking scrape failed: ${e?.message || e}`);
      offers = [];
    }
    if (!offers.length) {
      await tryGoogleFlights();
    }
  }

  const normalized = (offers || [])
    .filter((o) => typeof o?.price === "number" && o.price > 0)
    .filter((o) => isPricePlausible({
      price: o.price,
      from,
      to,
      oneWay,
      cabin,
    }))
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

  const priceHints = getRoutePriceHints({ from, to, oneWay, cabin });
  const scrapeOk = normalized.length > 0;

  if (!scrapeOk) {
    log.warn(
      `scrape_flights: 0 offre plausible ${from}→${to} ${depart} (oneWay=${oneWay}) — utiliser price_hints`
    );
  }

  return {
    offers: normalized,
    scrape_ok: scrapeOk,
    offers_count: normalized.length,
    travel: {
      depart,
      ret: oneWay ? "" : args.ret || "",
      one_way: oneWay,
      adults,
    },
    price_hints: priceHints,
    instruction: scrapeOk
      ? "Utilise les prix des offres scrape_flights pour create_devis_from_offer (prix_public = price des offres)."
      : `Scraping indisponible ou sans résultat. Utilise price_hints pour create_devis_from_offer : Express ${priceHints.express[0]}-${priceHints.express[1]} €, Confort ${priceHints.confort[0]}-${priceHints.confort[1]} €, Premium ${priceHints.premium[0]}-${priceHints.premium[1]} € (aller ${oneWay ? "simple" : "retour"}, 1 pax). ${priceHints.note}`,
    debug: {
      ...debug,
      route_used: { from, to, from_search: fromSearch, to_search: toSearch },
      route_corrected: reconciled.corrected,
      depart_corrected: departFix.corrected,
      depart_used: depart,
    },
  };
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

  const existing = safeId ? await store.leads.findById(safeId) : null;
  // Auto-dispatch : si on n'a pas de closer (ni dans args, ni sur le lead existant),
  // on assigne automatiquement le closer le moins chargé.
  let resolvedCloser = args.closer_name ?? existing?.closer_name ?? null;
  if (!resolvedCloser) {
    try {
      resolvedCloser = await pickCloserForLead();
    } catch (e) {
      log.warn(`auto-dispatch failed: ${e?.message || e}`);
    }
  }

  const payload = {
    // Sur Supabase, leads.id est un uuid: si on ne fournit pas d'id, la DB le génère.
    // Si on fournit un id non-uuid, on l'ignore pour éviter des erreurs.
    ...(safeId ? { id: safeId } : {}),
    client_name: args.client_name || "Client",
    client_contact: args.client_contact || "",
    canal: normalizedCanal,
    destination: (() => {
      const raw = args.destination || "";
      if (!raw && context?.confirmedRoute) {
        return formatDestinationLabel(context.confirmedRoute);
      }
      const parsed = parseRouteFromText(raw);
      if (parsed.from || parsed.to) {
        return formatDestinationLabel({
          from: parsed.from,
          to: parsed.to,
          label: parsed.label || raw,
        });
      }
      return raw;
    })(),
    dates: (() => {
      const raw = args.dates || "";
      if (context?.confirmedTravel?.depart) {
        return formatLeadDatesLabel(context.confirmedTravel);
      }
      const parsed = parseTravelDatesFromText(raw);
      if (parsed.depart) return formatLeadDatesLabel({ ...parsed, oneWay: context?.confirmedTravel?.oneWay });
      return raw;
    })(),
    classe: args.classe || "",
    passagers: Number(args.passagers || 1) || 1,
    status: normalizedStatus,
    apporteur_name: args.apporteur_name ?? null,
    closer_name: resolvedCloser,
    notes: args.notes || "",
    urgent: Boolean(args.urgent),
    // Extras (peuvent être absents si la migration 008 n'a pas tourné — l'insertion
    // les ignore alors silencieusement côté Supabase via fallback ci-dessous).
    ...(args.client_type ? { client_type: args.client_type } : {}),
    ...(args.needs_hotel != null ? { needs_hotel: Boolean(args.needs_hotel) } : {}),
    ...(args.hotel_preference ? { hotel_preference: args.hotel_preference } : {}),
    ...(args.needs_driver != null ? { needs_driver: Boolean(args.needs_driver) } : {}),
    ...(args.driver_pickup ? { driver_pickup: args.driver_pickup } : {}),
    ...(args.driver_dropoff ? { driver_dropoff: args.driver_dropoff } : {}),
    ...(args.extras_notes ? { extras_notes: args.extras_notes } : {}),
  };

  const EXTRAS_KEYS = [
    "client_type", "needs_hotel", "hotel_preference",
    "needs_driver", "driver_pickup", "driver_dropoff", "extras_notes",
  ];
  async function saveTolerant() {
    try {
      return existing
        ? await store.leads.update(existing.id, payload)
        : await store.leads.insert(payload);
    } catch (e) {
      const msg = e?.message || String(e);
      // Si la migration 008 n'a pas tourné, Supabase rejette les colonnes extras.
      if (/(client_type|needs_hotel|needs_driver|hotel_preference|driver_pickup|driver_dropoff|extras_notes)/i.test(msg)
          && /column|cache|schema/i.test(msg)) {
        log.warn(`leads extras unsupported (run db/migrations/008_extras_hotel_driver.sql) → fallback`);
        const reduced = { ...payload };
        for (const k of EXTRAS_KEYS) delete reduced[k];
        return existing
          ? await store.leads.update(existing.id, reduced)
          : await store.leads.insert(reduced);
      }
      throw e;
    }
  }
  const saved = await saveTolerant();

  // Notif "lead_assigned" si on vient de désigner un closer (création OU passage de null à valeur).
  const beforeCloser = existing?.closer_name || null;
  if (saved?.closer_name && saved.closer_name !== beforeCloser) {
    notify({
      recipients: [{ email: saved.closer_name }],
      type: "lead_assigned",
      title: `Nouveau lead assigné par l'agent · ${saved.client_name || "Client"}`,
      body: `${saved.destination || "—"} · ${saved.dates || "dates à confirmer"}`,
      lead_id: saved.id,
    }).catch(() => {});
  }
  // Transitions de statut critiques (clic du client sur "Accepter"/"Discuter" via prompt).
  if (existing && existing.status !== saved?.status) {
    const targets = [{ role: "admin" }];
    if (saved?.closer_name) targets.push({ email: saved.closer_name });
    if (saved?.status === "won") {
      notify({
        recipients: targets,
        type: "lead_won",
        title: `🏆 Deal gagné · ${saved.client_name || "Client"}`,
        body: `${saved.destination || "—"}`,
        lead_id: saved.id,
      }).catch(() => {});
    } else if (saved?.status === "nego") {
      notify({
        recipients: targets,
        type: "lead_nego",
        title: `Négociation en cours · ${saved.client_name || "Client"}`,
        body: `${saved.destination || "—"} — le client veut discuter.`,
        lead_id: saved.id,
      }).catch(() => {});
    }
  }

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

  const cabin = String(lead?.classe || "").toLowerCase();
  const isFirst = /first|premi(è|e)re/.test(cabin);
  const isBiz = /business|biz/.test(cabin);
  const premiumFactor = isFirst ? 6.5 : isBiz ? 4.2 : 2.2;
  const { to: toIata } = parseIataFromDestinationText(lead?.destination || "");

  // Helper pour pricer une option (utilisé en mono comme en multi).
  const priceOption = (opt) => {
    const prix_revient_o = Math.max(0, Number(opt.prix_public) || 0);
    const marginAuto = suggestMarginEur({
      toIata,
      classe: lead?.classe || "",
      pricePublic: prix_revient_o,
      notes: lead?.notes || "",
    });
    const margin_o = normalizeMarginInput(args.marge_souhaitee, prix_revient_o) ?? marginAuto;
    const prix_vente_o = Math.max(0, prix_revient_o + margin_o);
    const explicitMarket =
      typeof opt.prix_marche === "number" && opt.prix_marche > 0 ? opt.prix_marche : 0;
    const estimatedMarket = Math.round(prix_revient_o * premiumFactor);
    const prix_marche_o = explicitMarket > 0 ? explicitMarket : Math.max(estimatedMarket, prix_vente_o);
    return {
      label: opt.label || "",
      compagnie: opt.compagnie || "",
      horaire_dep: opt.horaire_dep || "",
      horaire_arr: opt.horaire_arr || "",
      duration: opt.duration || "",
      stops: typeof opt.stops === "number" ? opt.stops : null,
      services_inclus: Array.isArray(opt.services_inclus) && opt.services_inclus.length
        ? opt.services_inclus
        : (args.services_inclus || []),
      prix_revient: prix_revient_o,
      prix_vente: prix_vente_o,
      prix_marche: prix_marche_o,
      marge: prix_vente_o - prix_revient_o,
    };
  };

  // Construit la liste d'options : si l'agent fournit `options`, on les utilise.
  // Sinon on crée une option unique à partir des champs flat (legacy).
  const rawOpts = (args.options && args.options.length)
    ? args.options
    : (typeof args.prix_public === "number" && args.prix_public > 0)
      ? [{
          label: "",
          compagnie: args.compagnie || "",
          horaire_dep: args.horaire_dep || "",
          horaire_arr: args.horaire_arr || "",
          prix_public: args.prix_public,
          prix_marche: args.prix_marche || 0,
          services_inclus: args.services_inclus || [],
        }]
      : [];
  if (rawOpts.length === 0) {
    throw new Error("create_devis_from_offer: il faut fournir `options[]` ou `prix_public`.");
  }
  // Auto-label si l'agent oublie : Express / Confort / Premium par prix croissant.
  const priced = rawOpts.map(priceOption).sort((a, b) => a.prix_vente - b.prix_vente);
  const defaultLabels = ["Express", "Confort", "Premium"];
  priced.forEach((o, i) => {
    if (!o.label) o.label = defaultLabels[Math.min(i, defaultLabels.length - 1)];
  });

  // L'option principale = la moins chère par défaut (sera mise en avant au PDF).
  const main = priced[0];

  const { marge, closer_commission, apporteur_commission } = computeCommissions({
    prix_vente: main.prix_vente,
    prix_revient: main.prix_revient,
    apporteur_name: lead?.apporteur_name || null,
  });

  const isSupabase = config.storage.driver === "supabase";
  // Si client_type est passé en argument du tool, on l'utilise comme override.
  // Sinon on prend celui du lead (l'agent met-à-jour le lead avant le devis).
  const effectiveClientType = args.client_type || lead?.client_type || null;
  const devis = {
    id: `OLA-${uid().slice(0, 6)}`,
    lead_id: leadId || "",
    compagnie: main.compagnie || "",
    horaire_dep: main.horaire_dep || "",
    horaire_arr: main.horaire_arr || "",
    prix_revient: main.prix_revient,
    prix_vente: main.prix_vente,
    // Pour les particuliers : pas de comparatif marché dans le PDF.
    // On stocke la valeur calculée pour le back-office, mais on flag à 0
    // au niveau du PDF via les options/lead.client_type (logique pdfTemplate).
    prix_marche: effectiveClientType === "particulier" ? 0 : main.prix_marche,
    // Supabase: marge/commissions sont des generated columns (001_init.sql)
    ...(isSupabase
      ? {}
      : { marge, closer_commission, apporteur_commission }),
    apporteur_name: lead?.apporteur_name || null,
    services_inclus: main.services_inclus,
    options: priced.map((o) => ({
      ...o,
      prix_marche: effectiveClientType === "particulier" ? 0 : o.prix_marche,
    })),
    ...(args.hotels && args.hotels.length ? { hotels: args.hotels } : {}),
    ...(args.driver && Object.keys(args.driver).length ? { driver: args.driver } : {}),
    pdf_url: null,
    valide_jusqu_au: isSupabase
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : Date.now() + 24 * 60 * 60 * 1000,
    paiement_recu: false,
  };

  // Insertion tolérante : si une colonne récente (options, hotels, driver) n'existe
  // pas encore en Supabase, on retire le champ et on retente.
  async function insertDevisTolerant(row) {
    try {
      return await store.devis.insert(row);
    } catch (e) {
      const msg = e?.message || String(e);
      const matches = ["options", "hotels", "driver"].filter((c) => {
        const re = new RegExp(`'${c}'|"${c}"|\\b${c}\\b`, "i");
        return re.test(msg) && /column|cache|schema|does not exist/i.test(msg);
      });
      if (matches.length === 0) throw e;
      log.warn(`devis ${matches.join(",")} unsupported (run db/migrations/007 + 008) → fallback`);
      const reduced = { ...row };
      for (const c of matches) delete reduced[c];
      return insertDevisTolerant(reduced);
    }
  }
  const inserted = await insertDevisTolerant(devis);
  // L'objet inserted ne contient pas forcément les champs JSON si la migration
  // est absente — on les réajoute en mémoire pour la génération PDF en aval.
  if (!inserted.options && devis.options) inserted.options = devis.options;
  if (!inserted.hotels && devis.hotels) inserted.hotels = devis.hotels;
  if (!inserted.driver && devis.driver) inserted.driver = devis.driver;

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
        margin: inserted.marge ?? (main.prix_vente - main.prix_revient),
      });
    } catch (e) {
      log.warn(`lead update after devis failed: ${e?.message || e}`);
    }
  }

  // Notification cloche : nouveau devis envoyé (admins + closer assigné).
  try {
    const recipients = [{ role: "admin" }];
    const refreshed = inserted.lead_id ? await store.leads.findById(inserted.lead_id) : null;
    if (refreshed?.closer_name) recipients.push({ email: refreshed.closer_name });
    notify({
      recipients,
      type: "devis_created",
      title: `Nouveau devis · ${refreshed?.client_name || "Client"}`,
      body: `${refreshed?.destination || lead?.destination || "—"} — ${main.prix_vente} € (${priced.length} option${priced.length > 1 ? "s" : ""})`,
      lead_id: inserted.lead_id || null,
      devis_id: inserted.id,
    }).catch(() => {});
  } catch (e) {
    log.warn(`notif devis failed: ${e?.message || e}`);
  }

  return {
    devis_id: inserted.id,
    lead_id: inserted.lead_id || null,
    prix_vente: main.prix_vente,
    marge_souhaitee: main.prix_vente - main.prix_revient,
    options_count: priced.length,
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
    confirmedRoute: context.confirmedRoute || null,
    confirmedTravel: context.confirmedTravel || null,
    leadDestination: context.leadDestination || "",
    leadClasse: context.leadClasse || "",
  };
  const startedAt = Date.now();
  try {
    let out;
    switch (name) {
      case "scrape_flights":
        out = await doScrapeFlights(input, { context: baseCtx });
        break;
      case "upsert_lead":
        out = await doUpsertLead(input, { context: baseCtx });
        if (out?.lead_id) baseCtx.lead_id = out.lead_id;
        break;
      case "create_devis_from_offer":
        out = await doCreateDevisFromOffer(input, { context: baseCtx });
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

