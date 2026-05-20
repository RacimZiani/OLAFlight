import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client;
function getClient() {
  if (!config.anthropic.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY manquante — copier .env.example en .env et renseigner la clé."
    );
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

function extractText(response) {
  return (
    response?.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") || ""
  );
}

export async function chatComplete({ system, messages, maxTokens, model }) {
  const anthropic = getClient();
  try {
    const resp = await anthropic.messages.create({
      model: model || config.anthropic.model,
      max_tokens: maxTokens || config.anthropic.maxTokens,
      system,
      messages,
    });
    return { text: extractText(resp), raw: resp };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/invalid x-api-key|authentication_error/i.test(msg)) {
      throw new Error(
        "ANTHROPIC_API_KEY invalide. Mets une vraie clé Anthropic dans `.env` puis redémarre le serveur."
      );
    }
    throw err;
  }
}

export async function structuredExtraction({ system, userText, maxTokens = 400, model }) {
  const { text } = await chatComplete({
    system,
    maxTokens,
    model,
    messages: [{ role: "user", content: userText }],
  });
  return text.trim().replace(/^```(?:json)?|```$/g, "").trim();
}

function extractToolUses(resp) {
  return (resp?.content || []).filter((b) => b.type === "tool_use");
}

/**
 * Exécute une conversation avec tools Anthropic (tool_use/tool_result) en boucle,
 * puis renvoie le texte final + l'historique messages enrichi.
 *
 * @param {object} args
 * @param {string} args.system
 * @param {Array<{role:"user"|"assistant",content:any}>} args.messages
 * @param {Array<{name:string,description?:string,input_schema:any}>} args.tools
 * @param {(toolUse:{id:string,name:string,input:any})=>Promise<any>} args.onToolUse
 * @param {number} [args.maxTurns=6]
 * @param {number} [args.maxTokens]
 * @param {string} [args.model]
 */
export async function chatWithTools({
  system,
  messages,
  tools,
  onToolUse,
  maxTurns = 6,
  maxTokens,
  model,
}) {
  const anthropic = getClient();
  const history = [...(messages || [])];

  for (let turn = 0; turn < maxTurns; turn++) {
    let resp;
    try {
      resp = await anthropic.messages.create({
        model: model || config.anthropic.model,
        max_tokens: maxTokens || config.anthropic.maxTokens,
        system,
        messages: history,
        tools,
        tool_choice: { type: "auto" },
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (/invalid x-api-key|authentication_error/i.test(msg)) {
        throw new Error(
          "ANTHROPIC_API_KEY invalide. Mets une vraie clé Anthropic dans `.env` puis redémarre le serveur."
        );
      }
      throw err;
    }

    // On ajoute la réponse assistant (bloc(s) text + tool_use) telle quelle.
    history.push({ role: "assistant", content: resp.content });

    const toolUses = extractToolUses(resp);
    if (!toolUses.length) {
      return { text: extractText(resp), raw: resp, messages: history };
    }

    const toolResults = [];
    for (const tu of toolUses) {
      try {
        const output = await onToolUse({ id: tu.id, name: tu.name, input: tu.input });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: [{ type: "text", text: JSON.stringify(output ?? null) }],
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err?.message || String(err) }),
            },
          ],
        });
      }
    }

    // Les tool_results sont un message "user" dans l'API Anthropic.
    history.push({ role: "user", content: toolResults });
  }

  // Fallback : boucle tools sans texte final → une passe de synthèse sans outils.
  const simpleMessages = history
    .map((m) => {
      if (typeof m.content === "string" && m.content.trim()) {
        return { role: m.role, content: m.content };
      }
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const t = extractText({ content: m.content });
        return t.trim() ? { role: "assistant", content: t } : null;
      }
      if (m.role === "user" && Array.isArray(m.content)) {
        return { role: "user", content: "[Résultat outil interne reçu — continue la conversation.]" };
      }
      return null;
    })
    .filter(Boolean)
    .slice(-16);

  if (simpleMessages.length) {
    try {
      const { text: synth } = await chatComplete({
        system: `${system}\n\nRéponds au client en texte clair (2–6 phrases max). N'utilise aucun outil. Ne réponds jamais uniquement par « ... ».`,
        messages: simpleMessages,
        maxTokens: Math.min(maxTokens || config.anthropic.maxTokens, 1024),
        model,
      });
      if (synth?.trim()) {
        return { text: synth.trim(), raw: null, messages: history };
      }
    } catch {
      /* ignore */
    }
  }

  const last = history
    .slice()
    .reverse()
    .find((m) => m.role === "assistant");
  const fake = { content: Array.isArray(last?.content) ? last.content : [{ type: "text", text: "" }] };
  return { text: extractText(fake), raw: fake, messages: history };
}
