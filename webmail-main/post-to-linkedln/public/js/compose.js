/**
 * compose.js v2
 * - Reply All
 * - Brouillons automatiques (auto-save toutes les 30s)
 * - Accusé de réception
 * - Programmation d'envoi
 * - Templates de réponse rapides
 */
const Compose = (() => {
  let mode        = 'new';
  let attachments = [];
  let draftTimer  = null;
  let lastDraftId = null;   // messageId du dernier brouillon sauvegardé

  const TEMPLATES = [
    { label: 'Bien reçu',      body: 'Bonjour,\n\nBien reçu, merci pour votre message.\n\nCordialement,' },
    { label: 'En cours',       body: 'Bonjour,\n\nVotre demande est bien prise en compte et est en cours de traitement.\n\nCordialement,' },
    { label: 'Absent',         body: 'Bonjour,\n\nJe suis actuellement absent(e) et reviendrai vers vous dès que possible.\n\nCordialement,' },
    { label: 'Réunion OK',     body: 'Bonjour,\n\nJe confirme ma présence à la réunion.\n\nCordialement,' },
    { label: 'Merci',          body: 'Bonjour,\n\nMerci beaucoup pour votre retour.\n\nCordialement,' },
  ];

  function open(opts) {
    mode = (opts && opts.mode) || 'new';
    // Pour un nouveau message, toujours vider les champs d'abord
    if (!opts || mode === 'new') reset();
    const titles = { new: 'Nouveau message', reply: 'Répondre', replyAll: 'Répondre à tous', forward: 'Transférer' };
    document.getElementById('compose-title').textContent = titles[mode] || 'Nouveau message';
    if (opts) {
      if (opts.to)      document.getElementById('c-to').value      = opts.to;
      if (opts.cc)      { document.getElementById('c-cc').value = opts.cc; }
      if (opts.subject) document.getElementById('c-subject').value = opts.subject;
      if (opts.body)    document.getElementById('c-body').value    = opts.body;
    }
    document.getElementById('compose-overlay').classList.add('open');
    const focusEl = (!opts || !opts.to) ? document.getElementById('c-to') : document.getElementById('c-body');
    setTimeout(() => focusEl?.focus(), 50);
    startAutosave();
  }

  function openReply(email) {
    reset();
    open({
      mode: 'reply', to: email.from || '',
      subject: email.subject?.startsWith('Re:') ? email.subject : 'Re: ' + (email.subject || ''),
      body: '\n\n────────────────────\nDe : ' + email.from + '\nDate : ' + (email.date ? new Date(email.date).toLocaleString('fr-FR') : '') + '\nObjet : ' + (email.subject || '') + '\n\n' + (email.text || ''),
    });
  }

  function openReplyAll(email) {
    reset();
    // Construire la liste To : expéditeur + tous les destinataires sauf soi
    const myEmail = App.state.activeAccount || '';
    const toList  = [email.from, email.to, email.cc]
      .filter(Boolean).join(', ')
      .split(/[,;]+/).map(s => s.trim())
      .filter(addr => addr && !addr.includes(myEmail));
    open({
      mode: 'replyAll',
      to:      toList.join(', '),
      subject: email.subject?.startsWith('Re:') ? email.subject : 'Re: ' + (email.subject || ''),
      body: '\n\n────────────────────\nDe : ' + email.from + '\nDate : ' + (email.date ? new Date(email.date).toLocaleString('fr-FR') : '') + '\nObjet : ' + (email.subject || '') + '\n\n' + (email.text || ''),
    });
  }

  function openForward(email) {
    reset();
    open({
      mode: 'forward',
      subject: email.subject?.startsWith('Fwd:') ? email.subject : 'Fwd: ' + (email.subject || ''),
      body: '\n\n────── Message transféré ──────\nDe : ' + email.from + '\nDate : ' + (email.date ? new Date(email.date).toLocaleString('fr-FR') : '') + '\nObjet : ' + (email.subject || '') + '\n\n' + (email.text || ''),
    });
  }

  function toggleBcc() {
    const row = document.getElementById('c-bcc-row');
    const btn = document.getElementById('bcc-toggle');
    const isOpen = row.style.display === 'none';
    row.style.display = isOpen ? 'flex' : 'none';
    btn.style.color   = isOpen ? 'var(--accent)' : 'var(--text-muted)';
    if (isOpen) document.getElementById('c-bcc').focus();
    else document.getElementById('c-bcc').value = '';
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  function toggleTemplates() {
    let dd = document.getElementById('template-dropdown');
    if (!dd) {
      dd = document.createElement('div');
      dd.id = 'template-dropdown';
      dd.className = 'template-dropdown';
      dd.innerHTML = TEMPLATES.map((t, i) =>
        '<div class="template-item" onclick="Compose.applyTemplate(' + i + ')">' + t.label + '</div>'
      ).join('');
      const btn = document.getElementById('btn-templates');
      btn.parentNode.insertBefore(dd, btn.nextSibling);
      setTimeout(() => document.addEventListener('click', closeTplDropdown, { once: true }), 10);
    } else {
      dd.remove();
    }
  }

  function closeTplDropdown() {
    const dd = document.getElementById('template-dropdown');
    if (dd) dd.remove();
  }

  function applyTemplate(idx) {
    const tpl = TEMPLATES[idx];
    if (!tpl) return;
    const body = document.getElementById('c-body');
    body.value = tpl.body + '\n\n' + body.value;
    body.focus();
    closeTplDropdown();
  }

  // ── Brouillon auto ─────────────────────────────────────────────────────────
  function startAutosave() {
    stopAutosave();
    draftTimer = setInterval(saveDraftNow, 30000);
  }

  function stopAutosave() {
    if (draftTimer) { clearInterval(draftTimer); draftTimer = null; }
  }

  async function saveDraftNow() {
    const to      = document.getElementById('c-to')?.value.trim() || '';
    const subject = document.getElementById('c-subject')?.value.trim() || '';
    const body    = document.getElementById('c-body')?.value.trim() || '';
    if (!to && !subject && !body) return;
    setStatus('Brouillon sauvegardé…', 'var(--text-muted)');
    try {
      const res = await App.apiPost('/api/draft', { to, cc: document.getElementById('c-cc')?.value||'', bcc: document.getElementById('c-bcc')?.value||'', subject, body, messageId: lastDraftId });
      if (res.ok && res.messageId) lastDraftId = res.messageId;
      setStatus('Brouillon enregistré', 'var(--text-muted)');
      setTimeout(() => setStatus('', ''), 3000);
    } catch(e) { /* silencieux */ }
  }

  // ── Programmation envoi ────────────────────────────────────────────────────
  function toggleSchedule() {
    let picker = document.getElementById('schedule-picker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'schedule-picker';
      picker.className = 'schedule-picker';
      const minDate = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);
      picker.innerHTML =
        '<label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Envoyer le</label>' +
        '<input type="datetime-local" id="schedule-dt" min="' + minDate + '" style="background:var(--bg-hover);border:1px solid var(--border);border-radius:7px;padding:6px 10px;color:var(--text-1);font-size:12px;width:100%;"/>' +
        '<button onclick="Compose.sendScheduled()" style="margin-top:8px;width:100%;padding:7px;border-radius:7px;background:var(--accent);border:none;color:white;font-size:12px;font-weight:700;cursor:pointer;">Programmer</button>';
      const footer = document.querySelector('.compose-footer');
      footer.insertAdjacentElement('afterend', picker);
    } else {
      picker.remove();
    }
  }

  async function sendScheduled() {
    const dt = document.getElementById('schedule-dt')?.value;
    if (!dt) { setStatus('Choisissez une date', '#f87171'); return; }
    const to      = document.getElementById('c-to').value.trim();
    const subject = document.getElementById('c-subject').value.trim();
    const body    = document.getElementById('c-body').value.trim();
    if (!to || !subject || !body) { setStatus('Remplissez les champs obligatoires', '#f87171'); return; }
    try {
      const res = await App.apiPost('/api/schedule', { to, cc: document.getElementById('c-cc')?.value||'', bcc: document.getElementById('c-bcc')?.value||'', subject, body, sendAt: new Date(dt).toISOString() });
      if (res.ok) {
        App.toast('Envoi programmé pour ' + new Date(dt).toLocaleString('fr-FR'), 'success');
        close();
      } else setStatus(res.error || 'Erreur', '#f87171');
    } catch(e) { setStatus('Erreur réseau', '#f87171'); }
  }

  // ── Pièces jointes ─────────────────────────────────────────────────────────
  function triggerFileInput() { document.getElementById('c-file-input').click(); }

  function onFilesSelected(input) {
    Array.from(input.files || []).forEach(file => {
      if (file.size > 10 * 1024 * 1024) { App.toast(file.name + ' dépasse 10 Mo', 'warning'); return; }
      const id = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      attachments.push({ file, id });
      renderAttachmentChip({ file, id });
    });
    input.value = '';
    updateAttachmentArea();
  }

  function removeAttachment(id) {
    attachments = attachments.filter(a => a.id !== id);
    const chip = document.getElementById('chip-' + id);
    if (chip) chip.remove();
    updateAttachmentArea();
  }

  function renderAttachmentChip({ file, id }) {
    const list = document.getElementById('c-att-list');
    const chip = document.createElement('div');
    chip.id = 'chip-' + id;
    chip.className = 'att-chip';
    chip.innerHTML =
      '<span class="att-chip-icon">' + getComposeIcon(file.type) + '</span>' +
      '<span class="att-chip-name" title="' + esc(file.name) + '">' + esc(file.name) + '</span>' +
      '<span class="att-chip-size">' + fmtSize(file.size) + '</span>' +
      '<button class="att-chip-remove" onclick="Compose.removeAttachment(\'' + id + '\')" title="Supprimer">' +
      '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    list.appendChild(chip);
  }

  function getComposeIcon(type) {
    if (type.startsWith('image/'))  return '🖼️';
    if (type === 'application/pdf') return '📄';
    if (type.includes('word'))      return '📝';
    if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
    if (type.includes('zip') || type.includes('archive') || type.includes('x-tar') || type.includes('x-rar')) return '🗜️';
    if (type.startsWith('video/'))  return '🎬';
    if (type.startsWith('audio/'))  return '🎵';
    return '📎';
  }

  function updateAttachmentArea() {
    const area = document.getElementById('c-att-area');
    area.style.display = attachments.length > 0 ? 'flex' : 'none';
    const total = attachments.reduce((s, a) => s + a.file.size, 0);
    const countEl = document.getElementById('c-att-count');
    if (countEl) countEl.textContent = attachments.length > 0 ? attachments.length + ' fichier(s) — ' + fmtSize(total) : '';
  }

  function minimize() { document.getElementById('compose-overlay').classList.remove('open'); }

  function close() {
    stopAutosave();
    document.getElementById('compose-overlay').classList.remove('open');
    const sp = document.getElementById('schedule-picker');
    if (sp) sp.remove();
    reset();
  }

  function reset() {
    ['c-to','c-cc','c-bcc','c-subject','c-body'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    attachments = []; lastDraftId = null;
    const list = document.getElementById('c-att-list');
    if (list) list.innerHTML = '';
    updateAttachmentArea();
    const bccRow = document.getElementById('c-bcc-row');
    if (bccRow) bccRow.style.display = 'none';
    setStatus('', '');
  }

  function setStatus(msg, color) {
    const el = document.getElementById('compose-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = color || 'var(--text-muted)';
  }

  async function send() {
    const to      = document.getElementById('c-to').value.trim();
    const cc      = document.getElementById('c-cc').value.trim();
    const bcc     = document.getElementById('c-bcc').value.trim();
    const subject = document.getElementById('c-subject').value.trim();
    const body    = document.getElementById('c-body').value.trim();
    const dsr     = document.getElementById('c-dsr')?.checked; // accusé de réception

    if (!to)      { setStatus('Destinataire manquant', '#f87171'); return; }
    if (!subject) { setStatus('Objet manquant', '#f87171'); return; }
    if (!body)    { setStatus('Message vide', '#f87171'); return; }

    setStatus('Envoi en cours…', '#60a5fa');
    const btn = document.querySelector('.btn-send');
    if (btn) btn.disabled = true;

    const fd = new FormData();
    fd.append('to', to); fd.append('cc', cc); fd.append('bcc', bcc);
    fd.append('subject', subject); fd.append('body', body);
    if (dsr) fd.append('dsr', '1');
    attachments.forEach(({ file }) => fd.append('attachments', file, file.name));

    try {
      const resp = await fetch('/api/send', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
      });
      const res = await resp.json();
      if (btn) btn.disabled = false;
      if (res.ok) {
        stopAutosave();
        App.playSound('send');
        App.toast('Email envoyé !', 'success');
        close();
        // Rafraîchir la liste des emails (Sent ou dossier courant)
        if (typeof Mail !== 'undefined' && typeof Mail.loadEmails === 'function') {
          Mail.loadEmails(true);
        }
      } else {
        setStatus(res.error || "Erreur d'envoi", '#f87171');
      }
    } catch(e) {
      if (btn) btn.disabled = false;
      setStatus('Erreur réseau', '#f87171');
    }
  }

  return { open, openReply, openReplyAll, openForward, minimize, close, toggleBcc, triggerFileInput, onFilesSelected, removeAttachment, send, toggleTemplates, applyTemplate, toggleSchedule, sendScheduled, saveDraftNow };
})();