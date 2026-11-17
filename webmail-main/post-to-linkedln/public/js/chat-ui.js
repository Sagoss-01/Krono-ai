/**
 * public/js/chat-ui.js  v3
 * - avatars colores
 * - apercu fichier avant envoi
 * - modale nouvelle conversation avec select domaine
 * - persistance du mode au rechargement
 * - chargement historique fiable
 * - fichiers/images enregistres et affichables
 */
const ChatUI = (() => {
  let myEmail       = null;
  let currentPeer   = null;
  let allConvs      = [];
  let pendingFiles  = [];   // multi-fichiers
  let replyTo       = null; // { id, sender, content, media_name }

  const AVATAR_COLORS = [
    ['#035c80','#023d58'],['#0e7490','#0b5c73'],['#7c3aed','#5b21b6'],
    ['#059669','#047857'],['#d97706','#b45309'],['#dc2626','#b91c1c'],
    ['#0891b2','#0e7490'],['#7c3aed','#6d28d9'],
  ];

  function avatarColor(str) {
    let h = 5381;
    for (let i = 0; i < (str||'').length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function makeAvatarHtml(email, size) {
    const initials = (email || '?')[0].toUpperCase();
    const [c1, c2] = avatarColor(email || '');
    const s = size || 36;
    const r = Math.round(s * 0.3);
    return `<div style="width:${s}px;height:${s}px;border-radius:${r}px;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:${Math.round(s*0.38)}px;font-weight:800;color:white;flex-shrink:0;">${initials}</div>`;
  }

  /* Sons */
  function playSound(type) { App.playSound(type === 'send' ? 'send' : 'notif'); }

  /* Init */
  function init(email) {
    myEmail = email;
    return loadConversations();
  }

  /* Charger conversations */
  async function loadConversations() {
    const loading = document.getElementById('chat-conv-loading');
    const empty   = document.getElementById('chat-conv-empty');
    if (loading) loading.style.display = 'flex';
    if (empty)   empty.style.display   = 'none';

    const res = await App.apiGet('/api/chat/conversations');
    allConvs = (res.ok && res.conversations) ? res.conversations : [];

    if (loading) loading.style.display = 'none';
    renderSidebarConvs(allConvs);
    renderMainConvs(allConvs);
    updateChatBadge();
  }

  /* Rendu sidebar (liste compacte) */
  function renderSidebarConvs(convs) {
    const list  = document.getElementById('chat-conv-list');
    const empty = document.getElementById('chat-conv-empty');
    if (!list) return;
    Array.from(list.children).forEach(c => { if (c.id !== 'chat-conv-empty') c.remove(); });
    if (convs.length === 0) { if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';
    convs.slice(0, 5).forEach(conv => {
      const el = document.createElement('div');
      el.className = 'sb-conv-item' + (conv.peer_email === currentPeer ? ' active' : '');
      el.dataset.peer = conv.peer_email;
      el.onclick = () => { showChatMode(); openConversation(conv.peer_email); };
      el.innerHTML = `
        ${makeAvatarHtml(conv.peer_email, 28)}
        <div class="sb-conv-info">
          <div class="sb-conv-peer">${escHtml(conv.peer_email)}</div>
          <div class="sb-conv-last">${escHtml(conv.last_msg || '...')}</div>
        </div>
        ${conv.unread_count > 0 ? `<span class="sb-conv-badge">${conv.unread_count}</span>` : ''}`;
      list.appendChild(el);
    });
  }

  /* Rendu liste principale mode chat */
  function renderMainConvs(convs) {
    const container = document.getElementById('chat-conv-items');
    const loading   = document.getElementById('chat-conv-loading');
    const empty     = document.getElementById('chat-conv-empty');
    if (!container) return;

    // Cacher le spinner
    if (loading) loading.style.display = 'none';

    // Toujours rendre le container visible — on ne le cache JAMAIS
    container.style.display = 'block';
    container.style.flex    = '1';
    container.style.overflowY = 'auto';
    container.innerHTML = '';

    if (!convs || convs.length === 0) {
      if (empty) { empty.style.display = 'flex'; empty.style.flexDirection = 'column'; }
      return;
    }
    if (empty) empty.style.display = 'none';

    convs.forEach(conv => {
      const el = document.createElement('div');
      el.className = 'email-item' +
        (conv.peer_email === currentPeer ? ' active' : '') +
        (conv.unread_count > 0 ? ' unread' : '');
      el.dataset.peer = conv.peer_email;
      el.onclick = () => openConversation(conv.peer_email);
      const time = conv.last_at ? fmtDate(new Date(conv.last_at)) : '';
      el.innerHTML = `
        ${makeAvatarHtml(conv.peer_email, 38)}
        <div class="email-info">
          <div class="email-top">
            <span class="email-from">${escHtml(conv.peer_email)}</span>
            <span class="email-time">${time}</span>
          </div>
          <div class="email-subject">${escHtml(conv.last_msg || 'Demarrez la conversation')}</div>
        </div>
        ${conv.unread_count > 0 ? '<span class="email-unread-dot"></span>' : ''}`;
      container.appendChild(el);
    });
  }

  function updateChatBadge() {
    const total = allConvs.reduce((s, c) => s + (c.unread_count || 0), 0);
    const badge = document.getElementById('chat-unread-badge');
    if (!badge) return;
    badge.textContent   = total > 0 ? total : '';
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  }

  function filterConvs(q) {
    const filtered = q
      ? allConvs.filter(c => c.peer_email.toLowerCase().includes(q.toLowerCase()))
      : allConvs;
    renderMainConvs(filtered);
  }

  function searchMessages(q) {
    const msgs = document.querySelectorAll('#chat-view-messages .chat-msg-wrap');
    msgs.forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.opacity = (!q || text.includes(q.toLowerCase())) ? '' : '0.2';
    });
  }

  /* Bascule mail <-> chat */
  function showChatMode() {
    document.getElementById('mode-mail').style.display = 'none';
    document.getElementById('mode-chat').style.display = 'flex';
    sessionStorage.setItem('ts_mode', 'chat');
    renderMainConvs(allConvs);
  }

  function showMailMode() {
    document.getElementById('mode-mail').style.display = 'flex';
    document.getElementById('mode-chat').style.display = 'none';
    sessionStorage.setItem('ts_mode', 'mail');
    currentPeer = null;
  }

  // Mobile : revenir à la liste des conversations
  function goBackToList() {
    const listPanel = document.getElementById('chat-list-panel');
    const viewPanel = document.getElementById('chat-view-panel');
    if (listPanel) listPanel.style.display = '';
    if (viewPanel) viewPanel.style.cssText = '';
    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.style.display = 'none';
    currentPeer = null;
    sessionStorage.removeItem('ts_chat_peer');
  }

  /* Ouvrir une conversation */
  async function openConversation(peerEmail) {
    currentPeer = peerEmail;
    sessionStorage.setItem('ts_chat_peer', peerEmail);

    document.querySelectorAll('[data-peer]').forEach(el => {
      el.classList.toggle('active', el.dataset.peer === peerEmail);
    });

    const [c1, c2] = avatarColor(peerEmail);
    const avatarEl = document.getElementById('chat-peer-avatar');
    if (avatarEl) avatarEl.innerHTML = makeAvatarHtml(peerEmail, 36);
    document.getElementById('chat-peer-name').textContent = peerEmail;
    document.getElementById('chat-peer-sub').textContent  = 'Discussion privee';

    const msgEl = document.getElementById('chat-view-messages');
    msgEl.innerHTML = '<div class="chat-msg-loading"><svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>';
    document.getElementById('chat-view-empty').style.display = 'none';
    document.getElementById('chat-active').style.display     = 'flex';

    // Mobile : masquer la liste, afficher les messages
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      const listPanel = document.getElementById('chat-list-panel');
      const viewPanel = document.getElementById('chat-view-panel');
      if (listPanel) {
        listPanel.style.display = 'none';
      }
      if (viewPanel) {
        viewPanel.style.cssText = 'display:flex!important;flex-direction:column;position:fixed;inset:52px 0 0 0;z-index:300;background:var(--bg-panel);';
      }
      const backBtn = document.getElementById('chat-back-btn');
      if (backBtn) backBtn.style.display = 'flex';
    }

    const socket = App.state.socket;
    if (socket && socket.connected) {
      socket.emit('chat_join', { myEmail, peerEmail });
    } else if (socket) {
      socket.once('connect', () => socket.emit('chat_join', { myEmail, peerEmail }));
    }

    try {
      console.log('[Chat] Chargement historique pour :', peerEmail);
      const res = await App.apiGet(`/api/chat/history/${encodeURIComponent(peerEmail)}`);
      console.log('[Chat] Reponse API :', res);
      msgEl.innerHTML = '';
      if (res.ok && res.messages && res.messages.length > 0) {
        console.log('[Chat] Messages charges :', res.messages.length, res.messages);
        res.messages.forEach(msg => appendMessage(msg, false));
      } else {
        console.warn('[Chat] Aucun message ou erreur API :', res);
        msgEl.innerHTML = '';
      }
    } catch(e) {
      console.error('[Chat] Erreur chargement historique :', e);
      msgEl.innerHTML = '';
    }

    scrollToBottom();
    setTimeout(() => document.getElementById('chat-input')?.focus(), 100);

    // Typing indicator : écouter les frappes
    const inputEl = document.getElementById('chat-input');
    if (inputEl) {
      inputEl.oninput = () => {
        const socket = App.state.socket;
        if (socket?.connected) socket.emit('chat_typing', { myEmail, peerEmail, typing: true });
        clearTimeout(inputEl._typingTimer);
        inputEl._typingTimer = setTimeout(() => {
          if (socket?.connected) socket.emit('chat_typing', { myEmail, peerEmail, typing: false });
        }, 2000);
      };
    }

    const conv = allConvs.find(c => c.peer_email === peerEmail);
    if (conv) conv.unread_count = 0;
    updateChatBadge();
    renderSidebarConvs(allConvs);
    renderMainConvs(allConvs);
  }

  /* Modale nouvelle conversation */
  function promptNew() {
    openNewConvModal();
  }

  function openNewConvModal() {
    let modal = document.getElementById('modal-new-conv');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-new-conv';
      modal.className = 'modal-overlay';
      modal.style.display = 'none';
      modal.onclick = (e) => { if (e.target === modal) closeNewConvModal(); };
      modal.innerHTML = `
        <div class="modal-card" onclick="event.stopPropagation()" style="max-width:420px;">
          <div class="modal-header">
            <span class="modal-title">Nouvelle conversation</span>
            <button class="icon-btn-sm" onclick="ChatUI.closeNewConvModal()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div id="new-conv-error" class="modal-error" style="display:none;"></div>

            <div class="field-group">
              <label class="field-label">Nom d'utilisateur</label>
              <input type="text" id="new-conv-username" class="modal-inp" placeholder="prenom.nom" autocomplete="off"/>
            </div>

            <div class="field-group" style="margin-top:12px;">
              <label class="field-label">Domaine</label>
              <div class="new-conv-domain-wrap">
                <div class="split-at">@</div>
                <select id="new-conv-domain-select" class="new-conv-select" onchange="ChatUI.onDomainSelectChange()">
                  <option value="netiify.cloud">netiify.cloud</option>
                  <option value="custom">Autre domaine...</option>
                </select>
              </div>
            </div>

            <div class="field-group" id="new-conv-custom-domain-wrap" style="display:none;margin-top:12px;">
              <label class="field-label">Domaine personnalise</label>
              <input type="text" id="new-conv-custom-domain" class="modal-inp" placeholder="exemple.com" autocomplete="off"/>
            </div>

            <div class="new-conv-preview" id="new-conv-preview" style="display:none;">
              <span id="new-conv-preview-text"></span>
            </div>

            <button class="btn-modal-submit" onclick="ChatUI.submitNewConv()" style="margin-top:18px;">
              Ouvrir la conversation
            </button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      document.getElementById('new-conv-username').addEventListener('input', updateNewConvPreview);
      document.getElementById('new-conv-custom-domain')?.addEventListener('input', updateNewConvPreview);
    }
    document.getElementById('new-conv-username').value = '';
    document.getElementById('new-conv-domain-select').value = 'netiify.cloud';
    document.getElementById('new-conv-custom-domain-wrap').style.display = 'none';
    document.getElementById('new-conv-preview').style.display = 'none';
    document.getElementById('new-conv-error').style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('new-conv-username')?.focus(), 80);
  }

  function closeNewConvModal() {
    const modal = document.getElementById('modal-new-conv');
    if (modal) modal.style.display = 'none';
  }

  function onDomainSelectChange() {
    const sel  = document.getElementById('new-conv-domain-select');
    const wrap = document.getElementById('new-conv-custom-domain-wrap');
    if (sel.value === 'custom') {
      wrap.style.display = 'block';
      document.getElementById('new-conv-custom-domain').focus();
    } else {
      wrap.style.display = 'none';
    }
    updateNewConvPreview();
  }

  function updateNewConvPreview() {
    const username = (document.getElementById('new-conv-username')?.value || '').trim();
    const sel      = document.getElementById('new-conv-domain-select')?.value;
    const domain   = sel === 'custom'
      ? (document.getElementById('new-conv-custom-domain')?.value || '').trim()
      : sel;
    const preview  = document.getElementById('new-conv-preview');
    const previewText = document.getElementById('new-conv-preview-text');
    if (username && domain && domain !== 'custom') {
      const email = `${username}@${domain}`;
      previewText.textContent = email;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  function submitNewConv() {
    const username = (document.getElementById('new-conv-username')?.value || '').trim();
    const sel      = document.getElementById('new-conv-domain-select')?.value;
    const domain   = sel === 'custom'
      ? (document.getElementById('new-conv-custom-domain')?.value || '').trim()
      : sel;
    const errEl    = document.getElementById('new-conv-error');

    if (!username) {
      errEl.textContent = 'Entrez un nom d\'utilisateur';
      errEl.style.display = 'block'; return;
    }
    if (!domain || domain === 'custom') {
      errEl.textContent = 'Entrez un domaine valide';
      errEl.style.display = 'block'; return;
    }

    const email = `${username}@${domain}`;
    if (!email.includes('@') || !email.includes('.')) {
      errEl.textContent = 'Adresse email invalide';
      errEl.style.display = 'block'; return;
    }

    closeNewConvModal();
    if (!allConvs.find(c => c.peer_email === email)) {
      allConvs.unshift({ peer_email: email, room: '', last_msg: null, last_at: new Date().toISOString(), unread_count: 0 });
      renderSidebarConvs(allConvs);
      renderMainConvs(allConvs);
    }
    showChatMode();
    openConversation(email);
  }

  /* Envoi texte */
  function send() {
    if (pendingFiles.length) { sendFile(); return; }
    const input   = document.getElementById('chat-input');
    const content = (input?.value || '').trim();
    if (!content || !currentPeer) return;
    const socket = App.state.socket;
    if (!socket || !socket.connected) { App.toast('Connexion perdue, reconnexion...', 'warning'); return; }
    socket.emit('chat_send', { myEmail, peerEmail: currentPeer, content, mediaType: 'text', replyToId: replyTo?.id || null });
    input.value = '';
    input.style.height = 'auto';
    replyTo = null;
    cancelReply();
    playSound('send');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  /* ── Icône par type de fichier ─────────────────────── */
  function fileIcon(mime, name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const isPdf  = mime === 'application/pdf' || ext === 'pdf';
    const isWord = mime.includes('word') || ['doc','docx'].includes(ext);
    const isXls  = mime.includes('excel') || mime.includes('spreadsheet') || ['xls','xlsx'].includes(ext);
    const isPpt  = mime.includes('powerpoint') || mime.includes('presentation') || ['ppt','pptx'].includes(ext);
    const isZip  = mime.includes('zip') || mime.includes('rar') || ['zip','rar','7z','tar','gz'].includes(ext);
    const isAudio= mime.startsWith('audio/');
    const isVid  = mime.startsWith('video/');
    const isTxt  = mime.startsWith('text/') || ['txt','md','csv','json','xml'].includes(ext);

    if (isPdf)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`, color: '#ef4444', label: 'PDF' };
    if (isWord)  return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l2 4 2-3 2 3 2-4"/></svg>`, color: '#2563eb', label: 'DOC' };
    if (isXls)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="11" x2="12" y2="19"/></svg>`, color: '#16a34a', label: 'XLS' };
    if (isPpt)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/></svg>`, color: '#ea580c', label: 'PPT' };
    if (isZip)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`, color: '#7c3aed', label: 'ZIP' };
    if (isAudio) return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`, color: '#0891b2', label: 'AUD' };
    if (isVid)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`, color: '#db2777', label: 'VID' };
    if (isTxt)   return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`, color: '#64748b', label: 'TXT' };
    return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`, color: '#94a3b8', label: ext.toUpperCase() || 'FILE' };
  }

  function shortName(name, maxChars) {
    maxChars = maxChars || 16;
    if (!name) return 'fichier';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext  = dot > 0 ? name.slice(dot) : '';
    if (base.length <= maxChars) return name;
    return base.slice(0, maxChars) + '…' + ext;
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' Mo';
    return Math.round(bytes / 1024) + ' Ko';
  }

  /* ── Répondre à un message ──────────────────────── */
  function setReply(msgId, sender, text) {
    replyTo = { id: msgId, sender, text };
    let bar = document.getElementById('chat-reply-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'chat-reply-bar';
      bar.className = 'chat-reply-bar';
      const inputArea = document.querySelector('.chat-view-input-area');
      if (inputArea) inputArea.parentNode.insertBefore(bar, inputArea);
    }
    bar.innerHTML = `
      <div class="chat-reply-bar-inner">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        <div class="chat-reply-bar-text">
          <span class="chat-reply-bar-name">${escHtml(sender)}</span>
          <span class="chat-reply-bar-msg">${escHtml((text || '').slice(0, 80))}</span>
        </div>
        <button class="chat-preview-cancel" onclick="ChatUI.cancelReply()">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    bar.style.display = 'block';
    document.getElementById('chat-input')?.focus();
  }

  function cancelReply() {
    replyTo = null;
    const bar = document.getElementById('chat-reply-bar');
    if (bar) bar.style.display = 'none';
  }

  /* ── Gestion multi-fichiers ─────────────────────── */
  function triggerFile() {
    document.getElementById('chat-file-input').click();
  }

  function onFileSelected(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const tooBig = files.filter(f => f.size > 15 * 1024 * 1024);
    if (tooBig.length) { App.toast(`${tooBig.length} fichier(s) trop grand(s) (max 15 Mo)`, 'warning'); }
    const ok = files.filter(f => f.size <= 15 * 1024 * 1024);
    if (!ok.length) { input.value = ''; return; }
    pendingFiles = pendingFiles.concat(ok);
    renderFilePreview();
    input.value = '';
    document.getElementById('chat-input')?.focus();
  }

  function renderFilePreview() {
    let bar = document.getElementById('chat-file-preview');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'chat-file-preview';
      bar.className = 'chat-files-preview-bar';
      const inputArea = document.querySelector('.chat-view-input-area');
      if (inputArea) inputArea.parentNode.insertBefore(bar, inputArea);
    }
    if (!pendingFiles.length) { bar.style.display = 'none'; return; }

    // Styles inline pour garantir le rendu horizontal indépendamment du cache CSS
    bar.style.cssText = 'display:flex;flex-direction:row;padding:6px 12px 4px;overflow-x:auto;overflow-y:visible;flex-shrink:0;scrollbar-width:none;gap:0;background:var(--bg-panel);';
    bar.innerHTML = `<div style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:5px;align-items:center;padding-top:6px;">${pendingFiles.map((f, i) => {
      const icon = fileIcon(f.type, f.name);
      return `<div style="position:relative;display:inline-flex;flex-direction:row;align-items:center;gap:5px;background:var(--bg-card);border:1px solid var(--border);border-radius:7px;padding:3px 8px 3px 5px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.2);">
        <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:${icon.color};flex-shrink:0;">
          ${icon.svg.replace('viewBox', 'width="14" height="14" viewBox')}
        </div>
        <span style="font-size:10px;font-weight:600;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;" title="${escHtml(f.name)}">${escHtml(shortName(f.name, 12))}</span>
        <span style="font-size:9px;color:var(--text-muted);white-space:nowrap;font-family:monospace;">${fmtSize(f.size)}</span>
        <button onclick="ChatUI.removeFile(${i})" title="Retirer" style="position:absolute;top:-6px;left:-6px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;padding:0;z-index:1;">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('')}</div>`;
  }

  function removeFile(idx) {
    pendingFiles.splice(idx, 1);
    renderFilePreview();
  }

  function cancelFile() {
    pendingFiles = [];
    replyTo = null;
    const bar = document.getElementById('chat-file-preview');
    if (bar) bar.style.display = 'none';
    const rbar = document.getElementById('chat-reply-bar');
    if (rbar) rbar.style.display = 'none';
  }

  function sendFile() {
    if (!pendingFiles.length || !currentPeer) return;
    const socket = App.state.socket;
    if (!socket || !socket.connected) { App.toast('Connexion perdue, reconnexion...', 'warning'); return; }
    const caption = (document.getElementById('chat-input')?.value || '').trim() || null;
    const files   = [...pendingFiles];

    // Envoyer chaque fichier un par un (le caption va sur le dernier)
    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64  = e.target.result.split(',')[1];
        const isImage = file.type.startsWith('image/');
        socket.emit('chat_send', {
          myEmail, peerEmail: currentPeer,
          content:   idx === files.length - 1 ? caption : null,
          mediaType: isImage ? 'image' : 'file',
          mediaName: file.name,
          mediaMime: file.type,
          mediaSize: file.size,
          mediaData: base64,
          replyToId: replyTo?.id || null,
        });
      };
      reader.readAsDataURL(file);
    });

    playSound('send');
    pendingFiles = [];
    replyTo = null;
    renderFilePreview();
    cancelReply();
    const input = document.getElementById('chat-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
  }

  /* Reception socket */
  function onMessage({ room, message, peer }) {
    const isMine   = message.sender === myEmail;
    const convPeer = isMine ? peer : message.sender;

    if (!isMine) playSound('notif');

    // Mettre à jour la liste des conversations en mémoire
    const snippet = message.content || message.media_name || 'Fichier';
    const idx = allConvs.findIndex(c => c.peer_email === convPeer);
    if (idx >= 0) {
      allConvs[idx].last_msg = snippet;
      allConvs[idx].last_at  = message.created_at;
      if (!isMine && convPeer !== currentPeer) {
        allConvs[idx].unread_count = (allConvs[idx].unread_count || 0) + 1;
      }
      const [c] = allConvs.splice(idx, 1);
      allConvs.unshift(c);
    } else if (!isMine) {
      allConvs.unshift({
        peer_email:   message.sender,
        room,
        last_msg:     snippet,
        last_at:      message.created_at,
        unread_count: 1,
      });
    }

    // Si la conversation est actuellement ouverte -> ajouter le message
    if (currentPeer === convPeer) {
      const empty = document.querySelector('.chat-empty-state');
      if (empty) empty.remove();
      appendMessage(message, true);
    } else if (!isMine) {
      // Toast cliquable pour ouvrir directement la conversation
      App.toast(`${message.sender}: ${snippet.slice(0, 60)}`, 'info');
    }

    updateChatBadge();
    renderSidebarConvs(allConvs);
    renderMainConvs(allConvs);
  }

  /* Afficher un message */
  function appendMessage(msg, animate) {
    const isMine    = msg.sender === myEmail;
    const container = document.getElementById('chat-view-messages');
    if (!container) return;
    const loader = container.querySelector('.chat-msg-loading');
    if (loader) loader.remove();

    const el = document.createElement('div');
    el.className = `chat-msg-wrap ${isMine ? 'mine' : 'peer'}${animate ? ' new' : ''}`;
    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '';

    let bubbleContent = '';
    const hasMedia  = (msg.has_media === 1 || msg.has_media === true) && msg.media_path;
    const mediaUrl  = msg.media_path || null;

    // Bloc reply (citation)
    let replyBlock = '';
    if (msg.reply_to_content || msg.reply_to_sender) {
      replyBlock = `<div class="chat-reply-quote">
        <span class="chat-reply-quote-name">${escHtml(msg.reply_to_sender || '')}</span>
        <span class="chat-reply-quote-text">${escHtml((msg.reply_to_content || '').slice(0, 80))}</span>
      </div>`;
    }

    if (msg.media_type === 'image' && hasMedia) {
      bubbleContent = replyBlock + `<img class="chat-img" src="${escHtml(mediaUrl)}" alt="${escHtml(msg.media_name || 'image')}" onclick="ChatUI.previewImg(this.src)" loading="lazy"/>`;
      if (msg.content) bubbleContent += `<div class="chat-caption">${escHtml(msg.content)}</div>`;
    } else if (msg.media_type === 'file' && hasMedia) {
      const icon = fileIcon(msg.media_mime || '', msg.media_name || '');
      const displayName = shortName(msg.media_name || 'Fichier', 22);
      const size = fmtSize(msg.media_size);
      bubbleContent = replyBlock + `
        <div class="chat-file-card">
          <div class="chat-file-card-icon" style="color:${icon.color};background:${icon.color}18">
            ${icon.svg}
            <span class="chat-file-ext-badge" style="background:${icon.color}">${icon.label}</span>
          </div>
          <div class="chat-file-card-info">
            <span class="chat-file-card-name" title="${escHtml(msg.media_name || '')}">${escHtml(displayName)}</span>
            ${size ? `<span class="chat-file-card-size">${size}</span>` : ''}
          </div>
          <a href="${escHtml(mediaUrl)}" download="${escHtml(msg.media_name || 'file')}" class="chat-file-card-dl" title="Télécharger">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        </div>`;
      if (msg.content) bubbleContent += `<div class="chat-caption">${escHtml(msg.content)}</div>`;
    } else {
      bubbleContent = replyBlock + escHtml(msg.content || '');
    }

    const replySnippet = msg.media_name || (msg.content || '').slice(0, 60);
    const replyBtn = msg.deleted_at ? '' : `<button class="chat-reply-btn" onclick="ChatUI.setReply(${msg.id},'${escHtml(msg.sender)}','${escHtml(replySnippet).replace(/'/g,"\'")}')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
    </button>`;

    const deleteBtn = (isMine && !msg.deleted_at) ? `<button class="chat-delete-btn" onclick="ChatUI.deleteMsg(${msg.id})" title="Supprimer">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
    </button>` : '';

    // Réactions existantes
    const reactionsHtml = renderReactions(msg.reactions || {}, msg.id);

    // Statut lu (double coche pour messages envoyés)
    const statusHtml = isMine && !msg.deleted_at ? `<span class="chat-msg-status" data-msgid="${msg.id}">
      <svg width="13" height="8" viewBox="0 0 16 10" fill="none">
        <path d="M1 5l3 3 5-7" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 5l3 3 5-7" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>` : '';

    if (!isMine) {
      el.innerHTML = `
        <div class="chat-bubble-wrap">
          <div class="chat-bubble">${bubbleContent}</div>
          ${reactionsHtml}
          <div class="chat-msg-meta">${replyBtn}<span class="chat-msg-time">${time}</span></div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="chat-bubble-wrap">
          <div class="chat-bubble">${bubbleContent}</div>
          ${reactionsHtml}
          <div class="chat-msg-meta">${deleteBtn}${replyBtn}<span class="chat-msg-time">${time}</span>${statusHtml}</div>
        </div>`;
    }



    container.appendChild(el);
    if (animate) scrollToBottom();
  }

  function scrollToBottom() {
    const el = document.getElementById('chat-view-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderReactions(reactions, msgId) {
    if (!reactions || !Object.keys(reactions).length) return '';
    const items = Object.entries(reactions).map(([emoji, senders]) => {
      const mine = senders.includes(myEmail);
      return `<button class="chat-react-chip ${mine ? 'mine' : ''}" onclick="ChatUI.toggleReact(${msgId},null,'${emoji}')">
        ${emoji} <span>${senders.length}</span>
      </button>`;
    }).join('');
    return `<div class="chat-reactions">${items}</div>`;
  }

  function toggleReact(msgId, peerEmail, emoji) {
    const socket = App.state.socket;
    if (!socket?.connected) return;
    const peer = peerEmail || currentPeer;
    // Une seule réaction par user : retirer toutes les autres d'abord
    const myChips = document.querySelectorAll(`.chat-react-chip.mine`);
    myChips.forEach(chip => {
      const match = chip.getAttribute('onclick')?.match(/toggleReact\((\d+)/);
      if (match && parseInt(match[1]) === parseInt(msgId)) {
        const chipEmoji = chip.textContent.trim().split(' ')[0];
        if (chipEmoji !== emoji) {
          socket.emit('chat_unreact', { myEmail, peerEmail: peer, msgId, emoji: chipEmoji });
        }
      }
    });
    // Basculer la réaction choisie
    const hasThis = [...myChips].some(c => {
      const m = c.getAttribute('onclick')?.match(/toggleReact\((\d+)/);
      return m && parseInt(m[1]) === parseInt(msgId) && c.textContent.trim().startsWith(emoji);
    });
    if (hasThis) socket.emit('chat_unreact', { myEmail, peerEmail: peer, msgId, emoji });
    else         socket.emit('chat_react',   { myEmail, peerEmail: peer, msgId, emoji });
  }

  function deleteMsg(msgId) {
    ConfirmModal.show({
      title: 'Supprimer ce message ?',
      body:  'Le message sera supprimé pour tout le monde.',
      danger: true,
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    }).then(ok => {
      if (!ok) return;
      const socket = App.state.socket;
      if (!socket?.connected) return;
      socket.emit('chat_delete', { myEmail, peerEmail: currentPeer, msgId });
    });
  }

  function onReaction({ msgId, reactions }) {
    // Mettre à jour les réactions sur le message
    const bubbleWrap = document.querySelector(`.chat-msg-wrap [onclick*="deleteMsg(${msgId})"]`)
      ?.closest('.chat-bubble-wrap')
      || document.querySelector(`.chat-msg-wrap .chat-msg-meta`)
      ?.closest('.chat-msg-wrap')
      ?.querySelector('.chat-bubble-wrap');

    // Approche simple : re-render la zone réactions
    document.querySelectorAll(`.chat-react-chip`).forEach(chip => {
      if (chip.getAttribute('onclick')?.includes(String(msgId))) {
        const parent = chip.closest('.chat-reactions');
        if (parent) parent.outerHTML = renderReactions(reactions, msgId);
      }
    });
    // Si pas de réactions existantes, trouver le bon message et insérer
    if (Object.keys(reactions).length === 0) return;
    document.querySelectorAll('.chat-msg-wrap').forEach(wrap => {
      const meta = wrap.querySelector('.chat-msg-meta');
      if (!meta) return;
      const btns = wrap.querySelectorAll('button');
      btns.forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(`${msgId}`)) {
          const bw = wrap.querySelector('.chat-bubble-wrap');
          if (bw && !bw.querySelector('.chat-reactions')) {
            const bubble = bw.querySelector('.chat-bubble');
            if (bubble) bubble.insertAdjacentHTML('afterend', renderReactions(reactions, msgId));
          }
        }
      });
    });
  }

  function onDeleted({ msgId }) {
    document.querySelectorAll('.chat-msg-wrap').forEach(wrap => {
      const btn = wrap.querySelector(`[onclick*="deleteMsg(${msgId})"]`);
      if (btn) {
        const bubble = wrap.querySelector('.chat-bubble');
        if (bubble) bubble.innerHTML = '<em style="opacity:.5;font-size:12px;">Message supprimé</em>';
        const emojiBar = wrap.querySelector('.chat-emoji-bar');
        if (emojiBar) emojiBar.remove();
        btn.closest('.chat-msg-meta')?.querySelectorAll('.chat-reply-btn,.chat-delete-btn').forEach(b => b.remove());
      }
    });
  }

  /* Preview image plein ecran */
  function previewImg(src) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    overlay.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6);">`;
    overlay.onclick = () => overlay.remove();
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(overlay);
  }

  /* Typing indicator DOM */
  function showTyping(from) {
    let el = document.getElementById('chat-typing-indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chat-typing-indicator';
      el.className = 'chat-typing';
      el.innerHTML = `<span></span><span></span><span></span>`;
      const msgs = document.getElementById('chat-view-messages');
      if (msgs) msgs.appendChild(el);
    }
    el.style.display = 'flex';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
    scrollToBottom();
  }

  /* Bind socket */
  function bindSocket(socket) {
    socket.on('chat_message', onMessage);
    socket.on('chat_typing', ({ from, typing }) => {
      if (from !== currentPeer) return;
      if (typing) showTyping(from);
      else {
        const el = document.getElementById('chat-typing-indicator');
        if (el) el.style.display = 'none';
      }
    });
    socket.on('chat_reaction', onReaction);
    socket.on('chat_deleted',  onDeleted);
  }

  /* Helpers */
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function fmtDate(d) {
    if (!d) return '';
    const diff = Date.now() - d;
    if (diff < 86400000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  return {
    init, loadConversations, filterConvs, searchMessages,
    openConversation, promptNew, openNewConvModal, closeNewConvModal,
    onDomainSelectChange, submitNewConv,
    showChatMode, showMailMode, goBackToList,
    send, onKeyDown, triggerFile, onFileSelected, cancelFile, removeFile,
    setReply, cancelReply,
    toggleReact, deleteMsg,
    previewImg, bindSocket,
  };
})();
