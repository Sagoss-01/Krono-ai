/**
 * public/js/app.js
 */

const App = (() => {
  const state = {
    accounts:      window.__INIT__.accounts      || [],
    activeAccount: window.__INIT__.activeAccount || null,
    sidebarCollapsed: false,
    socket: null,
  };

  /* ════ SONS ═════════════════════════════════════════ */
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }
  function playSound(type) {
    try {
      const ctx = getAudioCtx(), gain = ctx.createGain();
      gain.connect(ctx.destination);
      if (type === 'send') {
        [440,660,880].forEach((freq,i) => {
          const osc = ctx.createOscillator(); osc.connect(gain); osc.type='sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime+i*.09);
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(.15, ctx.currentTime+i*.09+.01);
          gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+i*.09+.18);
          osc.start(ctx.currentTime+i*.09); osc.stop(ctx.currentTime+i*.09+.2);
        });
      } else if (type === 'notif') {
        const o1=ctx.createOscillator(),o2=ctx.createOscillator();
        o1.connect(gain); o2.connect(gain); o1.type=o2.type='sine';
        o1.frequency.setValueAtTime(1046.5, ctx.currentTime); o2.frequency.setValueAtTime(1318.5, ctx.currentTime);
        gain.gain.setValueAtTime(.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+.55);
        o1.start(ctx.currentTime); o1.stop(ctx.currentTime+.6); o2.start(ctx.currentTime); o2.stop(ctx.currentTime+.6);
      }
    } catch(e) {}
  }

  /* ════ TOAST ════════════════════════════════════════ */
  function toast(msg, type) {
    type = type||'info';
    const el = document.createElement('div');
    el.className = `toast toast-${type}`; el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity='0'; el.style.transform='translateY(8px)'; el.style.transition='.3s'; setTimeout(()=>el.remove(),300); }, 4200);
  }

  /* ════ THÈME ════════════════════════════════════════ */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('ts_theme', t);
    const moon=document.getElementById('ico-moon'), sun=document.getElementById('ico-sun');
    if(moon) moon.style.display=t==='dark'?'block':'none';
    if(sun)  sun.style.display =t==='light'?'block':'none';
    ['theme-dark-btn','theme-light-btn'].forEach(id=>{
      const b=document.getElementById(id); if(b) b.classList.toggle('active', id.includes(t));
    });
  }
  function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'); }
  function setTheme(t) { applyTheme(t); }

  /* ════ SIDEBAR ══════════════════════════════════════ */
  function toggleSidebar() {
    const sb=document.getElementById('sidebar');
    if(window.innerWidth<768) { sb.classList.toggle('mobile-open'); }
    else { state.sidebarCollapsed=!state.sidebarCollapsed; sb.classList.toggle('collapsed',state.sidebarCollapsed); }
  }

  /* ════ QUOTA ════════════════════════════════════════ */
  async function loadQuota() {
  try {
    const res = await apiGet('/api/quota');

    const block   = document.getElementById('quota-block');
    const bar     = document.getElementById('quota-bar');
    const pctEl   = document.getElementById('quota-pct');
    const usedEl  = document.getElementById('quota-used');
    const totalEl = document.getElementById('quota-total');

    if (!block) return;

    if (!res.ok || !res.quota || !res.quota.available) {
      console.info('[Quota] Non disponible');
      block.style.display = 'none';
      return;
    }

    const q = res.quota;

    const rawPct =
      Number.isFinite(q.percent)
        ? q.percent
        : (Number.isFinite(q.used) && Number.isFinite(q.limit) && q.limit > 0)
          ? (q.used / q.limit) * 100
          : 0;

    const pct = Math.max(0, Math.min(100, rawPct));

    console.info(
      '[Quota] ' +
      fmtBytes(q.usedBytes) +
      ' / ' +
      fmtBytes(q.limitBytes) +
      ' (' +
      formatQuotaPct(pct) +
      ')'
    );

    block.style.display = 'block';

    // Couleur selon le taux de remplissage
    const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : 'var(--accent)';

    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background = color;

      // Pour éviter une barre invisible quand on a 0.32%
      if (pct > 0 && pct < 1) {
        bar.style.minWidth = '6px';
      } else {
        bar.style.minWidth = '0';
      }
    }

    if (pctEl) {
      pctEl.textContent = formatQuotaPct(pct);
      pctEl.style.color = color;
    }

    if (usedEl)  usedEl.textContent  = fmtBytes(q.usedBytes);
    if (totalEl) totalEl.textContent = fmtBytes(q.limitBytes);

  } catch (e) {
    console.warn('[Quota] Erreur:', e.message);
  }
}

function formatQuotaPct(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  if (pct < 1) return pct.toFixed(2) + '%';
  if (pct < 10) return pct.toFixed(1) + '%';
  return Math.round(pct) + '%';
}

function fmtBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return '0 o';
  if (b < 1024) return b + ' o';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' Ko';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' Mo';
  return (b / 1073741824).toFixed(1) + ' Go';
}

  /* ════ COMPTES ══════════════════════════════════════ */
  function renderAccountPill() {
    const email=state.activeAccount||state.accounts[0]||'—';
    const el=document.getElementById('pill-email'), av=document.getElementById('pill-avatar');
    if(el) el.textContent=email; if(av) av.textContent=(email[0]||'?').toUpperCase();
  }
  function renderAccountMenu() {
    const list=document.getElementById('account-list'); if(!list) return;
    list.innerHTML=state.accounts.map(email=>`
      <button class="account-menu-item ${email===state.activeAccount?'active-account':''}" onclick="App.switchAccount('${email}')">
        <div style="width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#035c80,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;flex-shrink:0;">${email[0].toUpperCase()}</div>
        <span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${email}</span>
        ${email===state.activeAccount?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':''}
      </button>`).join('');
  }
  function renderSettingsAccounts() {
    const el=document.getElementById('settings-accounts-list'); if(!el) return;
    el.innerHTML=state.accounts.map(email=>`
      <div class="settings-account-item">
        <div class="settings-account-avatar">${email[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${email}</div>
        ${email===state.activeAccount?'<span class="active-badge">Actif</span>':''}
        <button class="icon-btn-sm danger" onclick="App.removeAccount('${email}')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }
  function toggleAccountMenu() {
    const menu=document.getElementById('account-menu'); if(!menu) return;
    const isOpen=menu.style.display!=='none';
    menu.style.display=isOpen?'none':'block';
    if(!isOpen) renderAccountMenu();
  }
  function closeAccountMenu() { const m=document.getElementById('account-menu'); if(m) m.style.display='none'; }
  async function switchAccount(email) {
    closeAccountMenu();
    const res=await apiPost('/api/switch-account',{email});
    if(res.ok){
      state.activeAccount=email; renderAccountPill(); Mail.loadEmails(true); loadQuota(); startSocket();
      toast(`Compte actif : ${email}`,'info');
      // Le changement de compte ne rechargeait que les mails — les discussions,
      // contacts et calendrier restaient sur l'ancien compte jusqu'à un F5 manuel.
      if (typeof ChatUI !== 'undefined') ChatUI.init(email);
      if (typeof ToolsUI !== 'undefined') { ToolsUI.refreshContacts(); ToolsUI.refreshCalendar(); ToolsUI.refreshAdminVisibility(); }
    }
  }
  async function removeAccount(email) {
    const res=await apiPost('/api/remove-account',{email});
    if(res.ok){
      state.accounts=state.accounts.filter(a=>a!==email);
      if(res.redirect){location.href=res.redirect;return;}
      state.activeAccount=res.activeAccount; renderAccountPill(); renderAccountMenu(); renderSettingsAccounts();
      toast(`Compte ${email} retiré`,'warning');
      if(state.activeAccount) Mail.loadEmails(true);
    }
  }
  function openAddAccount() { closeAccountMenu(); openModal('modal-add-account'); setTimeout(()=>document.getElementById('add-username')?.focus(),100); }
  async function submitAddAccount() {
    const username = document.getElementById('add-username').value.trim();
    const password = document.getElementById('add-password').value;
    // --- AJOUT : Récupération du domaine sélectionné ---
    const domain = document.getElementById('add-domain').value; 
    
    const errEl = document.getElementById('add-account-error'), 
          btn = document.getElementById('add-account-btn');

    if (!username || !password) {
      errEl.textContent = 'Champs requis';
      errEl.style.display = 'block';
      return;
    }

    errEl.style.display = 'none'; 
    btn.disabled = true; 
    btn.textContent = 'Connexion…';

    // DEBOGAGE : Affiche ce qui part au serveur dans ta console (F12)
    console.log("Données envoyées :", { username, password, domain });

    // --- MODIFICATION : On envoie aussi le domaine ---
    const res = await apiPost('/api/add-account', { username, password, domain });

    btn.disabled = false; 
    btn.textContent = 'Connecter ce compte';

    if (res.ok) {
      if (!state.accounts.includes(res.email)) state.accounts.push(res.email);
      closeModal('modal-add-account'); 
      renderAccountPill(); 
      renderSettingsAccounts();
      document.getElementById('add-username').value = ''; 
      document.getElementById('add-password').value = '';
      toast(`${res.email} connecté !`, 'success');
    } else { 
      errEl.textContent = res.error || 'Erreur'; 
      errEl.style.display = 'block'; 
    }
}
  const NOTIF_HISTORY_KEY = 'ts_notif_history';
  const NOTIF_MAX = 30;

  function loadNotifHistory() {
    try { return JSON.parse(sessionStorage.getItem(NOTIF_HISTORY_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function saveNotifHistory(list) {
    try { sessionStorage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(list.slice(0, NOTIF_MAX))); } catch (_) {}
  }

  function escHtmlNotif(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'à l\'instant';
    if (diff < 3600) return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h';
    return Math.floor(diff / 86400) + ' j';
  }

  function pushNotif({ title, body, icon }) {
    const list = loadNotifHistory();
    list.unshift({ title, body: body || '', icon: icon || '📧', ts: Date.now() });
    saveNotifHistory(list);
    renderNotifPanel();
    const dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = 'block';
  }

  function renderNotifPanel() {
    const list = loadNotifHistory();
    const el = document.getElementById('notif-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div style="padding:30px 16px;text-align:center;color:var(--text-muted);font-size:12px;">Aucune notification</div>';
      return;
    }
    el.innerHTML = list.map(n => `
      <div style="display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border);">
        <div style="font-size:16px;flex-shrink:0;">${n.icon}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:700;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtmlNotif(n.title)}</div>
          ${n.body ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtmlNotif(n.body)}</div>` : ''}
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">${timeAgo(n.ts)}</div>
        </div>
      </div>`).join('');
  }

  function toggleNotifPanel(event) {
    event?.stopPropagation();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.style.display === 'flex';
    if (isOpen) { closeNotifPanel(); return; }
    renderNotifPanel();
    panel.style.display = 'flex';
    document.getElementById('notif-dot').style.display = 'none';
    // Fermer au clic ailleurs sur la page
    setTimeout(() => document.addEventListener('click', _outsideNotifClick), 0);
  }

  function closeNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _outsideNotifClick);
  }

  function _outsideNotifClick(e) {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('notif-btn');
    if (panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeNotifPanel();
    }
  }

  function clearAllNotifs(event) {
    event?.stopPropagation();
    saveNotifHistory([]);
    renderNotifPanel();
  }
  function openModal(id) { const el=document.getElementById(id); if(el){ el.style.display='flex'; renderSettingsAccounts(); } }
  function closeModal(id) {
    const el=document.getElementById(id); if(el) el.style.display='none';
    if (id === 'modal-quick-connect' && typeof QuickConnectUI !== 'undefined') QuickConnectUI.stop();
  }
  function openSettings() { openModal('modal-settings'); Settings.showTab('general'); }
  function openDevices() { openModal('modal-devices'); if (typeof DevicesUI !== 'undefined') DevicesUI.showTab('devices'); }
  function openQuickConnect() { openModal('modal-quick-connect'); if (typeof QuickConnectUI !== 'undefined') QuickConnectUI.generate(); }

  /* ════ SOCKET ═══════════════════════════════════════ */
  function startSocket() {
    // Déconnecter l'ancien socket si changement de compte
    if (state.socket) { state.socket.disconnect(); state.socket = null; }

    //state.socket = io();
    state.socket = io({
  transports: ['websocket'],
  upgrade: false
});

    state.socket.on('connect', () => {
      // Envoyer le plus grand UID connu pour que le serveur évite les doublons
      const knownMaxUid = Mail.getMaxUid ? Mail.getMaxUid() : 0;
      state.socket.emit('start_poll', {
        email:       state.activeAccount,
        folder:      'INBOX',
        knownMaxUid: knownMaxUid,
      });
      // Re-rejoindre la room chat si une conversation était ouverte
      if (typeof ChatUI !== 'undefined') {
        const lastPeer = sessionStorage.getItem('ts_chat_peer');
        if (lastPeer) {
          state.socket.emit('chat_join', { myEmail: state.activeAccount, peerEmail: lastPeer });
        }
      }
    });

    state.socket.on('new_mail', (data) => {
      const dot=document.getElementById('notif-dot');
      if(dot) dot.style.display='block';
      playSound('notif');
      const count=data.count||0, folder=data.folder||'INBOX';
      toast(`${count} nouveau(x) message(s)`,'info');

      const first = data.emails?.[0];
      const from  = first?.headers?.from || 'Nouveau message';
      const subj  = first?.headers?.subject || '';
      pushNotif({ title: from, body: subj, icon: '📧' });

      // Notification desktop
      if (typeof Notifs !== 'undefined') {
        Notifs.send(`📧 ${from}`, subj, null, () => { Mail.openEmail(first?.uid); });
      }

      // Insérer directement sans recharger — zéro doublon grâce au filtre UID
      if (Mail.currentFolder === folder) {
        if (data.emails && data.emails.length > 0) {
          Mail.prependEmails(data.emails);
        }
        // NE PAS appeler loadEmails(true) ici — c'est ça qui causait le double affichage
      }
    });

    state.socket.on('unread_update', (data) => {
      if(data.folder==='INBOX'){
        const b=document.getElementById('inbox-badge');
        if(b){ b.textContent=data.count>0?data.count:''; b.style.display=data.count>0?'inline-block':'none'; }
      }
    });

    state.socket.on('connect_error', ()=>console.warn('Socket déconnecté…'));

    // Déconnexion forcée depuis un autre appareil (page "Appareils" > retirer/bloquer)
    state.socket.on('force_logout', (data) => {
      toast(data?.reason || 'Session terminée depuis un autre appareil.', 'warning');
      setTimeout(() => { window.location.href = '/login'; }, 1200);
    });

    if(typeof ChatUI!=='undefined') ChatUI.bindSocket(state.socket);
  }

  /* ════ API ══════════════════════════════════════════ */
  async function apiGet(url) {
    try {
      const r = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' },
      });
      if (r.status === 401) { location.href = '/login'; return { ok: false, error: 'Non authentifie' }; }
      return await r.json();
    } catch(e) { return { ok: false, error: e.message }; }
  }
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  async function apiPost(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { location.href = '/login'; return { ok: false, error: 'Non authentifie' }; }
      return await r.json();
    } catch(e) { return { ok: false, error: e.message }; }
  }

  async function apiDelete(url) {
    try {
      const r = await fetch(url, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      });
      if (r.status === 401) { location.href = '/login'; return { ok: false }; }
      return await r.json();
    } catch(e) { return { ok: false, error: e.message }; }
  }

  /* ════ INIT ═════════════════════════════════════════ */
  function init() {
    applyTheme(localStorage.getItem('ts_theme')||'dark');
    renderAccountPill();
    startSocket();
    loadQuota();
    if(typeof ChatUI!=='undefined') {
      ChatUI.init(state.activeAccount).then(() => {
        const lastMode = sessionStorage.getItem('ts_mode');
        if (lastMode === 'chat') {
          ChatUI.showChatMode();
          const lastPeer = sessionStorage.getItem('ts_chat_peer');
          if (lastPeer) ChatUI.openConversation(lastPeer);
        }
      });
    }

    if (typeof Notifs !== 'undefined') Notifs.request();

    const savedMode = sessionStorage.getItem('ts_mode');
    if (typeof ToolsUI !== 'undefined') {
      if (savedMode === 'tools-calendar') ToolsUI.showCalendar();
      else if (savedMode === 'tools-contacts') ToolsUI.showContacts();
    }
    if (savedMode === 'ai' && typeof AIAssistant !== 'undefined') AIAssistant.show();

    document.addEventListener('click', (e)=>{
      if(!document.getElementById('account-switcher')?.contains(e.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', (e)=>{
      if(e.key==='Escape'){
        closeAccountMenu();
        closeNotifPanel();
        ['modal-settings','modal-add-account','modal-devices','modal-quick-connect','modal-quick-approve'].forEach(closeModal);
        if(document.getElementById('logout-modal')?.style.display==='flex') cancelLogout();
      }
    });
    document.getElementById('logout-modal')?.addEventListener('click', function(e){
      if(e.target===this) cancelLogout();
    });
  }

  // ── Modale déconnexion ──────────────────────────────────────────────────────
  function confirmLogout() {
    const modal = document.getElementById('logout-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('logout-confirm-btn')?.focus(), 80);
  }

  function cancelLogout() {
    const modal = document.getElementById('logout-modal');
    if (!modal) return;
    modal.style.opacity = '0';
    modal.style.transition = 'opacity .15s';
    setTimeout(() => {
      modal.style.display = 'none';
      modal.style.opacity = '';
      modal.style.transition = '';
    }, 150);
  }

  function doLogout() {
    const btn  = document.getElementById('logout-confirm-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg style="animation:spin .6s linear infinite" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    }
    const meta = document.querySelector('meta[name="csrf-token"]');
    const csrf = document.getElementById('logout-csrf');
    if (meta && csrf) csrf.value = meta.content;
    document.getElementById('logout-form')?.submit();
  }

  return {
    state, toast, playSound, fmtBytes,
    applyTheme, toggleTheme, setTheme,
    toggleSidebar,
    toggleAccountMenu, closeAccountMenu, switchAccount, removeAccount,
    openAddAccount, submitAddAccount,
    toggleNotifPanel, closeNotifPanel, clearAllNotifs, pushNotif,
    openModal, closeModal, openSettings, openDevices, openQuickConnect,
    renderSettingsAccounts,
    apiGet, apiPost, apiDelete, getCsrfToken,
    loadQuota, startSocket,
    confirmLogout, cancelLogout, doLogout,
    init,
  };
})();

window.addEventListener('DOMContentLoaded', App.init);

// ── Ouverture directe d'une modale via l'URL (lien /devices, /quick-connect,
// ou redirection depuis un email/QR) ────────────────────────────────────
(function handleDirectModalParams() {
  const params = new URLSearchParams(window.location.search);
  const openDevicesFlag = params.get('openDevices');
  const openQuickConnectFlag = params.get('openQuickConnect');
  if (!openDevicesFlag && !openQuickConnectFlag) return;

  params.delete('openDevices');
  params.delete('openQuickConnect');
  const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', clean);

  window.addEventListener('DOMContentLoaded', () => {
    if (openDevicesFlag) App.openDevices();
    if (openQuickConnectFlag) App.openQuickConnect();
  });
})();

// ── Prompt post-connexion rapide (QR) ────────────────────────────────────
// Affiché une seule fois après une connexion via /quick-connect : propose de
// déconnecter l'appareil d'origine (celui qui a généré/approuvé le lien).
(function handleQuickConnectPrompt() {
  const params = new URLSearchParams(window.location.search);
  const originId = params.get('quickConnectOrigin');
  if (!originId) return;

  // Nettoyer l'URL tout de suite pour ne pas re-déclencher au rechargement
  params.delete('quickConnectOrigin');
  params.delete('quickConnected');
  const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', clean);

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const keep = confirm(
        "Tu es connecté via Connexion rapide !\n\n" +
        "Veux-tu garder l'ancien appareil connecté aussi ?\n\n" +
        "OK = garder les deux connectés\nAnnuler = déconnecter l'ancien appareil"
      );
      if (!keep) {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
        fetch(`/api/devices/${originId}/revoke`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } })
          .then(r => r.json())
          .then(res => { if (res.ok) toast('Ancien appareil déconnecté.', 'success'); });
      }
    }, 600);
  });
})();

/* ══ RESIZE PANNEAUX ════════════════════════════════ */
(function initResize() {
  const handle = document.getElementById('resize-handle');
  const list   = document.getElementById('list-panel');
  if (!handle || !list) return;

  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', function(e) {
    dragging = true; startX = e.clientX;
    startW = list.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const w = Math.min(520, Math.max(220, startW + (e.clientX - startX)));
    list.style.width = w + 'px';
    list.style.flexShrink = '0';
    localStorage.setItem('ts_list_w', w);
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // Restaurer la largeur sauvegardée
  const saved = localStorage.getItem('ts_list_w');
  if (saved && list) {
    list.style.width = saved + 'px';
    list.style.flexShrink = '0';
  }
})();