/* Ola · fenêtre « Écrire au client » partagée (relances, fiche client).
 *
 *   OlaComposer.open({ id, client_name, phone, instagram }, { onDone(result) })
 *
 * Choix d'un message type (pré-sélectionné selon l'étape de relance), message
 * personnalisé modifiable, ouverture d'Instagram / WhatsApp avec le texte, puis
 * « C'est envoyé » ou « Le client a répondu » : l'échange est noté sur la fiche
 * et la prochaine relance est programmée automatiquement.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let css = false;

  function injectCss() {
    if (css) return; css = true;
    const st = document.createElement('style');
    st.textContent = `
    .dmc-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;display:flex;align-items:flex-end;justify-content:center;}
    .dmc{background:#111;border:1px solid rgba(245,243,239,.2);width:100%;max-width:620px;max-height:92dvh;overflow:auto;padding:18px 16px calc(18px + env(safe-area-inset-bottom));color:#f5f3ef;font-family:'Montserrat',sans-serif;}
    @media(min-width:700px){.dmc-bg{align-items:center;}}
    .dmc-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;}
    .dmc-t{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:300;}
    .dmc-x{background:none;border:none;color:rgba(245,243,239,.6);font-size:22px;cursor:pointer;padding:4px 8px;}
    .dmc-l{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:rgba(245,243,239,.45);margin:10px 0 6px;}
    .dmc-cats,.dmc-tpls{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;}
    .dmc-cats::-webkit-scrollbar,.dmc-tpls::-webkit-scrollbar{height:0;}
    .dmc-c{flex-shrink:0;font:300 10px 'Montserrat',sans-serif;padding:8px 10px;border:1px solid rgba(245,243,239,.12);background:#161616;color:rgba(245,243,239,.7);cursor:pointer;}
    .dmc-c.on{border-color:#d4b56a;color:#f5f3ef;}
    .dmc textarea{width:100%;min-height:150px;background:#161616;border:1px solid rgba(245,243,239,.12);color:#f5f3ef;font:300 15px/1.55 'Montserrat',sans-serif;padding:12px;border-radius:0;outline:none;resize:vertical;}
    .dmc-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;}
    .dmc-row2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:8px;}
    .dmc-b{font:400 9px 'Montserrat',sans-serif;letter-spacing:2px;text-transform:uppercase;padding:12px 8px;min-height:46px;border:1px solid rgba(245,243,239,.2);background:transparent;color:#f5f3ef;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center;}
    .dmc-b.p{background:#f5f3ef;color:#0a0a0a;border-color:#f5f3ef;}
    .dmc-b[aria-disabled="true"]{opacity:.3;pointer-events:none;}
    .dmc-m{font-size:11px;margin-top:8px;min-height:1em;color:#4ade80;}
    .dmc-m.err{color:#f87171;}`;
    document.head.appendChild(st);
  }

  async function api(url, opts = {}) {
    const r = await fetch(url, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.issues && d.issues[0]?.message) || d.error || 'Erreur');
    return d;
  }

  async function open(lead, { onDone } = {}) {
    injectCss();
    const bg = document.createElement('div');
    bg.className = 'dmc-bg';
    bg.innerHTML = `<div class="dmc" role="dialog" aria-modal="true">
      <div class="dmc-h"><div class="dmc-t">Écrire à ${esc(lead.client_name || 'ce client')}</div><button class="dmc-x" aria-label="Fermer">✕</button></div>
      <div class="dmc-l">Message type</div>
      <div class="dmc-cats"></div>
      <div class="dmc-tpls" style="margin-top:6px"></div>
      <div class="dmc-l">Message</div>
      <textarea>Chargement…</textarea>
      <div class="dmc-row">
        <a class="dmc-b" data-k="ig" target="_blank" rel="noopener">Instagram</a>
        <a class="dmc-b" data-k="wa" target="_blank" rel="noopener">WhatsApp</a>
        <button class="dmc-b" data-k="copy" type="button">Copier</button>
      </div>
      <div class="dmc-row2">
        <button class="dmc-b p" data-k="sent" type="button">C'est envoyé</button>
        <button class="dmc-b" data-k="reply" type="button">Le client a répondu</button>
      </div>
      <div class="dmc-m"></div>
    </div>`;
    document.body.appendChild(bg);
    const $ = (sel) => bg.querySelector(sel);
    const close = () => bg.remove();
    $('.dmc-x').onclick = close;
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

    const ta = $('textarea');
    const insta = String(lead.instagram || '').replace(/^@/, '');
    const digits = String(lead.phone || '').replace(/\D/g, '');
    const setLinks = () => {
      const ig = $('[data-k="ig"]'), wa = $('[data-k="wa"]');
      if (insta) { ig.href = 'https://ig.me/m/' + encodeURIComponent(insta); ig.removeAttribute('aria-disabled'); } else ig.setAttribute('aria-disabled', 'true');
      if (digits) { wa.href = `https://wa.me/${digits}?text=${encodeURIComponent(ta.value)}`; wa.removeAttribute('aria-disabled'); } else wa.setAttribute('aria-disabled', 'true');
    };
    ta.addEventListener('input', setLinks);
    const copy = async () => { try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); } };
    // Instagram n'accepte pas de texte pré-rempli : on copie, il n'y a plus qu'à coller.
    $('[data-k="ig"]').addEventListener('click', () => { copy(); msg('Message copié, collez-le dans la conversation.'); });
    $('[data-k="copy"]').addEventListener('click', async () => { await copy(); msg('Message copié.'); });

    const m = $('.dmc-m');
    function msg(t, err) { m.textContent = t; m.className = 'dmc-m' + (err ? ' err' : ''); }

    async function log(type) {
      const channel = insta && !digits ? 'instagram' : digits && !insta ? 'whatsapp' : (lead.canal === 'instagram' ? 'instagram' : insta ? 'instagram' : 'whatsapp');
      try {
        const d = await api(`/api/clients/${encodeURIComponent(lead.id)}/events`, {
          method: 'POST',
          body: JSON.stringify({ type, channel, body: type === 'dm_out' ? ta.value.trim() : '' }),
        });
        close();
        onDone && onDone({ type, lead: d.lead });
      } catch (e) { msg(e.message, true); }
    }
    $('[data-k="sent"]').addEventListener('click', () => log('dm_out'));
    $('[data-k="reply"]').addEventListener('click', () => log('dm_in'));

    // Messages types rendus pour ce client.
    let data;
    try { data = await api('/api/followups/templates?lead_id=' + encodeURIComponent(lead.id)); }
    catch (e) { ta.value = ''; msg(e.message, true); setLinks(); return; }
    const cats = data.categories.filter((c) => data.items.some((t) => t.category === c.key));
    let cat = cats.some((c) => c.key === data.suggested_category) ? data.suggested_category : cats[0]?.key;
    function renderCats() {
      $('.dmc-cats').innerHTML = cats.map((c) => `<button type="button" class="dmc-c ${c.key === cat ? 'on' : ''}" data-c="${esc(c.key)}">${esc(c.label)}${c.key === data.suggested_category ? ' ★' : ''}</button>`).join('');
      $('.dmc-cats').querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cat = b.dataset.c; renderCats(); });
      const list = data.items.filter((t) => t.category === cat);
      $('.dmc-tpls').innerHTML = list.map((t, i) => `<button type="button" class="dmc-c ${i === 0 ? 'on' : ''}" data-t="${esc(t.id)}">${esc(t.title)}</button>`).join('');
      $('.dmc-tpls').querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
        $('.dmc-tpls').querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
        ta.value = data.rendered[b.dataset.t] || ''; setLinks();
      });
      ta.value = list[0] ? data.rendered[list[0].id] || '' : ''; setLinks();
    }
    renderCats();
  }

  window.OlaComposer = { open };
})();
