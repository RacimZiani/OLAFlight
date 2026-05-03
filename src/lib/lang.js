// Détection de langue ultra-simple, pas de dépendance.
// On regarde quelques mots fonctionnels FR vs EN. Suffit pour /api/chat.
const FR_HINTS = /\b(bonjour|bonsoir|salut|merci|s'il vous|svp|je|tu|nous|vous|et|ou|dans|avec|pour|destination|dates|vol|business|premi[èe]re|jet|h[ôo]tel)\b/i;
const EN_HINTS = /\b(hello|hi|thanks|thank you|please|i|you|we|and|or|in|with|for|destination|dates|flight|business|first|jet|hotel)\b/i;

export function detectLang(text) {
  const s = String(text || "").trim();
  if (!s) return "fr";
  const fr = (s.match(FR_HINTS) || []).length;
  const en = (s.match(EN_HINTS) || []).length;
  if (en > fr) return "en";
  return "fr";
}
