import express from "express";
import path from "node:path";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { attachUser } from "./middleware/auth.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import leadsRoutes from "./routes/leads.js";
import devisRoutes from "./routes/devis.js";
import apporteursRoutes from "./routes/apporteurs.js";
import adminRoutes from "./routes/admin.js";
import webhooksRoutes from "./routes/webhooks.js";
import agentRoutes from "./routes/agent.js";
import notificationsRoutes from "./routes/notifications.js";
import teamRoutes from "./routes/team.js";
import publicDevisRoutes from "./routes/publicDevis.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Body parser : on capture le rawBody pour la vérification de signature Meta.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf?.toString("utf8") || "";
      },
    })
  );
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(attachUser);

  // Fichiers statiques (landing, login, CRM, Dalsim, admin).
  app.use(express.static(config.staticDir));

  // PDF devis — accès public (prioritaire sur fichiers statiques /pdfs éphémères).
  app.use("/api/public", publicDevisRoutes);
  // Anciens liens /pdfs/devis-XXX.pdf → route API (évite S3 / fichiers perdus sur Railway).
  app.get(`${config.pdf.publicPath}/devis-:id.pdf`, (req, res) => {
    res.redirect(302, `/api/public/devis/${encodeURIComponent(req.params.id)}/pdf`);
  });
  app.use(config.pdf.publicPath, express.static(config.pdf.outDir));

  // Health check.
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      env: config.env,
      storage: config.storage.driver,
      anthropic: Boolean(config.anthropic.apiKey),
      whatsapp: Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId),
      instagram: Boolean(config.instagram.token && config.instagram.pageId),
      calendly: Boolean(config.calendly.token || config.calendly.fallbackLink),
      time: new Date().toISOString(),
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/chat", chatRoutes);          // public — landing chatbot
  app.use("/api/webhooks", webhooksRoutes);  // public — Meta + Calendly callbacks
  app.use("/api/leads", leadsRoutes);        // protégé interne (cf. routes/leads.js)
  app.use("/api/devis", devisRoutes);        // protégé interne
  app.use("/api/apporteurs", apporteursRoutes);
  app.use("/api/admin", adminRoutes);        // admin only
  app.use("/api/agent", agentRoutes);        // audit agent IA (back-office)
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/team", teamRoutes);

  app.use(notFoundHandler);

  // Fallback SPA — sauf PDF publics et fichiers /pdfs.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/public/") || req.path.startsWith("/pdfs/")) {
      return next();
    }
    res.sendFile(path.join(config.staticDir, "index.html"));
  });

  app.use((req, res) => {
    if (req.path.startsWith("/pdfs/")) {
      return res.status(404).type("text/plain").send("PDF introuvable.");
    }
    res.status(404).type("text/plain").send("Page introuvable.");
  });

  app.use(errorHandler);
  return app;
}
