/**
 * public/js/ai-assistant.js
 * Assistant IA du webmail : conversations persistées + cartes d'action.
 * Une carte est une PROPOSITION de l'IA (e-mail, événement, contact, réunion, recherche) que
 * l'utilisateur vérifie, modifie puis confirme : l'IA n'exécute jamais rien toute seule.
 * Les confirmations appellent les API existantes (/api/send, /api/schedule, /api/calendar/events,
 * /api/contacts, /api/meetings, /api/search).
 */
const AIAssistant = (() => {
  const SVG = (inner, s = 15) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICON = {
    spark:  SVG('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/>'),
    mail:   SVG('<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
    clock:  SVG('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    cal:    SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    user:   SVG('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    video:  SVG('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
    search: SVG('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    check:  SVG('<polyline points="20 6 9 17 4 12"/>'),
    x:      SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    send:   SVG('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', 14),
    trash:  SVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>', 13),
    edit:   SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>', 13),
    arrow:  SVG('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', 14),
  };

  const AI_NOTICE = "Pour répondre, l'assistant envoie vos demandes, les extraits d'e-mails ou d'agenda concernés et le contenu des réunions à notre fournisseur d'IA (OpenRouter). Rien n'est exécuté sans votre confirmation. Vos conversations sont conservées selon la durée choisie dans les préférences.";

  const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Porto-Novo'; } catch (_) { return 'Africa/Porto-Novo'; } };

  let conversations = [];
  let currentId = null;
  let sending = false;
  let contacts = null;           // chargé à la demande pour l'autocomplétion

  // ── Réseau ────────────────────────────────────────────────────────────────
  async function api(method, url, body) {
    try {
      const r = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': App.getCsrfToken() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.status === 401) { location.href = '/login'; return { ok: false, error: 'Non authentifié' }; }
      return await r.json();
    } catch (e) { return { ok: false, error: 'Erreur réseau' }; }
  }

  async function loadContacts() {
    if (contacts) return contacts;
    const res = await api('GET', '/api/contacts');
    contacts = res.ok ? res.contacts.map(c => ({ name: c.name, email: c.email })) : [];
    return contacts;
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  const localToIso = (v) => new Date(v).toISOString();
  const localToMysql = (v) => (v ? v.replace('T', ' ') + ':00' : null);
  const fmtLocal = (v) => { const d = new Date(v); return isNaN(d) ? v : d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); };
  const splitEmails = (s) => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const badEmails = (list) => list.filter(e => !EMAIL_RE.test(e));

  // ── Markdown léger (échappé d'abord : aucun HTML venant de l'IA n'est interprété) ──
  function md(text) {
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let html = '', list = null;
    for (const raw of esc(text).split('\n')) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(raw);
      if (m) {
        const tag = /^\s*\d/.test(raw) ? 'ol' : 'ul';
        if (list !== tag) { if (list) html += `</${list}>`; html += `<${tag}>`; list = tag; }
        html += `<li>${inline(m[1])}</li>`;
      } else {
        if (list) { html += `</${list}>`; list = null; }
        html += raw.trim() === '' ? '<div class="ai-gap"></div>' : `<p>${inline(raw)}</p>`;
      }
    }
    if (list) html += `</${list}>`;
    return html;
  }


  // ── Préférences de l'assistant ────────────────────────────────────────────
  const TONE_OPTS = [['formel', 'Formel et courtois'], ['amical', 'Amical'], ['concis', 'Concis et direct'], ['chaleureux', 'Chaleureux'], ['ferme', 'Ferme mais poli']];
  const LANG_OPTS = [['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['pt', 'Portugais'], ['de', 'Allemand'], ['ar', 'Arabe']];
  const RETENTION_OPTS = [[0, 'Jusqu\'à suppression manuelle'], [7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '1 an']];
  const REMIND_OPTS = [[0, "À l'heure"], [5, '5 minutes avant'], [10, '10 minutes avant'], [15, '15 minutes avant'], [30, '30 minutes avant'], [60, '1 heure avant'], [120, '2 heures avant'], [1440, '1 jour avant']];

  async function openPrefs() {
    $('ai-prefs')?.remove();
    const res = await api('GET', '/api/ai/preferences');
    if (!res.ok) { App.toast(res.error || 'Préférences indisponibles', 'error'); return; }
    const pr = res.preferences;
    const sel = (key, opts, cur) => `<select data-p="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, `${p2(from + i)} h`]);
    const ov = document.createElement('div');
    const opener = document.activeElement;
    ov.className = 'ai-modal'; ov.id = 'ai-prefs';
    ov.innerHTML = `<div class="ai-modal-card" role="dialog" aria-modal="true" aria-label="Préférences de l'assistant">
      <div class="ai-modal-h"><div><div class="ai-modal-t">Préférences de l'assistant</div><div class="ai-modal-s">Appliquées à vos e-mails, rendez-vous et réunions</div></div>
        <button type="button" class="icon-btn" data-a="close" aria-label="Fermer">${ICON.x}</button></div>
      <div class="ai-modal-b">
        <label>Ton par défaut des e-mails${sel('tone', TONE_OPTS, pr.tone)}</label>
        <label>Langue des e-mails${sel('language', LANG_OPTS, pr.language)}</label>
        <label>Formule de politesse / signature<input type="text" data-p="closing" maxlength="200" placeholder="Ex : Cordialement, Aude" value="${esc(pr.closing)}"></label>
        <div class="ai-modal-row">
          <label>Durée d'une réunion${sel('meetingDuration', [15, 30, 45, 60, 90, 120].map(m => [m, m >= 60 ? `${m / 60 === 1 ? '1 heure' : m === 90 ? '1 h 30' : '2 heures'}` : `${m} min`]), pr.meetingDuration)}</label>
          <label>Rappel par défaut${sel('reminderMinutes', REMIND_OPTS, pr.reminderMinutes)}</label>
        </div>
        <div class="ai-modal-row">
          <label>Début de journée${sel('workStart', hours(0, 23), pr.workStart)}</label>
          <label>Fin de journée${sel('workEnd', hours(1, 24), pr.workEnd)}</label>
        </div>
        <label class="ai-modal-chk"><input type="checkbox" data-p="weekends" ${pr.weekends ? 'checked' : ''}> Inclure les week-ends dans les créneaux libres</label>
        <label>Conservation des conversations${sel('retentionDays', RETENTION_OPTS, pr.retentionDays)}</label>
        <div class="ai-modal-note"><b>Confidentialité.</b> ${esc(AI_NOTICE)}</div>
      </div>
      <div class="ai-modal-f"><span class="aic-err" data-role="err"></span>
        <button type="button" class="aic-btn" data-a="close">Annuler</button>
        <button type="button" class="aic-btn primary" data-a="save">${ICON.check}<span>Enregistrer</span></button></div></div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); opener?.focus?.(); };                                    // le focus revient là où il était
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;                                                                // le focus reste prisonnier de la fenêtre
      const f = [...ov.querySelectorAll('select, input, button:not(:disabled)')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    ov.querySelectorAll('[data-a=close]').forEach(b => b.addEventListener('click', close));
    ov.querySelector('[data-a=save]').addEventListener('click', async (e) => {
      const btn = e.currentTarget, err = ov.querySelector('[data-role=err]');
      const read = (k) => ov.querySelector(`[data-p="${k}"]`);
      const body = {
        tone: read('tone').value, language: read('language').value, closing: read('closing').value.trim(),
        meetingDuration: Number(read('meetingDuration').value), reminderMinutes: Number(read('reminderMinutes').value),
        workStart: Number(read('workStart').value), workEnd: Number(read('workEnd').value), weekends: read('weekends').checked,
        retentionDays: Number(read('retentionDays').value),
      };
      if (body.workEnd <= body.workStart) { err.textContent = 'La fin de journée doit être après le début.'; return; }
      btn.disabled = true; err.textContent = '';
      const out = await api('POST', '/api/ai/preferences', body);
      btn.disabled = false;
      if (!out.ok) { err.textContent = out.error || 'Enregistrement impossible.'; return; }
      App.toast('Préférences enregistrées', 'success');
      close();
    });
    ov.querySelector('select')?.focus();
  }

  // ── Bascule d'affichage ───────────────────────────────────────────────────
  function show() {
    ['mode-mail', 'mode-chat', 'mode-tools'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
    $('mode-ai').style.display = 'flex';
    sessionStorage.setItem('ts_mode', 'ai');
    document.querySelectorAll('#folder-list .folder-item.active, .folder-item.active').forEach(el => el.classList.remove('active'));
    $('sb-ai-item')?.classList.add('active');
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    loadConversations().then(() => {
      if (!currentId) renderWelcome();
    });
    setTimeout(() => $('ai-input')?.focus(), 80);
  }

  function toggleSide() { $('ai-side')?.classList.toggle('open'); }

  // ── Liste des conversations ───────────────────────────────────────────────
  async function loadConversations() {
    const res = await api('GET', '/api/ai/conversations');
    conversations = res.ok ? res.conversations : [];
    renderConversationList();
  }

  function renderConversationList() {
    const box = $('ai-conv-list');
    if (!box) return;
    if (!conversations.length) {
      box.innerHTML = '<div class="ai-conv-empty">Aucune conversation pour le moment.<br>Posez votre première question !</div>';
      return;
    }
    box.innerHTML = conversations.map(c => `
      <div class="ai-conv-item${c.id === currentId ? ' active' : ''}" data-id="${esc(c.id)}">
        <button type="button" class="ai-conv-open" aria-current="${c.id === currentId ? 'true' : 'false'}"><span class="ai-conv-title">${esc(c.title)}</span></button>
        <span class="ai-conv-actions">
          <button type="button" class="ren" title="Renommer" aria-label="Renommer">${ICON.edit}</button>
          <button type="button" class="del" title="Supprimer" aria-label="Supprimer">${ICON.trash}</button>
        </span>
      </div>`).join('');
    box.querySelectorAll('.ai-conv-item').forEach(item => {
      const id = item.dataset.id;
      item.querySelector('.ai-conv-open').addEventListener('click', () => openConversation(id));
      item.addEventListener('click', (e) => { if (e.target === item) openConversation(id); });
      item.querySelector('.ren').addEventListener('click', (e) => { e.stopPropagation(); startRename(item, id); });
      item.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); removeConversation(id); });
    });
  }

  function startRename(item, id) {
    const conv = conversations.find(c => c.id === id);
    const titleEl = item.querySelector('.ai-conv-open');
    const input = document.createElement('input');
    input.className = 'ai-conv-title-input';
    input.value = conv?.title || '';
    input.maxLength = 80;
    titleEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = async (save) => {
      if (done) return; done = true;
      const title = input.value.trim();
      if (save && title && title !== conv?.title) {
        const res = await api('POST', `/api/ai/conversations/${id}/rename`, { title });
        if (res.ok && conv) { conv.title = title; if (id === currentId) $('ai-title').textContent = title; }
      }
      renderConversationList();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
  }

  async function removeConversation(id) {
    const ok = await ConfirmModal.show({ title: 'Supprimer la conversation ?', body: 'Cette conversation et ses messages seront définitivement supprimés.', danger: true });
    if (!ok) return;
    const res = await api('DELETE', `/api/ai/conversations/${id}`);
    if (!res.ok) { App.toast(res.error || 'Suppression impossible', 'error'); return; }
    conversations = conversations.filter(c => c.id !== id);
    if (id === currentId) newConversation(); else renderConversationList();
  }

  async function openConversation(id) {
    $('ai-side')?.classList.remove('open');
    if (sending) return;
    const res = await api('GET', `/api/ai/conversations/${id}`);
    if (!res.ok) { App.toast(res.error || 'Conversation introuvable', 'error'); loadConversations(); return; }
    currentId = id;
    $('ai-title').textContent = res.conversation.title || 'Assistant IA';
    $('ai-thread').innerHTML = '';
    res.messages.forEach(addMessage);
    renderConversationList();
    scrollBottom(true);
  }

  function newConversation() {
    if (sending) return;
    currentId = null;
    $('ai-title').textContent = 'Assistant IA';
    $('ai-side')?.classList.remove('open');
    renderConversationList();
    renderWelcome();
    $('ai-input')?.focus();
  }

  // ── Accueil ───────────────────────────────────────────────────────────────
  const TILES = [
    { ico: 'mail',   t: 'Écrire un e-mail',        d: 'Brouillon prêt à envoyer, objet généré',   p: 'Je veux envoyer un e-mail', now: true },
    { ico: 'clock',  t: 'Programmer un envoi',     d: 'Choisissez le jour et l\'heure',            p: 'Rédige un e-mail à ' },
    { ico: 'cal',    t: 'Ajouter un rendez-vous',  d: 'Création dans votre agenda',                p: 'Ajoute à mon agenda : ' },
    { ico: 'cal',    t: 'Mon agenda',              d: 'Ce que vous avez de prévu',                 p: 'Qu\'est-ce que j\'ai de prévu cette semaine ?', now: true },
    { ico: 'user',   t: 'Nouveau contact',         d: 'Enregistrer une personne',                  p: 'Ajoute un contact : ' },
    { ico: 'video',  t: 'Réunion vidéo',           d: 'Démarrer ou programmer',                    p: 'Programme une réunion ' },
    { ico: 'search', t: 'Retrouver des e-mails',   d: 'Recherche en langage naturel',              p: 'Retrouve mes e-mails non lus de la semaine dernière', now: true },
  ];

  function renderWelcome() {
    const thread = $('ai-thread');
    thread.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-welcome-badge">${SVG(ICON.spark.replace(/^<svg[^>]*>|<\/svg>$/g, ''), 26)}</div>
        <h2>Comment puis-je vous aider&nbsp;?</h2>
        <p>Je rédige vos e-mails, remplis votre agenda, ajoute vos contacts et lance vos réunions. Vous vérifiez toujours avant de confirmer.</p>
        <div class="ai-tiles">
          ${TILES.map((t, i) => `<button type="button" class="ai-tile" data-i="${i}"><span class="ai-tile-ico">${ICON[t.ico]}</span><span><div class="ai-tile-t">${esc(t.t)}</div><div class="ai-tile-d">${esc(t.d)}</div></span></button>`).join('')}
        </div>
        <p class="ai-notice"><b>Confidentialité.</b> ${esc(AI_NOTICE)}</p>
      </div>`;
    thread.querySelectorAll('.ai-tile').forEach(btn => btn.addEventListener('click', () => {
      const t = TILES[Number(btn.dataset.i)];
      const inp = $('ai-input'); inp.value = t.p; autoGrow(inp); inp.focus();
      if (t.now) send();
    }));
  }


  // ── Dictée vocale (reconnaissance vocale du navigateur ; rien n'est envoyé au serveur avant « Envoyer ») ──
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null, dictating = false, dictBase = '';

  function setDictationUi(on) {
    dictating = on;
    const btn = $('ai-mic');
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? "Arrêter la dictée" : 'Dicter votre message';
    btn.setAttribute('aria-label', btn.title);
  }

  function toggleDictation() {
    const inp = $('ai-input');
    if (!SpeechRec) { App.toast("La dictée vocale n'est pas disponible dans ce navigateur (essayez Chrome ou Edge).", 'info'); return; }
    if (dictating) { recognizer?.stop(); return; }
    recognizer = new SpeechRec();
    recognizer.lang = (document.documentElement.lang || 'fr') === 'en' ? 'en-US' : 'fr-FR';
    recognizer.interimResults = true;
    recognizer.continuous = true;
    dictBase = inp.value ? inp.value.replace(/\s+$/, '') + ' ' : '';
    recognizer.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      inp.value = (dictBase + text).slice(0, 4000);
      autoGrow(inp);
    };
    recognizer.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') App.toast("L'accès au micro est refusé : autorisez-le dans votre navigateur.", 'error');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') App.toast('Dictée interrompue.', 'info');
    };
    recognizer.onend = () => { setDictationUi(false); inp.focus(); };
    try { recognizer.start(); setDictationUi(true); } catch (_) { setDictationUi(false); }
  }

  // ── Envoi d'un message ────────────────────────────────────────────────────
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
  function scrollBottom(instant) { const s = $('ai-scroll'); if (s) s.scrollTo({ top: s.scrollHeight, behavior: instant ? 'auto' : 'smooth' }); }

  function setSending(v) {
    sending = v;
    const b = $('ai-send'); if (b) b.disabled = v;
  }

  /** Lit la réponse en streaming (une ligne JSON par événement). */
  async function streamChat(body, h) {
    try {
      const r = await fetch('/api/ai/chat/stream', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': App.getCsrfToken() },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { location.href = '/login'; return { ok: false, error: 'Non authentifié' }; }
      if (!r.body || !(r.headers.get('content-type') || '').includes('ndjson')) {
        return await r.json().catch(() => ({ ok: false, error: "L'assistant est indisponible." }));
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '', final = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
          if (ev.t === 'delta') h.onDelta(ev.text);
          else if (ev.t === 'reset') h.onReset();
          else if (ev.t === 'status') h.onStatus(ev.text);
          else if (ev.t === 'done') final = { ok: true, conversation: ev.conversation, message: ev.message };
          else if (ev.t === 'error') final = { ok: false, error: ev.error };
        }
      }
      return final || { ok: false, error: 'Réponse interrompue. Réessayez.' };
    } catch (_) { return { ok: false, error: 'Erreur réseau' }; }
  }

  /** Message assistant « vivant » : texte qui s'écrit, ligne d'état, puis cartes. */
  function startLive() {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg assistant';
    wrap.setAttribute('aria-live', 'off');
    wrap.innerHTML = `<div class="ai-avatar" aria-hidden="true">${ICON.spark}</div><div class="ai-body"><div class="ai-bubble"><div class="ai-status" role="status" hidden></div><div class="ai-live"></div><div class="ai-typing"><span></span><span></span><span></span></div></div><div class="ai-cards"></div></div>`;
    $('ai-thread').appendChild(wrap);
    scrollBottom();
    const live = wrap.querySelector('.ai-live'), status = wrap.querySelector('.ai-status'), typing = wrap.querySelector('.ai-typing');
    return {
      wrap,
      setText(t) { live.innerHTML = md(t); typing.style.display = t ? 'none' : ''; scrollBottom(true); },
      setStatus(t) { status.hidden = !t; status.textContent = t || ''; },
      fail(msg) { wrap.classList.add('error'); status.hidden = true; typing.remove(); live.innerHTML = esc(msg); },
      finish(msg) { wrap.remove(); addMessage(msg); },
    };
  }

  async function send() {
    if (sending) return;
    const inp = $('ai-input');
    const text = inp.value.trim();
    if (!text) return;

    if (dictating) recognizer?.stop();
    if ($('ai-thread').querySelector('.ai-welcome')) $('ai-thread').innerHTML = '';
    addMessage({ role: 'user', content: text });
    inp.value = ''; autoGrow(inp);
    setSending(true);

    const live = startLive();
    let buffer = '';
    const res = await streamChat({ conversationId: currentId, message: text, timeZone: tz() }, {
      onDelta(t) { buffer += t; live.setText(buffer); },
      onReset() { buffer = ''; live.setText(''); },
      onStatus(t) { live.setStatus(t); },
    });
    setSending(false);

    if (!res.ok) { live.fail(res.error || "L'assistant est indisponible pour le moment."); return; }
    currentId = res.conversation.id;
    if (res.conversation.isNew) {
      conversations.unshift({ id: currentId, title: res.conversation.title });
      $('ai-title').textContent = res.conversation.title;
    } else {
      const c = conversations.find(x => x.id === currentId);
      if (c) conversations = [c, ...conversations.filter(x => x !== c)];
    }
    renderConversationList();
    live.finish(res.message);
  }


  // ── Signaler une réponse ratée (relue par l'administrateur pour améliorer les prompts) ──────────────────
  function buildFeedbackTool(messageId) {
    const box = document.createElement('div');
    box.className = 'ai-msg-tools';
    box.innerHTML = `<button type="button" class="ai-fb-btn" aria-expanded="false">${SVG('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9a2 2 0 0 0 2 2.3H10z" transform="rotate(180 12 12)"/>', 13)} Signaler une réponse ratée</button>
      <div class="ai-fb-form" hidden>
        <textarea rows="2" maxlength="500" aria-label="Ce qui n'allait pas (facultatif)" placeholder="Qu'est-ce qui n'allait pas ? (facultatif)"></textarea>
        <div class="ai-fb-note">Votre demande et la réponse de l'IA seront transmises à l'administrateur, conservées 60 jours et servent uniquement à améliorer l'assistant.</div>
        <div class="ai-fb-actions"><span class="aic-err" role="alert"></span><button type="button" class="aic-btn" data-a="cancel">Annuler</button><button type="button" class="aic-btn primary" data-a="send"><span>Envoyer</span></button></div>
      </div>`;
    const btn = box.querySelector('.ai-fb-btn'), form = box.querySelector('.ai-fb-form'), err = box.querySelector('.aic-err');
    const toggle = (open) => { form.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) form.querySelector('textarea').focus(); };
    btn.addEventListener('click', () => toggle(form.hidden));
    form.querySelector('[data-a=cancel]').addEventListener('click', () => { toggle(false); btn.focus(); });
    form.querySelector('[data-a=send]').addEventListener('click', async (e) => {
      const send = e.currentTarget; send.disabled = true; err.textContent = '';
      const res = await api('POST', '/api/ai/feedback', { feature: 'assistant', conversationId: currentId, messageId, note: form.querySelector('textarea').value.trim() });
      send.disabled = false;
      if (!res.ok) { err.textContent = res.error || 'Envoi impossible.'; return; }
      box.innerHTML = `<span class="ai-fb-thanks" role="status">Merci : le signalement a été transmis à l'administrateur.</span>`;
    });
    return box;
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  function addMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ' + msg.role + (msg.error ? ' error' : '');
    if (msg.role === 'user') {
      wrap.innerHTML = `<div class="ai-bubble">${esc(msg.content)}</div>`;
    } else {
      wrap.innerHTML = `<div class="ai-avatar" aria-hidden="true">${ICON.spark}</div><div class="ai-body"><div class="ai-bubble">${md(msg.content)}</div><div class="ai-cards"></div></div>`;
      const box = wrap.querySelector('.ai-cards');
      (msg.cards || []).forEach(card => box.appendChild(renderCard(msg.id, card)));
      if (!(msg.cards || []).length) box.remove();
      if (msg.id && !msg.error) wrap.querySelector('.ai-body').appendChild(buildFeedbackTool(msg.id));
    }
    $('ai-thread').appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  // ── Cartes : rendu ────────────────────────────────────────────────────────
  const CARD_META = {
    email_draft:           { ico: 'mail',   title: "Brouillon d'e-mail",  sub: 'Vérifiez, modifiez, puis envoyez' },
    calendar_event:        { ico: 'cal',    title: "Nouvel événement",     sub: "Il sera ajouté à votre agenda" },
    calendar_event_update: { ico: 'cal',    title: "Modification d'événement", sub: 'Comparez avant d\'appliquer' },
    calendar_event_delete: { ico: 'trash',  title: "Suppression d'événement", sub: 'Confirmation requise' },
    contact:               { ico: 'user',   title: 'Nouveau contact',      sub: 'Ajouté à votre carnet d\'adresses' },
    meeting:               { ico: 'video',  title: 'Réunion vidéo',        sub: 'Démarrez-la ou programmez-la' },
    mail_search:           { ico: 'search', title: "Recherche d'e-mails",  sub: 'Résultats dans votre messagerie' },
  };

  function renderCard(messageId, card) {
    if (card.status && card.status !== 'pending') return renderDone(card, messageId);
    const meta = CARD_META[card.type];
    if (!meta) return document.createElement('div');
    const el = document.createElement('div');
    el.className = 'aic';
    el.dataset.cardId = card.id;
    el.innerHTML = `
      <div class="aic-head"><span class="aic-ico">${ICON[meta.ico]}</span><div><div class="aic-title">${esc(meta.title)}</div><div class="aic-sub">${esc(meta.sub)}</div></div></div>
      ${card.notices?.length ? `<div class="aic-notices">${card.notices.map(n => `<div class="aic-notice">${esc(n)}</div>`).join('')}</div>` : ''}
      <div class="aic-content"></div>`;
    const content = el.querySelector('.aic-content');
    const ctx = { messageId, card, el, content };
    ({ email_draft: buildEmail, calendar_event: buildEvent, calendar_event_update: buildEventUpdate, calendar_event_delete: buildEventDelete,
       contact: buildContact, meeting: buildMeeting, mail_search: buildSearch })[card.type](ctx);
    return el;
  }

  function renderDone(card, messageId) {
    const meta = CARD_META[card.type] || { ico: 'check', title: 'Action' };
    const ok = card.status !== 'dismissed';
    const labels = {
      sent: 'E-mail envoyé', scheduled: 'Envoi programmé', created: 'Ajouté', updated: 'Modification appliquée',
      started: 'Réunion créée', deleted: 'Événement supprimé', dismissed: 'Proposition ignorée',
    };
    const el = document.createElement('div');
    el.className = 'aic aic-done ' + (ok ? 'ok' : 'off');
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="aic-ico" aria-hidden="true">${ok ? ICON.check : ICON.x}</span>
      <div><div class="aic-done-t">${esc(labels[card.status] || meta.title)}</div>
      <div class="aic-done-d">${esc(card.detail || card.subject || card.title || card.name || '')}</div></div>`;
    if (card.link) {
      const actions = document.createElement('div');
      actions.className = 'aic-done-actions';
      actions.innerHTML = `<button type="button" class="aic-btn" data-act="copy">Copier le lien</button><button type="button" class="aic-btn primary" data-act="open">Ouvrir</button>`;
      actions.querySelector('[data-act=copy]').addEventListener('click', () => navigator.clipboard.writeText(card.link).then(() => App.toast('Lien copié', 'success')));
      actions.querySelector('[data-act=open]').addEventListener('click', () => window.open(card.link, '_blank'));
      el.appendChild(actions);
    }
    // Envoi programmé encore annulable : le contenu et le mot de passe chiffrés sont effacés du serveur à l'annulation
    if (card.status === 'scheduled' && card.scheduleId) {
      const actions = document.createElement('div');
      actions.className = 'aic-done-actions';
      actions.innerHTML = `<button type="button" class="aic-btn" data-act="cancel-send">Annuler l'envoi</button>`;
      actions.querySelector('button').addEventListener('click', async (e) => {
        const btn = e.currentTarget;                                                  // à capturer AVANT tout await (vide ensuite)
        const go = await ConfirmModal.show({ title: "Annuler l'envoi programmé ?", body: 'Le message ne sera pas envoyé et son contenu sera effacé du serveur.', danger: true });
        if (!go) return;
        btn.disabled = true;
        const res = await api('DELETE', `/api/schedule/${card.scheduleId}`);
        if (!res.ok) { btn.disabled = false; App.toast(res.error || 'Annulation impossible', 'error'); return; }
        Object.assign(card, { status: 'dismissed', detail: 'Envoi programmé annulé', scheduleId: null });
        if (messageId) api('POST', `/api/ai/messages/${messageId}/cards/${card.id}/state`, { status: 'dismissed', detail: card.detail });
        el.replaceWith(renderDone(card, messageId));
        App.toast('Envoi annulé', 'success');
      });
      el.appendChild(actions);
    }
    return el;
  }

  // Clôture d'une carte : mémorise l'état côté serveur puis affiche le résumé
  async function finish(ctx, status, detail, extra = {}) {
    Object.assign(ctx.card, { status, detail, ...extra });
    api('POST', `/api/ai/messages/${ctx.messageId}/cards/${ctx.card.id}/state`, { status, detail, scheduleId: extra.scheduleId });
    ctx.el.replaceWith(renderDone(ctx.card, ctx.messageId));
  }


  // ── Multipart (pièces jointes) ────────────────────────────────────────────
  async function apiForm(url, form) {
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': App.getCsrfToken() }, body: form });
      if (r.status === 401) { location.href = '/login'; return { ok: false, error: 'Non authentifié' }; }
      return await r.json();
    } catch (_) { return { ok: false, error: 'Erreur réseau' }; }
  }
  const MAX_FILES = 10, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024;
  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko';

  // ── Dates locales (« AAAA-MM-JJTHH:mm ») ──────────────────────────────────
  const p2 = (n) => String(n).padStart(2, '0');
  function addMinLocal(local, min) {
    const d = new Date(new Date(local).getTime() + min * 60000);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  const fmtDay = (v) => new Date(v).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtHour = (v) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtRange = (a, b) => `${fmtDay(a)} ${fmtHour(a)}–${fmtHour(b)}`;

  // ── Agenda : conflits + créneaux libres (affichage et vérification en direct) ──
  function agendaHtml(conflicts, slots) {
    if (!conflicts?.length) return '';
    return `<div class="aic-conflict"><div class="aic-conflict-t">${ICON.clock} Conflit d'horaire</div>
      ${conflicts.map(c => `<div class="aic-conflict-i">• ${esc(c.title)} — ${esc(fmtRange(c.startAt, c.endAt))}</div>`).join('')}
      ${slots?.length ? `<div class="aic-slots"><span>Créneaux libres :</span>${slots.map((sl, i) => `<button type="button" class="aic-chip" data-slot="${i}">${esc(fmtRange(sl.startAt, sl.endAt))}</button>`).join('')}</div>` : ''}</div>`;
  }

  /** Branche la zone [data-role=agenda] d'une carte : rendu initial + revérification quand les dates changent. */
  function bindAgenda(ctx, { get, set, watch = [], excludeId = null }) {
    const zone = ctx.content.querySelector('[data-role=agenda]');
    if (!zone) return;
    let timer = null, slots = ctx.card.slots || [];
    const paint = (conflicts) => {
      zone.innerHTML = agendaHtml(conflicts, slots);
      zone.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { set(slots[Number(b.dataset.slot)]); refresh(); }));
    };
    const refresh = async () => {
      const r = get();
      if (!r.startAt || !r.endAt || new Date(r.endAt) <= new Date(r.startAt)) { zone.innerHTML = ''; return; }
      const res = await api('POST', '/api/ai/agenda/check', { startAt: r.startAt, endAt: r.endAt, timeZone: tz(), excludeId });
      if (!zone.isConnected || !res.ok) return;
      slots = res.slots || [];
      paint(res.conflicts || []);
    };
    paint(ctx.card.conflicts || []);
    watch.forEach(el => el?.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(refresh, 350); }));
  }

  const field = (el, f) => el.querySelector(`[data-f="${f}"]`);
  const val = (el, f) => (field(el, f)?.value || '').trim();
  const footHtml = (label, icon = ICON.check, cls = 'primary') => `
    <div class="aic-foot"><span class="aic-err" data-role="err"></span>
      <button type="button" class="aic-btn" data-act="dismiss">Ignorer</button>
      <button type="button" class="aic-btn ${cls}" data-act="ok">${icon}<span>${esc(label)}</span></button></div>`;
  const setErr = (el, msg) => { const e = el.querySelector('[data-role=err]'); if (e) e.textContent = msg || ''; };
  const busy = (btn, on, label) => { btn.disabled = on; const s = btn.querySelector('span'); if (s && label) s.textContent = label; };

  function bindFoot(ctx, onOk) {
    const { el } = ctx;
    el.querySelector('[data-act=dismiss]').addEventListener('click', () => finish(ctx, 'dismissed', ''));
    const ok = el.querySelector('[data-act=ok]');
    ok.addEventListener('click', async () => {
      setErr(el, '');
      const label = ok.querySelector('span').textContent;
      busy(ok, true, 'Patientez…');
      try { await onOk(ok); } catch (e) { setErr(el, e.message || 'Erreur'); }
      if (ok.isConnected) busy(ok, false, ok.dataset.label || label);
    });
  }

  // ── Autocomplétion des destinataires ──────────────────────────────────────
  function attachContactSuggest(input) {
    let dd = null;
    const close = () => { dd?.remove(); dd = null; };
    input.addEventListener('input', async () => {
      const list = await loadContacts();
      const token = input.value.split(/[,;]/).pop().trim().toLowerCase();
      if (token.length < 1) return close();
      const found = list.filter(c => c.name.toLowerCase().includes(token) || c.email.toLowerCase().includes(token)).slice(0, 6);
      if (!found.length) return close();
      close();
      dd = document.createElement('div');
      dd.className = 'ai-suggest-dd';
      dd.innerHTML = found.map((c, i) => `<button type="button" data-i="${i}"><b>${esc(c.name)}</b><span>${esc(c.email)}</span></button>`).join('');
      dd.querySelectorAll('button').forEach((b, i) => b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const parts = input.value.split(/[,;]/); parts.pop();
        parts.push(' ' + found[i].email);
        input.value = parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
        close(); input.focus();
      }));
      input.parentElement.appendChild(dd);
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  // ── Carte : e-mail ────────────────────────────────────────────────────────
  function buildEmail(ctx) {
    const { card, content } = ctx;
    const hasCc = (card.cc?.length || card.bcc?.length);
    const files = [];
    content.innerHTML = `
      <div class="aic-form">
        ${card.inReplyTo ? `<div class="aic-hint" style="padding:0 0 6px">${ICON.arrow} Réponse à un message de votre boîte — le fil de discussion sera conservé.</div>` : ''}
        <div class="aic-row"><label>À</label><input type="text" data-f="to" autocomplete="off" placeholder="destinataire@exemple.com" value="${esc((card.to || []).join(', '))}"></div>
        <div class="aic-row" data-role="cc" style="${hasCc ? '' : 'display:none'}"><label>Cc</label><input type="text" data-f="cc" autocomplete="off" value="${esc((card.cc || []).join(', '))}"></div>
        <div class="aic-row" data-role="cc" style="${hasCc ? '' : 'display:none'}"><label>Cci</label><input type="text" data-f="bcc" autocomplete="off" value="${esc((card.bcc || []).join(', '))}"></div>
        ${hasCc ? '' : '<button type="button" class="aic-link" data-act="cc">+ Cc / Cci</button>'}
        <div class="aic-row"><label>Objet</label><input type="text" data-f="subject" autocomplete="off" placeholder="Objet du message" value="${esc(card.subject || '')}">
          <button type="button" class="aic-gen" data-act="subject" title="Générer l'objet avec l'IA" aria-label="Générer l'objet avec l'IA">${ICON.spark}</button></div>
        <div class="aic-body-wrap">
          <textarea data-f="body" placeholder="Rédigez votre message…">${esc(card.body || '')}</textarea>
          <div class="aic-tools">
            <button type="button" class="aic-chip" data-mode="correct">Corriger</button>
            <button type="button" class="aic-chip" data-mode="rephrase">Reformuler</button>
            <button type="button" class="aic-chip" data-mode="formal">Plus formel</button>
            <button type="button" class="aic-chip" data-mode="friendly">Plus amical</button>
            <button type="button" class="aic-chip" data-mode="shorten">Raccourcir</button>
            <button type="button" class="aic-chip" data-act="undo" style="display:none">Annuler</button>
          </div>
        </div>
        <div class="aic-files" data-role="files"></div>
        <div class="aic-attach">
          <label class="aic-chip" style="cursor:pointer">${SVG('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', 13)} Joindre des fichiers<input type="file" multiple data-f="files" hidden></label>
          <span class="aic-hint">${MAX_FILES} fichiers max · 10 Mo chacun · 20 Mo au total</span>
        </div>
        <div class="aic-schedule">
          <label class="aic-switch"><input type="checkbox" data-f="schedule" ${card.sendAt ? 'checked' : ''}> Programmer l'envoi</label>
          <input type="datetime-local" data-f="sendAt" value="${esc(card.sendAt || '')}" style="${card.sendAt ? '' : 'display:none'}">
        </div>
      </div>
      ${footHtml(card.sendAt ? 'Programmer' : 'Envoyer', ICON.send)}`;

    content.querySelectorAll('input[data-f=to],input[data-f=cc],input[data-f=bcc]').forEach(attachContactSuggest);
    content.querySelector('[data-act=cc]')?.addEventListener('click', (e) => {
      content.querySelectorAll('[data-role=cc]').forEach(r => r.style.display = '');
      e.currentTarget.remove();
    });

    // Pièces jointes
    const list = content.querySelector('[data-role=files]');
    const paintFiles = () => {
      list.innerHTML = files.map((f, i) => `<span class="aic-file"><span class="aic-file-n">${esc(f.name)}</span><span class="aic-file-s">${fmtSize(f.size)}</span><button type="button" data-rm="${i}" aria-label="Retirer ${esc(f.name)}">${ICON.x}</button></span>`).join('');
      list.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { files.splice(Number(b.dataset.rm), 1); paintFiles(); }));
    };
    field(content, 'files').addEventListener('change', (e) => {
      setErr(content, '');
      for (const f of e.target.files) {
        const total = files.reduce((n, x) => n + x.size, 0) + f.size;
        if (files.length >= MAX_FILES) { setErr(content, `Maximum ${MAX_FILES} fichiers.`); break; }
        if (f.size > MAX_FILE) { setErr(content, `« ${f.name} » dépasse 10 Mo.`); continue; }
        if (total > MAX_TOTAL) { setErr(content, 'Taille totale limitée à 20 Mo.'); break; }
        files.push(f);
      }
      e.target.value = '';
      paintFiles();
    });

    const schedule = field(content, 'schedule'), when = field(content, 'sendAt');
    const okLabel = content.querySelector('[data-act=ok] span');
    schedule.addEventListener('change', () => {
      when.style.display = schedule.checked ? '' : 'none';
      okLabel.textContent = schedule.checked ? 'Programmer' : 'Envoyer';
      if (schedule.checked && !when.value) {
        const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0);
        when.value = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:00`;
      }
    });

    content.querySelector('[data-act=subject]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const body = val(content, 'body');
      if (body.length < 10) { setErr(content, "Écrivez ou générez d'abord le message."); return; }
      setErr(content, ''); btn.disabled = true;
      const res = await api('POST', '/api/ai/tools', { tool: 'subject', body });
      btn.disabled = false;
      if (res.ok && res.text) field(content, 'subject').value = res.text; else setErr(content, res.error || "Impossible de générer l'objet.");
    });

    let previous = null;
    const undo = content.querySelector('[data-act=undo]');
    content.querySelectorAll('.aic-chip[data-mode]').forEach(chip => chip.addEventListener('click', async () => {
      const ta = field(content, 'body');
      if (ta.value.trim().length < 3) { setErr(content, "Écrivez d'abord votre message."); return; }
      setErr(content, '');
      const all = content.querySelectorAll('.aic-chip'); all.forEach(c => c.disabled = true);
      const res = await api('POST', '/api/ai/tools', { tool: 'rewrite', mode: chip.dataset.mode, text: ta.value });
      all.forEach(c => c.disabled = false);
      if (res.ok && res.text) { previous = ta.value; ta.value = res.text; undo.style.display = ''; } else setErr(content, res.error || 'Modification impossible.');
    }));
    undo.addEventListener('click', () => { if (previous !== null) { field(content, 'body').value = previous; previous = null; undo.style.display = 'none'; } });

    bindFoot(ctx, async () => {
      const to = splitEmails(val(content, 'to')), cc = splitEmails(val(content, 'cc')), bcc = splitEmails(val(content, 'bcc'));
      const subject = val(content, 'subject'), body = val(content, 'body');
      if (!to.length) throw new Error('Indiquez au moins un destinataire.');
      const bad = badEmails([...to, ...cc, ...bcc]);
      if (bad.length) throw new Error('Adresse invalide : ' + bad[0]);
      if (!subject) throw new Error("L'objet est obligatoire.");
      if (!body) throw new Error('Le message est vide.');

      if (!files.length && window.AIMailTools?.mentionsAttachment(body)) {
        const go = await ConfirmModal.show({ title: 'Pièce jointe oubliée ?', body: "Votre message mentionne une pièce jointe, mais aucun fichier n'est joint. Envoyer quand même ?" });
        if (!go) return;
      }

      const form = new FormData();
      form.append('to', to.join(', ')); form.append('cc', cc.join(', ')); form.append('bcc', bcc.join(', '));
      form.append('subject', subject); form.append('body', body);
      if (card.inReplyTo) { form.append('inReplyTo', card.inReplyTo); form.append('references', card.references || card.inReplyTo); }
      files.forEach(f => form.append('attachments', f, f.name));
      const attInfo = files.length ? ` — ${files.length} pièce(s) jointe(s)` : '';

      if (schedule.checked) {
        const at = when.value;
        if (!at) throw new Error("Choisissez la date d'envoi.");
        const delta = new Date(at) - Date.now();
        if (isNaN(delta) || delta < 60000) throw new Error("La date d'envoi doit être dans le futur.");
        if (delta > 30 * 86400000) throw new Error("L'envoi ne peut pas être programmé à plus de 30 jours.");
        form.append('sendAt', localToIso(at));
        const res = await apiForm('/api/schedule', form);
        if (!res.ok) throw new Error(res.error || 'Programmation impossible.');
        App.toast(res.persistent === false ? 'Envoi programmé (attention : il sera perdu si le serveur redémarre)' : 'Envoi programmé', res.persistent === false ? 'info' : 'success');
        return finish(ctx, 'scheduled', `« ${subject} » à ${to.join(', ')} — ${fmtLocal(at)}${attInfo}`, { to, subject, body, scheduleId: res.scheduleId });
      }
      const res = await apiForm('/api/send', form);
      if (!res.ok) throw new Error(res.error || "L'envoi a échoué.");
      try { App.playSound('send'); } catch (_) { /* son facultatif */ }
      App.toast('E-mail envoyé !', 'success');
      return finish(ctx, 'sent', `« ${subject} » à ${to.join(', ')}${attInfo}`, { to, subject, body });
    });
  }

  // ── Carte : événement ─────────────────────────────────────────────────────
  const REMINDERS = [[0, "À l'heure"], [5, '5 minutes avant'], [10, '10 minutes avant'], [15, '15 minutes avant'], [30, '30 minutes avant'], [60, '1 heure avant'], [120, '2 heures avant'], [1440, '1 jour avant']];

  function buildEvent(ctx) {
    const { card, content } = ctx;
    content.innerHTML = `
      <div class="aic-form">
        <div class="aic-row"><label>Titre</label><input type="text" data-f="title" value="${esc(card.title)}"></div>
        <div class="aic-row"><label>Début</label><input type="datetime-local" data-f="start" value="${esc(card.startAt)}"></div>
        <div class="aic-row"><label>Fin</label><input type="datetime-local" data-f="end" value="${esc(card.endAt)}"></div>
        <div class="aic-row"><label>Lieu</label><input type="text" data-f="location" placeholder="Facultatif" value="${esc(card.location || '')}"></div>
        <div class="aic-row"><label>Invités</label><input type="text" data-f="attendees" autocomplete="off" placeholder="adresses e-mail, séparées par une virgule" value="${esc((card.attendees || []).join(', '))}"></div>
        <div class="aic-row"><label>Rappel</label><select data-f="reminder">${REMINDERS.map(([m, l]) => `<option value="${m}" ${m === card.reminderMinutes ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="aic-row top"><label>Notes</label><textarea data-f="description" placeholder="Facultatif">${esc(card.description || '')}</textarea></div>
        <div data-role="agenda"></div>
        <div class="aic-hint" data-role="hint" style="display:none">Les invités recevront une invitation par e-mail.</div>
      </div>${footHtml("Ajouter à l'agenda")}`;
    content.querySelectorAll('input[data-f=attendees]').forEach(attachContactSuggest);
    const att = field(content, 'attendees'), hint = content.querySelector('[data-role=hint]');
    const syncHint = () => { hint.style.display = splitEmails(att.value).length ? '' : 'none'; };
    att.addEventListener('input', syncHint); syncHint();
    bindAgenda(ctx, {
      get: () => ({ startAt: val(content, 'start'), endAt: val(content, 'end') }),
      set: (sl) => { field(content, 'start').value = sl.startAt; field(content, 'end').value = sl.endAt; },
      watch: [field(content, 'start'), field(content, 'end')],
    });

    bindFoot(ctx, async () => {
      const title = val(content, 'title'), start = val(content, 'start'), end = val(content, 'end');
      if (!title) throw new Error('Le titre est obligatoire.');
      if (!start || !end) throw new Error('Indiquez le début et la fin.');
      if (new Date(end) <= new Date(start)) throw new Error('La fin doit être après le début.');
      const attendees = splitEmails(val(content, 'attendees'));
      const bad = badEmails(attendees);
      if (bad.length) throw new Error('Adresse invalide : ' + bad[0]);
      const res = await App.apiPost('/api/calendar/events', {
        title, description: val(content, 'description'), location: val(content, 'location'),
        startAt: localToIso(start), endAt: localToIso(end), allDay: false,
        reminderMinutes: Number(val(content, 'reminder')), attendees: attendees.join(','), isMeeting: false,
      });
      if (!res.ok) throw new Error(res.error || "Création de l'événement impossible.");
      App.toast('Événement ajouté à votre agenda', 'success');
      return finish(ctx, 'created', `${title} — ${fmtLocal(start)}`, { title });
    });
  }

  // ── Carte : modification d'événement ──────────────────────────────────────
  function buildEventUpdate(ctx) {
    const { card, content } = ctx;
    const sum = (o) => `<b>${esc(o.title)}</b><br>${esc(fmtLocal(o.startAt))} → ${esc(new Date(o.endAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}${o.location ? `<br>${esc(o.location)}` : ''}${o.description ? `<br><span style="color:var(--text-muted)">${esc(o.description)}</span>` : ''}`;
    content.innerHTML = `
      <div class="aic-diff"><div><div class="lbl">Avant</div>${sum(card.before)}</div><div class="after"><div class="lbl">Après</div>${sum(card.after)}</div></div>
      <div data-role="agenda" style="padding:0 16px"></div><div style="height:6px"></div>${footHtml('Appliquer la modification')}`;
    bindAgenda(ctx, {
      get: () => ({ startAt: card.after.startAt, endAt: card.after.endAt }),
      set: (sl) => {
        card.after.startAt = sl.startAt; card.after.endAt = sl.endAt;
        content.querySelector('.aic-diff .after').innerHTML = `<div class="lbl">Après</div>${sum(card.after)}`;
      },
      excludeId: card.eventId,
    });
    bindFoot(ctx, async () => {
      const a = card.after;
      const r = await fetch(`/api/calendar/events/${card.eventId}`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': App.getCsrfToken() },
        body: JSON.stringify({
          title: a.title, description: a.description, location: a.location,
          startAt: localToIso(a.startAt), endAt: localToIso(a.endAt), allDay: card.allDay, reminderMinutes: card.reminderMinutes,
        }),
      });
      const res = await r.json().catch(() => ({ ok: false }));
      if (!res.ok) throw new Error(res.error || 'Modification impossible.');
      App.toast('Événement modifié', 'success');
      return finish(ctx, 'updated', `${a.title} — ${fmtLocal(a.startAt)}`);
    });
  }


  function buildEventDelete(ctx) {
    const { card, content } = ctx;
    const ev = card.event;
    content.innerHTML = `
      <div class="aic-diff" style="grid-template-columns:1fr"><div class="after" style="border-color:rgba(239,68,68,.45);background:rgba(239,68,68,.08)">
        <div class="lbl" style="color:#ef4444">À supprimer</div><b>${esc(ev.title)}</b><br>${esc(fmtRange(ev.startAt, ev.endAt))}${ev.location ? `<br>${esc(ev.location)}` : ''}</div></div>
      <div class="aic-hint" style="padding:8px 16px 0">Cette action est définitive. Les invités ne sont pas prévenus automatiquement.</div>
      ${footHtml("Supprimer l'événement", ICON.trash, 'danger')}`;
    bindFoot(ctx, async () => {
      const go = await ConfirmModal.show({ title: "Supprimer l'événement ?", body: `« ${ev.title} » sera définitivement supprimé de votre agenda.`, danger: true });
      if (!go) return;
      const res = await api('DELETE', `/api/calendar/events/${card.eventId}`);
      if (!res.ok) throw new Error(res.error || 'Suppression impossible.');
      App.toast('Événement supprimé', 'success');
      return finish(ctx, 'deleted', ev.title, { title: ev.title });
    });
  }

  // ── Carte : contact ───────────────────────────────────────────────────────
  function buildContact(ctx) {
    const { card, content } = ctx;
    content.innerHTML = `
      <div class="aic-form">
        <div class="aic-row"><label>Nom</label><input type="text" data-f="name" value="${esc(card.name)}"></div>
        <div class="aic-row"><label>E-mail</label><input type="email" data-f="email" value="${esc(card.email)}"></div>
        <div class="aic-row"><label>Tél.</label><input type="text" data-f="phone" placeholder="Facultatif" value="${esc(card.phone || '')}"></div>
        <div class="aic-row"><label>Société</label><input type="text" data-f="company" placeholder="Facultatif" value="${esc(card.company || '')}"></div>
        <div class="aic-row top"><label>Notes</label><textarea data-f="notes" placeholder="Facultatif">${esc(card.notes || '')}</textarea></div>
      </div>${footHtml('Ajouter aux contacts')}`;
    bindFoot(ctx, async () => {
      const name = val(content, 'name'), email = val(content, 'email');
      if (!name) throw new Error('Le nom est obligatoire.');
      if (!EMAIL_RE.test(email)) throw new Error('Adresse e-mail invalide.');
      const res = await App.apiPost('/api/contacts', { name, email, phone: val(content, 'phone'), company: val(content, 'company'), notes: val(content, 'notes') });
      if (!res.ok) throw new Error(res.error || "Ajout du contact impossible.");
      contacts = null;
      App.toast('Contact ajouté', 'success');
      return finish(ctx, 'created', `${name} <${email}>`, { name });
    });
  }

  // ── Carte : réunion ───────────────────────────────────────────────────────
  function buildMeeting(ctx) {
    const { card, content } = ctx;
    content.innerHTML = `
      <div class="aic-form">
        <div class="aic-row"><label>Titre</label><input type="text" data-f="title" value="${esc(card.title)}"></div>
        <div class="aic-row"><label>Quand</label><select data-f="mode"><option value="start" ${card.mode === 'start' ? 'selected' : ''}>Démarrer maintenant</option><option value="schedule" ${card.mode === 'schedule' ? 'selected' : ''}>Programmer</option></select></div>
        <div class="aic-row" data-role="when" style="${card.mode === 'schedule' ? '' : 'display:none'}"><label>Date</label><input type="datetime-local" data-f="when" value="${esc(card.scheduledAt || '')}"></div>
        <div class="aic-row"><label>Accès</label><select data-f="access">
          <option value="link" ${card.access === 'link' ? 'selected' : ''}>Toute personne ayant le lien</option>
          <option value="code" ${card.access === 'code' ? 'selected' : ''}>Avec un code d'accès</option>
          <option value="emails" ${card.access === 'emails' ? 'selected' : ''}>Invités uniquement</option></select></div>
        <div class="aic-row" data-role="inv" style="${card.access === 'emails' || card.invitees?.length ? '' : 'display:none'}"><label>Invités</label><input type="text" data-f="invitees" autocomplete="off" placeholder="adresses e-mail, séparées par une virgule" value="${esc((card.invitees || []).join(', '))}"></div>
        <div class="aic-schedule"><label class="aic-switch"><input type="checkbox" data-f="guests" ${card.allowGuests ? 'checked' : ''}> Autoriser les invités sans compte</label></div>
        <div data-role="agenda"></div>
      </div>${footHtml(card.mode === 'schedule' ? 'Programmer la réunion' : 'Créer la réunion', ICON.video)}`;
    content.querySelectorAll('input[data-f=invitees]').forEach(attachContactSuggest);
    const mode = field(content, 'mode'), access = field(content, 'access');
    const okLabel = content.querySelector('[data-act=ok] span');
    mode.addEventListener('change', () => {
      content.querySelector('[data-role=when]').style.display = mode.value === 'schedule' ? '' : 'none';
      okLabel.textContent = mode.value === 'schedule' ? 'Programmer la réunion' : 'Créer la réunion';
    });
    access.addEventListener('change', () => {
      content.querySelector('[data-role=inv]').style.display = access.value === 'emails' ? '' : (splitEmails(val(content, 'invitees')).length ? '' : 'none');
    });

    const dur = card.durationMin || 60;
    bindAgenda(ctx, {
      get: () => { const w = val(content, 'when'); return mode.value === 'schedule' && w ? { startAt: w, endAt: addMinLocal(w, dur) } : { startAt: '', endAt: '' }; },
      set: (sl) => { field(content, 'when').value = sl.startAt; },
      watch: [field(content, 'when'), mode],
    });
    bindFoot(ctx, async () => {
      const title = val(content, 'title') || 'Réunion';
      const instant = mode.value === 'start';
      const when = val(content, 'when');
      if (!instant && !when) throw new Error('Choisissez la date de la réunion.');
      const invitees = splitEmails(val(content, 'invitees'));
      const bad = badEmails(invitees);
      if (bad.length) throw new Error('Adresse invalide : ' + bad[0]);
      if (access.value === 'emails' && !invitees.length) throw new Error('Ajoutez au moins un invité.');
      const res = await App.apiPost('/api/meetings', {
        title, access: access.value, allowedEmails: invitees.join(','),
        scheduledAt: instant ? null : localToMysql(when), instant: instant ? '1' : '',
        allowGuests: field(content, 'guests').checked ? '1' : '',
      });
      if (!res.ok) throw new Error(res.error || 'Création de la réunion impossible.');
      App.toast(instant ? 'Réunion créée' : 'Réunion programmée', 'success');
      const detail = `${title}${instant ? '' : ' — ' + fmtLocal(when)}${res.code ? ' — code : ' + res.code : ''}`;
      return finish(ctx, instant ? 'started' : 'created', detail, { link: res.link, title });
    });
  }

  // ── Carte : recherche d'e-mails ───────────────────────────────────────────
  function buildSearch(ctx) {
    const { card, content } = ctx;
    const crit = [];
    if (card.folder) crit.push('Dossier : ' + ({ INBOX: 'Boîte de réception', Sent: 'Envoyés', Drafts: 'Brouillons', Junk: 'Indésirables', Trash: 'Corbeille', ALL: 'Tous' }[card.folder] || card.folder));
    if (card.from) crit.push('De : ' + card.from);
    if (card.subject) crit.push('Objet : ' + card.subject);
    if (card.since) crit.push('Depuis le ' + card.since);
    if (card.before) crit.push("Avant le " + card.before);
    if (card.unread) crit.push('Non lus'); if (card.starred) crit.push('Favoris'); if (card.hasAttachment) crit.push('Avec pièce jointe');
    content.innerHTML = `<div class="aic-crit">${crit.map(c => `<span>${esc(c)}</span>`).join('')}</div>
      <div data-role="res"></div>
      <div class="aic-foot"><span class="aic-err" data-role="err"></span>
        <button type="button" class="aic-btn" data-act="dismiss">Fermer</button>
        <button type="button" class="aic-btn primary" data-act="ok">${ICON.search}<span>Lancer la recherche</span></button></div>`;
    let results = null;
    bindFoot(ctx, async (btn) => {
      if (results) { window.AIMailTools?.openResults(results, card); return; }
      const out = await window.AIMailTools.runSearch(card);
      results = out;
      const box = content.querySelector('[data-role=res]');
      if (!out.length) { box.innerHTML = '<div class="aic-hint" style="padding:10px 16px">Aucun e-mail ne correspond à cette recherche.</div>'; return; }
      box.innerHTML = `<div class="aic-hint" style="padding:10px 16px 4px">${out.length} résultat(s)</div><div class="aic-results">${out.slice(0, 6).map(m => `<div class="aic-result"><b>${esc(m.subject || '(Sans objet)')}</b><span>${esc(m.from || '')}</span></div>`).join('')}</div>`;
      btn.dataset.label = 'Afficher dans ma messagerie';
    });
  }

  return { show, toggleSide, newConversation, send, onKey, autoGrow, openPrefs, toggleDictation, ICON, esc, md };
})();
