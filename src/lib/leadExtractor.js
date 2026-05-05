import { structuredExtraction } from "./anthropic.js";
import { uid, safeJsonParse } from "./ids.js";
import { createLogger } from "../logger.js";

const log = createLogger("lead-extractor");

const EXTRACTION_PROMPT =
  'Extrait les infos du lead Ola Flight depuis la conversation et renvoie UNIQUEMENT un JSON minifié strict (pas de markdown), schéma : {"client_name":string,"first_name":string,"last_name":string,"email":string,"client_contact":string,"canal":"whatsapp"|"instagram","destination":string,"dates":string,"classe":string,"passagers":number}. Si une info manque, mets une chaîne vide.';

// Reçoit l'historique conversation, demande à Claude d'en extraire les 4 infos,
// renvoie un objet `lead` prêt à insérer (ou null si infos critiques manquantes).
export async function extractLeadFromConversation(messages) {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
    .join("\n");

  let raw;
  try {
    raw = await structuredExtraction({
      system: EXTRACTION_PROMPT,
      userText: transcript,
    });
  } catch (e) {
    log.warn(`extraction Anthropic échouée: ${e.message || e}`);
    return null;
  }

  const parsed = safeJsonParse(raw || "{}") || {};
  if (!parsed.destination || !parsed.dates) {
    log.debug("extraction incomplète (destination/dates manquants), aucun lead créé");
    return null;
  }

  const now = Date.now();
  const name =
    (parsed.client_name && String(parsed.client_name).trim()) ||
    [parsed.first_name, parsed.last_name].filter(Boolean).join(" ").trim() ||
    "Lead Web";
  return {
    id: uid(),
    client_name: name,
    client_contact: parsed.client_contact || "",
    canal: parsed.canal === "instagram" ? "instagram" : "whatsapp",
    destination: parsed.destination || "",
    dates: parsed.dates || "",
    classe: parsed.classe || "",
    passagers: Number(parsed.passagers) || 1,
    status: "devis_pending",
    notes: [
      "Créé automatiquement par l'agent IA après qualification.",
      parsed.email ? `Email: ${parsed.email}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    value: 0,
    margin: 0,
    urgent: true,
    created_at: now,
    updated_at: now,
  };
}
