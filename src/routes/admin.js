import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { scrapeBodySchema, purgeBodySchema, flightStatusSchema, idParamSchema } from "../schemas/index.js";
import { getStore } from "../db/index.js";
import { makeId } from "../lib/ids.js";
import { scrapeBooking, scrapeKayak, IATA_TO_CITY_SLUG } from "../lib/scraper.js";
import { HttpError } from "../middleware/errorHandler.js";
import { createLogger } from "../logger.js";

const log = createLogger("admin");
const router = Router();

router.use(requireAdmin);

router.get("/flights", async (_req, res, next) => {
  try {
    const store = await getStore();
    const items = await store.flights.list();
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/flights/purge", validate({ body: purgeBodySchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const items = await store.flights.list();
    let kept = items;
    switch (req.body.mode) {
      case "demo":
        kept = items.filter((x) => !(x?.meta?.blocked === true));
        break;
      case "noprice":
        kept = items.filter((x) => typeof x.price === "number" && x.price > 0);
        break;
      case "all":
        kept = [];
        break;
      case "scraped":
        kept = items.filter((x) => x.status !== "scraped");
        break;
    }
    await store.flights.save(kept);
    res.json({ removed: items.length - kept.length, total: kept.length });
  } catch (e) { next(e); }
});

router.post(
  "/flights/:id/status",
  validate({ params: idParamSchema, body: flightStatusSchema }),
  async (req, res, next) => {
    try {
      const store = await getStore();
      const updated = await store.flights.update(req.params.id, { status: req.body.status });
      if (!updated) throw new HttpError(404, "Flight not found");
      res.json({ item: updated });
    } catch (e) { next(e); }
  }
);

router.post("/scrape", validate({ body: scrapeBodySchema }), async (req, res, next) => {
  try {
    const from = String(req.body.from).toUpperCase();
    const to = String(req.body.to).toUpperCase();
    const { depart, adults, limit } = req.body;
    const ret = req.body.return || "";
    const fromSlug = req.body.fromSlug || IATA_TO_CITY_SLUG[from] || "";
    const toSlug = req.body.toSlug || IATA_TO_CITY_SLUG[to] || "";

    log.info(`scrape ${from}→${to} ${depart}${ret ? ` / ${ret}` : ""} ×${adults} (limit ${limit})`);

    // (1) Booking d'abord (rapide, pas de browser).
    let unique = [];
    let debug = {};
    try {
      const r = await scrapeBooking({ from, to, depart, ret, limit, adults, fromSlug, toSlug });
      unique = r.offers;
      debug = r.debug;
    } catch (err) {
      log.warn(`booking failed: ${err.message}`);
    }

    // (2) Kayak via Playwright en fallback (sources Booking bloquées en CI/datacenter).
    if (unique.length === 0) {
      try {
        unique = await scrapeKayak({ from, to, depart, ret, limit, adults });
      } catch (err) {
        log.warn(`kayak failed: ${err.message}`);
      }
    }

    if (unique.length === 0) {
      return res.status(502).json({
        error:
          "Impossible d'extraire des prix réels (sources bloquées ou format changé). Réessaie plus tard, change les dates, ou utilise un autre couple de villes.",
        debug,
      });
    }

    const store = await getStore();
    const items = await store.flights.list();
    const existing = new Set(items.map((x) => x.external_id));

    const now = Date.now();
    const toAdd = unique
      .filter((x) => !existing.has(x.external_id))
      .map((x) => ({
        id: makeId(x.external_id),
        status: "scraped",
        created_at: now,
        updated_at: now,
        ...x,
      }));

    await store.flights.save([...toAdd, ...items]);
    res.json({ added: toAdd.length, total: toAdd.length + items.length });
  } catch (e) { next(e); }
});

export default router;
