import { z } from "zod";

// ─── /api/chat ───────────────────────────────────────────
export const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]).default("user"),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(50),
  lang: z.enum(["fr", "en"]).optional().default("fr"),
  // Pour persister la conversation web côté serveur (audit + CRM).
  conversation_id: z.string().min(6).max(80).optional(),
  // Optionnel: rattacher directement à un lead existant.
  lead_id: z.string().min(1).optional(),
});

// ─── /api/leads ──────────────────────────────────────────
export const LEAD_STATUSES = z.enum([
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

export const CANAL = z.enum(["whatsapp", "instagram"]);

// Création lead — toléra des alias (name/contact/dest...) pour rester compat avec le CRM HTML.
export const leadCreateSchema = z.object({
  id: z.string().optional(),
  client_name: z.string().optional(),
  name: z.string().optional(),
  client_contact: z.string().optional(),
  contact: z.string().optional(),
  canal: z.string().optional(),
  source: z.string().optional(),
  destination: z.string().optional(),
  dest: z.string().optional(),
  dates: z.string().optional(),
  classe: z.string().optional(),
  type: z.string().optional(),
  passagers: z.coerce.number().int().min(1).optional(),
  pax: z.coerce.number().int().min(1).optional(),
  status: z.string().optional(),
  apporteur_name: z.string().nullable().optional(),
  apporteuse: z.string().nullable().optional(),
  closer_name: z.string().nullable().optional(),
  sdr: z.string().nullable().optional(),
  calendly_link: z.string().nullable().optional(),
  next_followup: z.string().nullable().optional(),
  followup: z.string().nullable().optional(),
  notes: z.string().optional(),
  value: z.coerce.number().optional(),
  margin: z.coerce.number().optional(),
  urgent: z.coerce.boolean().optional(),
}).passthrough();

export const leadPatchSchema = z.object({
  status: LEAD_STATUSES.optional(),
  notes: z.string().optional(),
  value: z.coerce.number().optional(),
  margin: z.coerce.number().optional(),
  closer_name: z.string().nullable().optional(),
  apporteur_name: z.string().nullable().optional(),
  next_followup: z.string().nullable().optional(),
  calendly_link: z.string().nullable().optional(),
  urgent: z.coerce.boolean().optional(),
}).passthrough();

export const idParamSchema = z.object({
  id: z.string().min(1),
});

// ─── /api/devis ──────────────────────────────────────────
export const devisCreateSchema = z.object({
  id: z.string().optional(),
  lead_id: z.string().min(1),
  compagnie: z.string().optional().default(""),
  horaire_dep: z.string().optional().default(""),
  horaire_arr: z.string().optional().default(""),
  prix_revient: z.coerce.number().min(0).optional().default(0),
  prix_vente: z.coerce.number().min(0).optional().default(0),
  prix_marche: z.coerce.number().min(0).optional().default(0),
  apporteur_name: z.string().nullable().optional(),
  services_inclus: z.union([z.array(z.string()), z.string()]).optional().default([]),
  pdf_url: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export const devisQuerySchema = z.object({
  role: z.enum(["admin", "dalsim", "closeuse", "agent"]).optional().default("admin"),
});

// ─── /api/admin/scrape & flights ─────────────────────────
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD");

export const scrapeBodySchema = z.object({
  from: z.string().min(2).max(4).optional().default("COO"),
  to: z.string().min(2).max(4).optional().default("CDG"),
  depart: isoDate,
  return: z.union([isoDate, z.literal("")]).optional().default(""),
  adults: z.coerce.number().int().min(1).max(9).optional().default(1),
  limit: z.coerce.number().int().min(1).max(30).optional().default(12),
  fromSlug: z.string().optional(),
  toSlug: z.string().optional(),
});

export const purgeBodySchema = z.object({
  mode: z.enum(["demo", "noprice", "scraped", "all"]).optional().default("demo"),
});

export const flightStatusSchema = z.object({
  status: z.enum(["scraped", "shortlisted", "contacted", "booked"]),
});
