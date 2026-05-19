/* Navigation back-office selon le rôle (admin / prospecteur / closer). */
(function () {
  const LINKS = {
    hub: { href: "/hub.html", label: "Accueil", roles: ["admin", "prospecteur", "closer", "dalsim", "closeuse"] },
    crm: { href: "/crm.html", label: "Pipeline", roles: ["admin", "prospecteur", "closer", "dalsim", "closeuse"] },
    devis: { href: "/dalsim.html", label: "Créer un devis", roles: ["admin", "prospecteur", "closer", "dalsim", "closeuse"] },
    team: { href: "/team.html", label: "Équipe", roles: ["admin"] },
    users: { href: "/users.html", label: "Comptes", roles: ["admin"] },
    admin: { href: "/admin.html", label: "Admin vols", roles: ["admin"] },
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

  function injectNav(user) {
    const bar = document.querySelector(".tb-app-nav");
    if (!bar || bar.dataset.olaNavDone) return;
    bar.dataset.olaNavDone = "1";
    bar.innerHTML = "";
    const path = location.pathname;
    for (const item of Object.values(LINKS)) {
      if (!canSee(user.role, item.roles)) continue;
      const a = document.createElement("a");
      a.className = "tb-tab" + (path === item.href ? " active" : "");
      a.href = item.href;
      a.textContent = item.label;
      bar.appendChild(a);
    }
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
      el.style.display = role === "admin" || role === "closer" ? "" : "none";
    });
    const chip = document.querySelector(".ola-user-chip .ouc-role");
    if (chip) {
      const labels = { admin: "Admin", prospecteur: "Prospecteur", closer: "Closer" };
      chip.textContent = labels[role] || user.role;
    }
  }

  document.addEventListener("ola:auth", (e) => {
    const user = e.detail;
    if (!user) return;
    injectNav(user);
    applyRoleUi(user);
  });
})();
