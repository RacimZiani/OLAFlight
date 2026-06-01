import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { getStore } from "../db/index.js";
import { verifyPassword, hashPassword, isReasonablePassword } from "../lib/passwords.js";
import { signSession, verifySession } from "../lib/jwt.js";
import { config } from "../config.js";
import { uid } from "../lib/ids.js";
import { HttpError } from "../middleware/errorHandler.js";
import { createLogger } from "../logger.js";
import { isAdmin } from "../lib/roles.js";

const log = createLogger("auth");
const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours, doit matcher SESSION_TTL
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    name: u.display_name || null,
    whatsapp: u.whatsapp || null,
  };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const store = await getStore();
    const user = await store.users.findByField?.("email", req.body.email.toLowerCase());
    if (!user || !user.active) {
      throw new HttpError(401, "Identifiants incorrects");
    }
    const ok = await verifyPassword(req.body.password, user.password_hash);
    if (!ok) {
      // Délai pour ralentir le brute-force (très basique).
      await new Promise((r) => setTimeout(r, 250));
      throw new HttpError(401, "Identifiants incorrects");
    }
    const token = signSession(user);
    res.cookie(config.auth.cookieName, token, {
      ...COOKIE_OPTS,
      secure: config.auth.cookieSecure,
    });
    log.info(`login OK · ${user.email} (${user.role})`);
    res.json({ user: publicUser(user) });
  } catch (e) { next(e); }
});

router.post("/logout", (req, res) => {
  res.clearCookie(config.auth.cookieName, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  // attachUser middleware a déjà décodé le JWT dans req.user (si présent)
  if (!req.user || req.user.role === "guest") {
    return res.status(401).json({ error: "Non authentifié" });
  }
  // On recharge depuis la DB pour avoir les infos fraîches (rôle, statut actif).
  const store = await getStore();
  const user = req.user.id ? await store.users.findById?.(req.user.id) : null;
  if (!user || !user.active) {
    return res.status(401).json({ error: "Session invalide" });
  }
  res.json({ user: publicUser(user) });
});

// ─── Admin only : gestion des comptes ────────────────────────────────────
const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "8 caractères minimum"),
  role: z.enum(["admin", "prospecteur", "closer", "dalsim", "closeuse", "agent"]),
  display_name: z.string().min(1).optional(),
  whatsapp: z.string().optional(),
});

router.get("/users", async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) throw new HttpError(403, "Admin requis");
    const store = await getStore();
    const items = (await store.users.list()).map((u) => ({
      id: u.id, email: u.email, role: u.role,
      display_name: u.display_name, whatsapp: u.whatsapp, active: !!u.active,
      created_at: u.created_at,
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/users", validate({ body: userCreateSchema }), async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) throw new HttpError(403, "Admin requis");
    if (!isReasonablePassword(req.body.password)) {
      throw new HttpError(400, "Mot de passe trop faible (8 caractères minimum)");
    }
    const store = await getStore();
    const email = req.body.email.toLowerCase();
    const existing = await store.users.findByField?.("email", email);
    if (existing) throw new HttpError(409, "Email déjà utilisé");
    const password_hash = await hashPassword(req.body.password);
    const created = await store.users.insert({
      id: uid(),
      email,
      password_hash,
      role: req.body.role,
      display_name: req.body.display_name || null,
      whatsapp: req.body.whatsapp || null,
      active: 1,
    });
    log.info(`user créé · ${email} (${req.body.role}) par ${req.user.email}`);
    res.json({
      user: {
        id: created.id, email: created.email, role: created.role,
        display_name: created.display_name, whatsapp: created.whatsapp, active: !!created.active,
      },
    });
  } catch (e) { next(e); }
});

const userPatchSchema = z.object({
  role: z.enum(["admin", "prospecteur", "closer", "dalsim", "closeuse", "agent"]).optional(),
  display_name: z.string().optional(),
  whatsapp: z.string().nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

router.patch("/users/:id", validate({ body: userPatchSchema }), async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) throw new HttpError(403, "Admin requis");
    const store = await getStore();
    const patch = { ...req.body };
    if (patch.password) {
      patch.password_hash = await hashPassword(patch.password);
      delete patch.password;
    }
    if (typeof patch.active === "boolean") patch.active = patch.active ? 1 : 0;
    const updated = await store.users.update(req.params.id, patch);
    if (!updated) throw new HttpError(404, "Utilisateur introuvable");
    res.json({
      user: {
        id: updated.id, email: updated.email, role: updated.role,
        display_name: updated.display_name, whatsapp: updated.whatsapp, active: !!updated.active,
      },
    });
  } catch (e) { next(e); }
});

const mePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, "8 caractères minimum"),
});

router.post("/me/password", validate({ body: mePasswordSchema }), async (req, res, next) => {
  try {
    if (!req.user || req.user.role === "guest") throw new HttpError(401, "Authentification requise");
    if (!req.user.id) throw new HttpError(400, "Session sans identifiant utilisateur");
    const store = await getStore();
    const user = await store.users.findById(req.user.id);
    if (!user || !user.active) throw new HttpError(401, "Compte introuvable ou inactif");
    const ok = await verifyPassword(req.body.current_password, user.password_hash);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 250));
      throw new HttpError(403, "Mot de passe actuel incorrect");
    }
    if (!isReasonablePassword(req.body.new_password)) {
      throw new HttpError(400, "Nouveau mot de passe trop faible (8 caractères minimum)");
    }
    const password_hash = await hashPassword(req.body.new_password);
    await store.users.update(user.id, { password_hash });
    log.info(`password changed · ${user.email}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) throw new HttpError(403, "Admin requis");
    if (req.user.id === req.params.id) {
      throw new HttpError(400, "On ne peut pas se supprimer soi-même");
    }
    const store = await getStore();
    const removed = await store.users.remove(req.params.id);
    res.json({ removed });
  } catch (e) { next(e); }
});

export default router;
