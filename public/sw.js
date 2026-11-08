/* Service worker Ola · Espace équipe.
 *
 * Volontairement prudent : les données (/api) et les pages ne sont JAMAIS
 * servies depuis le cache quand le réseau répond, pour ne jamais afficher un
 * client ou un chiffre périmé. Le cache sert seulement :
 *   • aux fichiers statiques (css, js, icônes), rafraîchis en arrière-plan ;
 *   • à une page « hors connexion » quand il n'y a plus de réseau.
 * Changer VERSION invalide l'ancien cache au prochain chargement.
 */
const VERSION = "ola-v1";
const OFFLINE = "/offline"; // le serveur sert les pages sans « .html »
const PRECACHE = [OFFLINE, "/app-nav.css", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/pdfs/")) return; // toujours le réseau

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (/\.(css|js|png|jpg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
