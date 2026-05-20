import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { renderDevisHtml } from "./pdfTemplate.js";
import { OLA_LOGO_DATA_URI } from "./olaLogo.js";
import { sanitizeDevisForRole } from "./commissions.js";

const log = createLogger("pdf");

let _browser;
async function getBrowser() {
  // Lazy : on ne lance Chromium que si on a besoin d'un PDF.
  if (_browser) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // Si le process meurt, on libère.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, async () => {
      try { await _browser?.close(); } catch {}
    });
  }
  return _browser;
}

async function ensurePdfDir() {
  await fs.mkdir(config.pdf.outDir, { recursive: true });
}

/**
 * Génère un PDF de devis et retourne { absolutePath, publicUrl, filename }.
 * Le devis reçu est SANITIZÉ (rule S01) avant génération — le template ne voit
 * jamais `prix_revient`, `marge`, ni les commissions.
 */
export async function generateDevisPdf({ devis, lead }) {
  await ensurePdfDir();
  // Filet de sécurité même si la route oublie de sanitize : on retire
  // prix_revient / marge / commissions avant de toucher au template.
  const safeDevis = sanitizeDevisForRole(devis, "client");

  const html = renderDevisHtml({
    devis: safeDevis,
    lead,
    companyLogo: OLA_LOGO_DATA_URI,
  });
  const filename = `devis-${devis.id}.pdf`;
  const absolutePath = path.join(config.pdf.outDir, filename);
  const publicUrl = `${config.pdf.publicPath}/${filename}`;

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: absolutePath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    log.info(`pdf généré → ${publicUrl}`);
    return { absolutePath, publicUrl, filename };
  } finally {
    await context.close();
  }
}

export async function shutdownPdfBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}
