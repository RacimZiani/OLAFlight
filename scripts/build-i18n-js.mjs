/**
 * Génère public/i18n.js depuis public/index.html (bloc I18N) + clés additionnelles.
 * Usage: node scripts/build-i18n-js.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const i18nPath = path.join(root, "public/i18n.js");
const i18nSrc = fs.readFileSync(i18nPath, "utf8");
const m = i18nSrc.match(/const I18N = (\{[\s\S]*?\n\});/);
if (!m) throw new Error("const I18N introuvable dans public/i18n.js");

const I18N = eval(`(${m[1].trim()})`);

const extraFr = {
  "meta.title": "OLA — Private Travel",
  "pos.intro":
    "OLA est un <strong>broker privé</strong> spécialisé dans l'optimisation des voyages premium. Nous opérons via un réseau confidentiel de partenariats exclusifs avec les compagnies aériennes et l'hotellerie de luxe mondiale. Le résultat : des conditions d'accès <strong>invisibles au grand public</strong>, une réactivité sans compromis, et une discrétion absolue sur chaque transaction.",
  "pilier.1.tag": "01 · Ce que nous faisons",
  "pilier.2.tag": "02 · Ce que vous gagnez",
  "pilier.3.tag": "03 · Comment on travaille",
  "pilier.4.tag": "04 · Notre engagement",
  "nav.login": "Connexion",
  "nav.logout": "Déconnexion",
  "nav.back.hub": "Espace équipe",
  "nav.back.crm": "Pipeline",
  "nav.back.devis": "Devis",
  "nav.back.admin": "Admin vols",
  "footer.center": "© 2025 OLA Flight · Paris · Private Travel",
  "chat.choice.accept": "Accepter",
  "chat.choice.negotiate": "Discuter",
  "chat.choice.refuse": "Pas pour moi",
  "chat.greet":
    "Bonjour, bienvenue chez Ōla Flight. Pour vous préparer les meilleures options, c'est pour quelle destination ?",
  "chat.err.tech": "Désolé, je rencontre un souci technique. Réessayez dans quelques instants.",
  "chat.err.empty": "Désolé, je n'ai pas pu formuler de réponse. Pouvez-vous renvoyer votre message ?",
  "chat.preset.accept": "Parfait, je valide. Vous pouvez lancer la réservation.",
  "chat.preset.negotiate": "Je suis intéressé. Est-ce qu'on peut optimiser le tarif (ou l'itinéraire) ?",
  "chat.preset.refuse": "Merci, je vais passer pour cette fois.",
  "chat.phone.placeholder": "6 12 34 56 78",
  "aria.chat.fab": "Discuter avec Ōla Flight",
  "aria.chat.dialog": "Agent Ōla Flight",
  "aria.chat.close": "Fermer",
  "aria.chat.send": "Envoyer",
  "aria.dial": "Indicatif pays",
  "login.title.page": "Ola Flight — Connexion",
  "login.brand.mark": "Private Travel",
  "login.brand.name": "Ola <em>Flight</em>",
  "login.brand.tag": "Espace équipe",
  "login.title": "Connexion",
  "login.sub": "Équipe Ola Flight",
  "login.label.email": "Email",
  "login.label.password": "Mot de passe",
  "login.placeholder.email": "vous@olaflight.com",
  "login.placeholder.password": "••••••••",
  "login.submit": "Entrer",
  "login.foot": "← retour au site",
  "login.err.network": "Réseau indisponible",
  "login.err.auth": "Connexion impossible",
  "login.err.creds": "Identifiants incorrects",
  "chat.form.aria": "Coordonnées",
};

const extraEn = {
  "meta.title": "OLA — Private Travel",
  "pos.intro":
    "OLA is a <strong>private broker</strong> specialised in optimising premium travel. We operate through a confidential network of exclusive partnerships with airlines and global luxury hospitality. The result: access conditions <strong>invisible to the public</strong>, uncompromising responsiveness, and absolute discretion on every transaction.",
  "pilier.1.tag": "01 · What we do",
  "pilier.2.tag": "02 · What you gain",
  "pilier.3.tag": "03 · How we work",
  "pilier.4.tag": "04 · Our commitment",
  "nav.login": "Sign in",
  "nav.logout": "Sign out",
  "nav.back.hub": "Team hub",
  "nav.back.crm": "Pipeline",
  "nav.back.devis": "Quotes",
  "nav.back.admin": "Flight admin",
  "footer.center": "© 2025 OLA Flight · Paris · Private Travel",
  "chat.choice.accept": "Accept",
  "chat.choice.negotiate": "Discuss",
  "chat.choice.refuse": "Not for me",
  "chat.greet":
    "Hello, welcome to Ōla Flight. To find you the best options — what's your destination?",
  "chat.err.tech": "Sorry, I'm having a technical issue. Please try again in a moment.",
  "chat.err.empty": "Sorry, I couldn't formulate a reply. Please send your message again.",
  "chat.preset.accept": "Perfect, I confirm. You can proceed with the booking.",
  "chat.preset.negotiate": "I'm interested. Can we optimise the fare (or the itinerary)?",
  "chat.preset.refuse": "Thanks, I'll pass this time.",
  "chat.phone.placeholder": "6 12 34 56 78",
  "aria.chat.fab": "Chat with Ōla Flight",
  "aria.chat.dialog": "Ōla Flight agent",
  "aria.chat.close": "Close",
  "aria.chat.send": "Send",
  "aria.dial": "Country code",
  "login.title.page": "Ola Flight — Sign in",
  "login.brand.mark": "Private Travel",
  "login.brand.name": "Ola <em>Flight</em>",
  "login.brand.tag": "Team access",
  "login.title": "Sign in",
  "login.sub": "Ola Flight team",
  "login.label.email": "Email",
  "login.label.password": "Password",
  "login.placeholder.email": "you@olaflight.com",
  "login.placeholder.password": "••••••••",
  "login.submit": "Sign in",
  "login.foot": "← back to site",
  "login.err.network": "Network unavailable",
  "login.err.auth": "Sign-in failed",
  "login.err.creds": "Incorrect email or password",
  "chat.form.aria": "Contact details",
};

Object.assign(I18N.fr, extraFr);
Object.assign(I18N.en, extraEn);

const out = `/* Ola Flight — i18n FR/EN */
(function (global) {
const I18N = ${JSON.stringify(I18N, null, 2)};

function applyLang(lang) {
  if (!I18N[lang]) lang = "fr";
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  const dict = I18N[lang];

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = dict[el.dataset.i18n];
    if (v != null) el.innerHTML = v;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const v = dict[el.dataset.i18nPlaceholder];
    if (v != null) el.placeholder = v;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const v = dict[el.dataset.i18nAria];
    if (v != null) el.setAttribute("aria-label", v);
  });

  if (dict["meta.title"]) document.title = dict["meta.title"];
  if (dict["login.title.page"] && /login\\.html$/i.test(location.pathname || "")) {
    document.title = dict["login.title.page"];
  }

  document.querySelectorAll('a[href*="wa.me/33600000000"]').forEach((a) => {
    const text = encodeURIComponent(dict["wa.text"] || "");
    a.href = \`https://wa.me/33600000000?text=\${text}\`;
  });

  const tg = document.getElementById("langToggle");
  if (tg) {
    tg.textContent = lang === "fr" ? "EN" : "FR";
    tg.classList.toggle("is-en", lang === "en");
    tg.setAttribute("aria-label", lang === "fr" ? "Switch to English" : "Passer en français");
  }

  try {
    localStorage.setItem("ola.lang", lang);
  } catch {
    /* ignore */
  }

  window.OlaLang = lang;
  document.dispatchEvent(new CustomEvent("ola:langchange", { detail: { lang, dict } }));
}

function getLang() {
  return document.documentElement.lang === "en" ? "en" : "fr";
}

function t(key, lang) {
  const l = lang || getLang();
  return (I18N[l] && I18N[l][key]) || (I18N.fr && I18N.fr[key]) || key;
}

let _langInited = false;

function initLang() {
  if (_langInited) return;
  _langInited = true;
  let saved = null;
  try {
    saved = localStorage.getItem("ola.lang");
  } catch {
    /* ignore */
  }
  const browser = (navigator.language || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  applyLang(saved || browser);
  const tg = document.getElementById("langToggle");
  if (tg) {
    tg.addEventListener("click", () => {
      applyLang(getLang() === "fr" ? "en" : "fr");
    });
  }
}

global.I18N = I18N;
global.applyLang = applyLang;
global.getLang = getLang;
global.t = t;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLang);
} else {
  initLang();
}
})(typeof window !== "undefined" ? window : globalThis);
`;

fs.writeFileSync(path.join(root, "public/i18n.js"), out, "utf8");
console.log("✓ public/i18n.js");
