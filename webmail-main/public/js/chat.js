/**
 * public/js/chat.js
 * Chat temps réel — zone inline dans la sidebar
 * Le destinataire reçoit les messages même s'il n'a pas ouvert la conversation
 * grâce au join automatique de toutes ses rooms au démarrage.
 */

const Chat = (() => {
  let myEmail   = null;
  let peerEmail = null;

  /* ─── Init ──────────────────────────────────────── */
  function init(email) {
    myEmail = email;
    loadContacts();
  }

  /* ─── Contacts ──────────────────────────────────── */
  async function loadContacts() {
    const res  = await App.apiGet('/api/chat/contacts');
    const list = document.getElementById('chat-contacts-list');
    if (!list) return;

    const contacts = (res.ok && res.contacts) ? res.contacts : [];

    if (contacts.length === 0) {
      list.innerHTML = `<div class="sb-contacts-empty">Aucun contact connu.<br>Tapez un email ci-dessous.</div>`;
      return;
    }

    list.innerHTML = contacts.map(email => `
      <div class="chat-contact-item" onclick="Chat.openWith('${esc(email)}')">
        <div class="chat-contact-avatar">${email[0].toUpperCase()}</div>
        <div class="chat-contact-info">
          <span class="chat-contact-email">${esc(email)}</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`).join('');
  }

  /* ─── Ouvrir une discussion ─────────────────────── */
  function openWith(email) {
    peerEmail = email;

    // Remplir le header
    const avatarEl = document.getElementById('sb-chat-peer-avatar');
    const nameEl   = document.getElementById('sb-chat-peer-name');
    if (avatarEl) avatarEl.textContent = email[0].toUpperCase();
    if (nameEl)   nameEl.textContent   = email;

    // Vider les messages et afficher le loading
    const msgs = document.getElementById('sb-chat-messages');
    if (msgs) {
      msgs.innerHTML = '';
      const loader = document.createElement('div');
      loader.id = 'sb-chat-loading';
      loader.className = 'sb-chat-loading';
      loader.innerHTML = '<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      msgs.appendChild(loader);
    }

    // Basculer vers la vue discussion
    document.getElementById('sb-contacts-view').style.display = 'none';
    document.getElementById('sb-chat-view').style.display     = 'flex';

    // Rejoindre la room
    App.state.socket.emit('chat_join', { myEmail, peerEmail: email });

    // Focus
    setTimeout(() => document.getElementById('sb-chat-input')?.focus(), 100);
  }

  function startWithEmail(email) {
    if (!email || !email.includes('@')) { App.toast('Email invalide', 'warning'); return; }
    document.getElementById('chat-new-email').value = '';
    openWith(email);
  }

  /* ─── Retour aux contacts ───────────────────────── */
  function backToContacts() {
    if (peerEmail) {
      App.state.socket.emit('chat_leave', { myEmail, peerEmail });
      peerEmail = null;
    }
    document.getElementById('sb-chat-view').style.display     = 'none';
    document.getElementById('sb-contacts-view').style.display = 'flex';
  }

  /* ─── Envoi ─────────────────────────────────────── */
  function send() {
    const input   = document.getElementById('sb-chat-input');
    const content = (input?.value || '').trim();
    if (!content || !peerEmail) return;
    App.state.socket.emit('chat_send', { myEmail, peerEmail, content });
    input.value = '';
    input.style.height = 'auto';
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  /* ─── Réception historique ──────────────────────── */
  function onHistory({ messages }) {
    const loader = document.getElementById('sb-chat-loading');
    if (loader) loader.remove();

    const container = document.getElementById('sb-chat-messages');
    if (!container) return;

    if (!messages || messages.length === 0) {
      container.innerHTML = `<div class="sb-chat-empty">Démarrez la conversation !</div>`;
    } else {
      messages.forEach(msg => appendMessage(msg, false));
    }
    scrollToBottom();
  }

  /* ─── Réception d'un nouveau message ───────────────
   *  Appelé pour TOUS les messages dans la room,
   *  que le panel soit ouvert ou non.
   *  → Le destinataire reçoit toujours le message.
   ─────────────────────────────────────────────────── */
  function onMessage({ message }) {
    const isMine     = message.sender === myEmail;
    const panelOpen  = document.getElementById('sb-panel-chat')?.style.display !== 'none';
    const chatOpen   = document.getElementById('sb-chat-view')?.style.display  !== 'none';
    const sameConv   = message.sender === peerEmail || (isMine && message.sender === myEmail);

    // Si la conversation est affichée → insérer le message
    if (panelOpen && chatOpen && sameConv) {
      const empty = document.querySelector('#sb-chat-messages .sb-chat-empty');
      if (empty) empty.remove();
      appendMessage(message, true);
    } else {
      // Sinon → notification toast + badge
      if (!isMine) {
        App.playSound('notif');
        App.toast(`💬 ${message.sender}: ${message.content.slice(0, 50)}`, 'info');
        const dot = document.getElementById('chat-notif-dot');
        if (dot) dot.style.display = 'block';
      }
    }
  }

  function appendMessage(msg, animate) {
    const isMine = msg.sender === myEmail;
    const time   = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    const el     = document.createElement('div');
    el.className = `sb-chat-msg ${isMine ? 'sb-chat-msg-mine' : 'sb-chat-msg-peer'}${animate ? ' sb-chat-msg-new' : ''}`;
    el.innerHTML = `<div class="sb-chat-bubble">${escHtml(msg.content)}</div><div class="sb-chat-time">${time}</div>`;
    const container = document.getElementById('sb-chat-messages');
    if (container) { container.appendChild(el); if (animate) scrollToBottom(); }
  }

  function scrollToBottom() {
    const el = document.getElementById('sb-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function esc(s)      { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escHtml(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

  /* ─── Bind socket ───────────────────────────────── */
  function bindSocket(socket) {
    socket.on('chat_history', onHistory);
    socket.on('chat_message', onMessage);
    socket.on('chat_error',   ({ error }) => App.toast(error, 'error'));
  }

  return { init, loadContacts, openWith, startWithEmail, backToContacts, send, onKeyDown, bindSocket };
})();
