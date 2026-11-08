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
import commissionsRoutes from "./routes/commissions.js";
import devisConciergerieRoutes from "./routes/devisConciergerie.js";
import clientsRoutes from "./routes/clients.js";
import followupsRoutes from "./routes/followups.js";
import activityRoutes from "./routes/activity.js";
import dashboardRoutes from "./routes/dashboard.js";
import importRoutes from "./routes/import.js";
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

  // Redirige les URLs avec .html vers l'URL propre (/login.html → /login).
  app.use((req, res, next) => {
    if (req.path.endsWith('.html') && req.path !== '/index.html') {
      return res.redirect(301, req.path.slice(0, -5) + (req.url.slice(req.path.length) || ''));
    }
    next();
  });

  // Fichiers statiques (landing, login, CRM, Dalsim, admin).
  // extensions:['html'] permet de servir /login → login.html sans extension dans l'URL.
  app.use(express.static(config.staticDir, { extensions: ['html'] }));

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
  app.use("/api/import", importRoutes);         // admin : import du Google Sheet
  app.use("/api/dashboard", dashboardRoutes);  // dashboard perso + classement
  app.use("/api/activity", activityRoutes);    // suivi d'activité (direction)
  app.use("/api/followups", followupsRoutes);  // relances + messages types
  app.use("/api/clients", clientsRoutes);     // fiche client + recherche anti-doublon
  app.use("/api/leads", leadsRoutes);        // protégé interne (cf. routes/leads.js)
  app.use("/api/devis-conciergerie", devisConciergerieRoutes); // devis multi-prestations
  app.use("/api/devis", devisRoutes);        // protégé interne
  app.use("/api/apporteurs", apporteursRoutes);
  app.use("/api/admin", adminRoutes);        // admin only
  app.use("/api/agent", agentRoutes);        // audit agent IA (back-office)
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/team", teamRoutes);
  app.use("/api/commissions", commissionsRoutes); // concierge : compteur + simulateur

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
