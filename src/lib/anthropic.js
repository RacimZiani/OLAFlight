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
  const resp = await anthropic.messages.create({
    model: model || config.anthropic.model,
    max_tokens: maxTokens || config.anthropic.maxTokens,
    system,
    messages,
  });
  return { text: extractText(resp), raw: resp };
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
