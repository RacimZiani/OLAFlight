/* Ola Flight — auth gate client.
 * Inclus dans crm.html / dalsim.html / admin.html.
 * Bloque l'affichage tant que la session n'est pas vérifiée, redirige vers
 * /login.html?next=<page actuelle> si pas authentifié, et expose
 *   window.OlaAuth = { user, logout(), required(roles) }.
 *
 * Optionnel : placer dans la page <meta name="ola-required-roles" content="admin,dalsim">
 * pour exiger un rôle spécifique. Sinon : tout rôle non-guest est accepté.
 */
(function(){
  // Cache la page pendant la vérif (évite le flash de contenu privé).
  const style = document.createElement('style');
  style.textContent = 'html.ola-auth-pending body{visibility:hidden!important;}';
  document.head.appendChild(style);
  document.documentElement.classList.add('ola-auth-pending');

  function reveal(){ document.documentElement.classList.remove('ola-auth-pending'); }

  function getRequiredRoles(){
    const m = document.querySelector('meta[name="ola-required-roles"]');
    if(!m) return null;
    return m.content.split(',').map(s => s.trim()).filter(Boolean);
  }

  async function logout(){
    try{ await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); }
    catch{}
    location.href = '/';
  }

  function injectUserChip(user){
    // On cherche un conteneur connu (.tb-right, .topbar, header) sinon on fixe en haut à droite.
    const target = document.querySelector('.tb-right, .top-right, header .right')
      || document.querySelector('.topbar, header')
      || document.body;

    const chip = document.createElement('div');
    chip.className = 'ola-user-chip';
    chip.innerHTML = `
      <span class="ouc-name"></span>
      <span class="ouc-role"></span>
      <button class="ouc-logout" type="button">Déconnexion</button>
    `;
    chip.querySelector('.ouc-name').textContent = user.name || user.email;
    chip.querySelector('.ouc-role').textContent = user.role;
    chip.querySelector('.ouc-logout').addEventListener('click', logout);

    const css = document.createElement('style');
    css.textContent = `
      .ola-user-chip{display:inline-flex;align-items:center;gap:10px;font-family:'Montserrat',sans-serif;font-size:8px;font-weight:300;letter-spacing:2px;text-transform:uppercase;color:rgba(245,243,239,0.55);}
      .ola-user-chip .ouc-name{color:#f5f3ef;}
      .ola-user-chip .ouc-role{padding:3px 8px;background:rgba(245,243,239,0.09);color:#f5f3ef;}
      .ola-user-chip .ouc-logout{font:inherit;letter-spacing:2px;text-transform:uppercase;color:rgba(245,243,239,0.55);background:transparent;border:1px solid rgba(245,243,239,0.18);padding:6px 12px;cursor:pointer;transition:all .2s;}
      .ola-user-chip .ouc-logout:hover{color:#f5f3ef;border-color:#f5f3ef;}
      @media (max-width:640px){ .ola-user-chip .ouc-role{display:none;} }
    `;
    document.head.appendChild(css);

    if(target.classList.contains('topbar') || target.tagName === 'HEADER'){
      // Pose à droite à l'intérieur du header.
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:14px;padding:0 16px;';
      wrap.appendChild(chip);
      target.appendChild(wrap);
    } else {
      target.appendChild(chip);
    }
  }

  function redirectToLogin(){
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace('/login.html?next=' + next);
  }

  async function check(){
    let res;
    try{
      res = await fetch('/api/auth/me', { credentials: 'include' });
    }catch{
      redirectToLogin(); return;
    }
    if(!res.ok){ redirectToLogin(); return; }
    const data = await res.json().catch(() => null);
    const user = data && data.user;
    if(!user){ redirectToLogin(); return; }

    function normRole(r){
      const x = String(r||'').toLowerCase();
      if(x==='closeuse') return 'closer';
      if(x==='dalsim'||x==='agent') return 'prospecteur';
      return x;
    }
    const required = getRequiredRoles();
    if(required && !required.some(r => normRole(r)===normRole(user.role) || r===user.role)){
      location.replace('/');
      return;
    }

    window.OlaAuth = { user, logout };
    // expose Authorization header helper pour les fetch (cookie suffit normalement,
    // c'est juste utile aux scripts existants qui utilisent X-Admin-Token legacy).
    window.OlaAuth.fetch = (url, opts={}) => fetch(url, {
      ...opts,
      credentials: 'include',
      headers: { ...(opts.headers || {}) },
    });
    injectUserChip(user);
    reveal();
    document.dispatchEvent(new CustomEvent('ola:auth', { detail: user }));
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
