/* Navigation back-office selon le rôle (admin / prospecteur / closer / concierge).
 *
 *  • Ordinateur : liens principaux du rôle dans la barre du haut + menu « Plus ».
 *  • Téléphone (≤ 760 px) : barre d'onglets en bas (4 raccourcis + « Menu »).
 *    Le menu regroupe toutes les pages, les notifications sur le téléphone,
 *    l'installation de l'application et la déconnexion.
 *  • Application installable (manifest + service worker).
 *  • Pulsation d'activité (suivi du temps actif, voir /api/activity/ping).
 *
 * Une page peut garder sa propre barre basse avec <body data-ola-own-tabbar>.
 */
(function () {
  if (!document.getElementById("ola-app-nav-css")) {
    const link = document.createElement("link");
    link.id = "ola-app-nav-css";
    link.rel = "stylesheet";
    link.href = "/app-nav.css";
    document.head.appendChild(link);
  }
  // Application installable : manifest, couleur de barre, icône iOS.
  const headOnce = (sel, make) => { if (!document.head.querySelector(sel)) document.head.appendChild(make()); };
  headOnce('link[rel="manifest"]', () => Object.assign(document.createElement("link"), { rel: "manifest", href: "/manifest.webmanifest" }));
  headOnce('meta[name="theme-color"]', () => Object.assign(document.createElement("meta"), { name: "theme-color", content: "#0a0a0a" }));
  headOnce('meta[name="apple-mobile-web-app-capable"]', () => Object.assign(document.createElement("meta"), { name: "apple-mobile-web-app-capable", content: "yes" }));
  headOnce('meta[name="apple-mobile-web-app-status-bar-style"]', () => Object.assign(document.createElement("meta"), { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }));
  headOnce('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement("meta"), { name: "apple-mobile-web-app-title", content: "Ola Équipe" }));
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });

  const ALL = ["admin", "prospecteur", "closer", "concierge", "dalsim", "closeuse"];
  const SELLERS = ["admin", "closer", "concierge", "closeuse"];
  const ICON = {
    hub: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    dashboard: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    relances: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    clients: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    crm: '<rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="11"/><rect x="17" y="4" width="4" height="7"/>',
    conciergerie: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
    devis: '<path d="M2 16l20-6-4-2-6 2-6-6-2 1 4 6-4 1-2-2-1 1z"/>',
    commissions: '<circle cx="12" cy="12" r="9"/><path d="M15 9a3 3 0 0 0-3-1.5c-1.7 0-3 1-3 2.2 0 3 6 1.6 6 4.6 0 1.2-1.3 2.2-3 2.2A3 3 0 0 1 9 15M12 6v1.5M12 16.5V18"/>',
    direction: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>',
    users: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  const LINKS = {
    hub: { href: "/hub.html", label: "Accueil", roles: ALL, group: "Travail" },
    relances: { href: "/relances.html", label: "Relances", roles: ALL, group: "Travail" },
    clients: { href: "/clients.html", label: "Clients", roles: ALL, group: "Travail" },
    crm: { href: "/crm.html", label: "Pipeline", roles: ALL, group: "Travail" },
    conciergerie: { href: "/devis-conciergerie.html", label: "Devis conciergerie", short: "Devis", roles: ALL, group: "Travail" },
    devis: { href: "/dalsim.html", label: "Devis vol", roles: ALL, group: "Travail" },
    dashboard: { href: "/dashboard.html", label: "Tableau de bord", short: "Résultats", roles: SELLERS, group: "Résultats" },
    commissions: { href: "/commissions.html", label: "Commissions", roles: ["concierge", "admin"], group: "Résultats" },
    direction: { href: "/direction.html", label: "Direction", roles: ["admin"], group: "Direction" },
    team: { href: "/team.html", label: "Vue équipe", roles: ["admin"], group: "Direction" },
    users: { href: "/users.html", label: "Comptes", roles: ["admin"], group: "Direction" },
    import: { href: "/import.html", label: "Import Google Sheet", roles: ["admin"], group: "Direction" },
  };
  // Raccourcis mis en avant (barre du haut sur ordinateur, onglets en bas sur téléphone).
  const PRIMARY = {
    admin: ["direction", "dashboard", "clients", "relances", "crm"],
    concierge: ["relances", "clients", "conciergerie", "dashboard", "crm"],
    closer: ["relances", "clients", "crm", "dashboard", "conciergerie"],
    prospecteur: ["relances", "clients", "crm", "devis", "conciergerie"],
  };

  function norm(role) {
    const r = String(role || "").toLowerCase();
    if (r === "closeuse") return "closer";
    if (r === "dalsim" || r === "agent") return "prospecteur";
    return r;
  }
  function canSee(userRole, allowed) {
    const n = norm(userRole);
    return allowed.some((a) => norm(a) === n || a === userRole);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;
  // Le serveur sert des adresses sans « .html » (/hub.html → /hub) : on compare sans l'extension.
  const clean = (p) => p.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const isCurrent = (href) => clean(location.pathname) === clean(href) || (href === "/hub.html" && location.pathname === "/");

  function visibleKeys(user) {
    return Object.keys(LINKS).filter((k) => canSee(user.role, LINKS[k].roles));
  }

  // ── Ordinateur : barre du haut ─────────────────────────────
  function injectTopNav(user) {
    const bar = document.querySelector(".tb-app-nav");
    if (!bar || bar.dataset.olaNavDone) return;
    bar.dataset.olaNavDone = "1";
    const keys = visibleKeys(user);
    const primary = (PRIMARY[norm(user.role)] || []).filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !primary.includes(k));
    // La page courante reste visible même si elle n'est pas dans les raccourcis.
    const currentRest = rest.find((k) => isCurrent(LINKS[k].href));
    const shown = currentRest ? [...primary, currentRest] : primary;
    const more = rest.filter((k) => k !== currentRest);

    // Affiche autant de raccourcis que la largeur le permet ; le reste passe dans « Plus ».
    const render = (n) => {
      const head = shown.slice(0, n);
      const tail = [...shown.slice(n), ...more];
      bar.innerHTML = head.map((k) => `<a class="tb-tab${isCurrent(LINKS[k].href) ? " active" : ""}" href="${LINKS[k].href}">${esc(LINKS[k].label)}</a>`).join("")
        + (tail.length ? `<div class="ola-more"><button type="button" class="tb-tab ola-more-btn" aria-haspopup="true" aria-expanded="false">Plus</button>
            <div class="ola-more-menu" role="menu">${tail.map((k) => `<a role="menuitem" href="${LINKS[k].href}"${isCurrent(LINKS[k].href) ? ' class="on"' : ""}>${esc(LINKS[k].label)}</a>`).join("")}</div></div>` : "");
      const btn = bar.querySelector(".ola-more-btn");
      if (btn) {
        const box = btn.parentElement;
        btn.addEventListener("click", (e) => { e.stopPropagation(); const open = box.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); });
      }
    };
    const overflows = () => {
      const last = bar.lastElementChild;
      return last && last.getBoundingClientRect().right > bar.getBoundingClientRect().right + 1;
    };
    const fit = () => {
      if (getComputedStyle(bar).display === "none") return; // téléphone : onglets du bas
      let n = shown.length;
      render(n);
      while (n > 0 && overflows()) render(--n);
    };
    fit();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fit, 120); });
    document.addEventListener("click", () => bar.querySelectorAll(".ola-more.open").forEach((b) => b.classList.remove("open")));
  }

  // ── Téléphone : onglets du bas + menu ──────────────────────
  function injectTabbar(user) {
    if (document.querySelector(".ola-tabbar") || document.body.hasAttribute("data-ola-own-tabbar")) return;
    const keys = visibleKeys(user);
    const tabs = (PRIMARY[norm(user.role)] || []).filter((k) => keys.includes(k)).slice(0, 4);
    const bar = document.createElement("nav");
    bar.className = "ola-tabbar";
    bar.setAttribute("aria-label", "Navigation principale");
    bar.innerHTML = tabs.map((k) => `<a href="${LINKS[k].href}" class="${isCurrent(LINKS[k].href) ? "on" : ""}">${svg(k)}<span>${esc(LINKS[k].short || LINKS[k].label)}</span></a>`).join("")
      + `<button type="button" class="ola-tab-menu">${svg("menu")}<span>Menu</span></button>`;
    document.body.appendChild(bar);
    document.documentElement.classList.add("ola-has-tabbar");
    bar.querySelector(".ola-tab-menu").addEventListener("click", () => openSheet(user));
  }

  function openSheet(user) {
    const keys = visibleKeys(user);
    const groups = {};
    for (const k of keys) (groups[LINKS[k].group] ||= []).push(k);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const bg = document.createElement("div");
    bg.className = "ola-sheet-bg";
    bg.innerHTML = `<div class="ola-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="ola-sheet-head"><div><div class="ola-sheet-name">${esc(user.name || user.email)}</div><div class="ola-sheet-role">${esc(({ admin: "Admin", prospecteur: "Prospecteur", closer: "Closer", concierge: "Concierge" })[norm(user.role)] || user.role)}</div></div>
        <button type="button" class="ola-sheet-x" aria-label="Fermer">✕</button></div>
      ${Object.entries(groups).map(([g, list]) => `<div class="ola-sheet-g">${esc(g)}</div>
        <div class="ola-sheet-links">${list.map((k) => `<a href="${LINKS[k].href}" class="${isCurrent(LINKS[k].href) ? "on" : ""}">${svg(k)}<span>${esc(LINKS[k].label)}</span></a>`).join("")}</div>`).join("")}
      <div class="ola-sheet-g">Mon téléphone</div>
      <div class="ola-sheet-actions">
        <button type="button" data-a="push">Recevoir les notifications</button>
        ${standalone ? "" : `<button type="button" data-a="install">Installer l'application</button>`}
        <button type="button" data-a="logout" class="danger">Déconnexion</button>
      </div>
      <div class="ola-sheet-info" hidden></div>
    </div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add("open"));
    const close = () => { bg.classList.remove("open"); setTimeout(() => bg.remove(), 200); };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    bg.querySelector(".ola-sheet-x").addEventListener("click", close);
    const info = bg.querySelector(".ola-sheet-info");
    const show = (html) => { info.hidden = false; info.innerHTML = html; info.scrollIntoView({ behavior: "smooth", block: "nearest" }); };

    bg.querySelector('[data-a="logout"]').addEventListener("click", () => (window.OlaAuth?.logout ? window.OlaAuth.logout() : (location.href = "/")));
    bg.querySelector('[data-a="install"]')?.addEventListener("click", async () => {
      if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; close(); return; }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      show(ios
        ? "<b>Sur iPhone :</b> touchez le bouton <b>Partager</b> de Safari (carré avec une flèche), puis <b>« Sur l'écran d'accueil »</b>. L'application s'ouvrira en plein écran comme une vraie app."
        : "<b>Sur Android :</b> ouvrez le menu du navigateur (⋮) puis <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.");
    });
    bg.querySelector('[data-a="push"]').addEventListener("click", async () => {
      try {
        const r = await fetch("/api/notifications/push/setup", { credentials: "include" });
        const d = await r.json();
        if (!d.enabled) { show("Les notifications sur téléphone ne sont pas encore activées sur le serveur. Prévenez la direction."); return; }
        show(`<b>1.</b> Installez l'application gratuite <b>ntfy</b> (<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a> · <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>).<br>
          <b>2.</b> Touchez ce lien depuis votre téléphone : <a href="${esc(d.subscribe_url)}" target="_blank" rel="noopener">m'abonner à mes alertes</a>.<br>
          <b>3.</b> Autorisez les notifications. Vous recevrez vos relances du matin, vos nouveaux clients et vos ventes.<br>
          <span style="opacity:.6">Ce lien est personnel, ne le partagez pas.</span>`);
      } catch { show("Impossible de récupérer votre lien. Réessayez dans un instant."); }
    });
  }

  function applyRoleUi(user) {
    const role = norm(user.role);
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.style.display = role === "admin" ? "" : "none";
    });
    document.querySelectorAll("[data-prospecteur-only]").forEach((el) => {
      el.style.display = role === "prospecteur" ? "" : "none";
    });
    document.querySelectorAll("[data-admin-closer-only]").forEach((el) => {
      el.style.display = role === "admin" || role === "closer" || role === "concierge" ? "" : "none";
    });
    const chip = document.querySelector(".ola-user-chip .ouc-role");
    if (chip) {
      const labels = { admin: "Admin", prospecteur: "Prospecteur", closer: "Closer", concierge: "Concierge" };
      chip.textContent = labels[role] || user.role;
    }
  }

  // Temps actif : une pulsation par minute quand l'onglet est visible ; elle
  // compte comme « active » si la page a été touchée dans les 2 dernières minutes.
  function startActivityPulse() {
    if (window.__olaPulse) return;
    window.__olaPulse = true;
    let lastInteract = Date.now();
    const mark = () => { lastInteract = Date.now(); };
    ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"].forEach((ev) =>
      window.addEventListener(ev, mark, { passive: true, capture: true }));
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/activity/ping", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: Date.now() - lastInteract < 120000, page: location.pathname }),
      }).catch(() => {});
    };
    ping();
    setInterval(ping, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { mark(); ping(); } });
  }

  document.addEventListener("ola:auth", (e) => {
    const user = e.detail;
    if (!user) return;
    injectTopNav(user);
    injectTabbar(user);
    applyRoleUi(user);
    startActivityPulse();
  });
})();
