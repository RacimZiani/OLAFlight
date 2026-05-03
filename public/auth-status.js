/* Ola Flight — auth status pour pages publiques (landing).
 * Affiche / masque les liens .ola-back-link selon le rôle, et bascule
 *   .ola-login-link  ↔  .ola-logout-link
 * Aucune redirection : la page reste accessible aux visiteurs anonymes.
 */
(function(){
  async function check(){
    let user = null;
    try{
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if(r.ok){
        const j = await r.json();
        user = j && j.user;
      }
    }catch{ /* offline → considéré comme déconnecté */ }

    const loginLink = document.getElementById('olaLoginLink');
    const logoutBtn = document.getElementById('olaLogoutBtn');
    const backLinks = document.querySelectorAll('.ola-back-link');

    if(user){
      if(loginLink) loginLink.hidden = true;
      if(logoutBtn) logoutBtn.hidden = false;
      backLinks.forEach((a) => {
        const allowed = (a.getAttribute('data-back-roles') || '').split(',').map(s => s.trim()).filter(Boolean);
        a.hidden = allowed.length > 0 && !allowed.includes(user.role);
      });
    } else {
      if(loginLink) loginLink.hidden = false;
      if(logoutBtn) logoutBtn.hidden = true;
      backLinks.forEach((a) => { a.hidden = true; });
    }

    if(logoutBtn){
      logoutBtn.addEventListener('click', async () => {
        try{ await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); }
        catch{}
        location.reload();
      });
    }

    window.OlaAuth = { user };
    document.dispatchEvent(new CustomEvent('ola:auth', { detail: user }));
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
})();
