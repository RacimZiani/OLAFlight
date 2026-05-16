import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { chatBodySchema } from "../schemas/index.js";
import { runAgent } from "../lib/agentRunner.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/errorHandler.js";
import { ensureConversation } from "../lib/conversation.js";
import { uid } from "../lib/ids.js";

const router = Router();

router.post("/", validate({ body: chatBodySchema }), async (req, res, next) => {
  if (!config.anthropic.apiKey) {
    return next(
      new HttpError(
        500,
        "Missing ANTHROPIC_API_KEY. En local : fichier .env. En prod (Railway, Render, etc.) : ajouter la variable d'environnement ANTHROPIC_API_KEY dans le tableau Variables du service."
      )
    );
  }
  try {
    const { messages, lang, conversation_id, lead_id } = req.body;
    const convId = conversation_id || `web-${uid().slice(0, 12)}`;

    // Persistance conversation "web" (clé = web:<convId>)
    const conv = await ensureConversation({
      channel: "web",
      contact: convId,
      lang,
      lead_id: lead_id || null,
      name: "",
    });

    // Inclure les messages serveur déjà persistés (le client n'envoie que les ~12 derniers).
    let mergedMessages = messages || [];
    if (conv?.messages?.length) {
      const serverMsgs = conv.messages.map((m) => ({ role: m.role, content: m.content }));
      const seen = new Set(serverMsgs.map((m) => `${m.role}:${m.content}`));
      for (const m of mergedMessages) {
        const k = `${m.role}:${m.content}`;
        if (!seen.has(k)) {
          serverMsgs.push(m);
          seen.add(k);
        }
      }
      mergedMessages = serverMsgs;
    }

    const result = await runAgent({
      messages: mergedMessages,
      lang,
      context: {
        channel: "web",
        contact: convId,
        conversation_id: conv?.id || null,
        lead_id: lead_id || conv?.lead_id || null,
        lang,
      },
    });

    // Stocker l'historique (borné) pour audit: on garde le dernier état connu.
    try {
      const store = await (await import("../db/index.js")).getStore();
      if (store.conversations_ola?.update && conv?.id) {
        const now = Date.now();
        const history = (messages || [])
          .slice(-24)
          .map((m) => ({ role: m.role, content: m.content, ts: now }))
          .concat([{ role: "assistant", content: result.text, ts: now }])
          .slice(-30);
        await store.conversations_ola.update(conv.id, { messages: history });
      }
    } catch {
      /* best effort */
    }

    res.json({ response: result.text, lead: result.lead, conversation_id: convId });
  } catch (err) {
    next(err);
  }
});

export default router;
