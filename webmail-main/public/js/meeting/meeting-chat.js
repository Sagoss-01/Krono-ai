/**
 * meeting-chat.js
 * Chat, notes collaboratives, panneau latéral, sondage, AI assistant, résumé.
 */

// ── Panneau latéral ──────────────────────────────────────────────────────────
let _mentionsInited = false;
function switchTab(tab) {
  MeetState.currentTab = tab;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + tab)?.classList.add('active');
  if (tab === 'chat') {
    const badge = document.getElementById('chat-badge');
    if (badge) { badge.style.display = 'none'; badge.style.background = ''; }
    MeetState.unreadCount = 0;
    clearTimeout(MeetState.badgeTimer);
    // Initialiser les @mentions une seule fois
    if (!_mentionsInited) { initChatMentions(); _mentionsInited = true; }
    document.getElementById('chat-inp')?.focus();
    const msgs = document.getElementById('chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  if (tab === 'notes') document.getElementById('notes-editor')?.focus();
  if (tab === 'participation') renderParticipationPanel?.();
}

function toggleChat() {
  MeetState.chatOpen = !MeetState.chatOpen;
  const panel = document.getElementById('side-panel');
  panel.classList.toggle('open', MeetState.chatOpen);
  const btn = document.getElementById('btn-chat');
  if (btn) btn.className = 'ctrl-btn ' + (MeetState.chatOpen ? 'chat-on' : 'active');
  if (MeetState.chatOpen) switchTab(MeetState.currentTab);
}

// ── Chat messages ────────────────────────────────────────────────────────────

// Autocomplete @mentions

function meetingChatAnonymousEnabled() {
  return !!document.getElementById('chat-anonymous-toggle')?.checked;
}

function meetingChatParticipantNames() {
  const seen = new Set();
  return Array.from(document.querySelectorAll('.peer-name'))
    .map(el => (el.textContent || '').replace(' (vous)', '').trim())
    .filter(Boolean)
    .filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function meetingChatMentionSuggestions(query) {
  const norm = (query || '').toLowerCase();
  const suggestions = [];
  if (!norm || ['t','to','tou','tous','all','every','everyone'].some(v => v.startsWith(norm)) || norm.includes('tou')) {
    suggestions.push({ type: 'everyone', label: '@tous', value: 'tous', avatar: 'TT' });
  }
  meetingChatParticipantNames().forEach(name => {
    if (!norm || name.toLowerCase().includes(norm)) suggestions.push({ type: 'person', label: '@' + name, value: name, avatar: name.slice(0, 2).toUpperCase() });
  });
  return suggestions;
}

function meetingChatSenderLabel(payload, isMine = false) {
  if (isMine) return MeetState.displayName + ' (vous)';
  if (payload?.anonymous) return 'Un participant';
  return payload?.displayName || payload?.email || 'Un participant';
}

function meetingChatTextContainsEveryone(text) {
  const normalized = (text || '').toLowerCase();
  return /(^|\s)@(tous|everyone|all|toutlemonde)(?=\b|\s|$)/i.test(normalized);
}

function initChatMentions() {
  const inp = document.getElementById('chat-inp');
  if (!inp) return;

  // Créer le dropdown
  const dropdown = document.createElement('div');
  dropdown.id = 'mention-dropdown';
  dropdown.style.cssText = 'position:absolute;bottom:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:none;z-index:500;box-shadow:0 -8px 24px rgba(0,0,0,.3);max-height:180px;overflow-y:auto;';
  inp.parentElement.style.position = 'relative';
  inp.parentElement.appendChild(dropdown);

  let mentionStart = -1;

  inp.addEventListener('input', () => {
    const val    = inp.value;
    const cursor = inp.selectionStart;
    // Trouver le dernier @ avant le curseur
    const before = val.slice(0, cursor);
    const atIdx  = before.lastIndexOf('@');

    if (atIdx === -1 || (atIdx > 0 && !/\s/.test(val[atIdx-1]) === false)) {
      dropdown.style.display = 'none'; mentionStart = -1; return;
    }

    const query = before.slice(atIdx + 1).toLowerCase();
    mentionStart = atIdx;

    const suggestions = meetingChatMentionSuggestions(query);

    if (!suggestions.length) { dropdown.style.display = 'none'; return; }

    dropdown.style.display = 'block';
    dropdown.innerHTML = suggestions.map(item => `
      <div class="mention-item" data-name="${escHtml(item.value)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px;color:var(--text1);display:flex;align-items:center;gap:8px;transition:background .1s;"
        onmouseover="this.style.background='rgba(3,92,128,0.12)'" onmouseout="this.style.background=''"
        onclick="insertMention('${escHtml(item.value)}')">
        <div style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:white;">
          ${escHtml(item.avatar)}
        </div>
        <span>${escHtml(item.label)}</span>
      </div>`).join('');
  });

  inp.addEventListener('keydown', e => {
    if (dropdown.style.display === 'none') return;
    const items = dropdown.querySelectorAll('.mention-item');
    const active = dropdown.querySelector('.mention-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      active?.classList.remove('active'); next?.classList.add('active');
      next?.style.setProperty('background', 'rgba(3,92,128,0.12)');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? active.previousElementSibling : items[items.length-1];
      active?.classList.remove('active'); prev?.classList.add('active');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const a = dropdown.querySelector('.mention-item.active') || items[0];
      if (a) { e.preventDefault(); insertMention(a.dataset.name); }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== inp) dropdown.style.display = 'none';
  });
}

function insertMention(name) {
  const inp = document.getElementById('chat-inp');
  const dropdown = document.getElementById('mention-dropdown');
  if (!inp) return;
  const val    = inp.value;
  const cursor = inp.selectionStart;
  const before = val.slice(0, cursor);
  const atIdx  = before.lastIndexOf('@');
  const after  = val.slice(cursor);
  inp.value = before.slice(0, atIdx) + '@' + name + ' ' + after;
  inp.focus();
  inp.setSelectionRange(atIdx + name.length + 2, atIdx + name.length + 2);
  if (dropdown) dropdown.style.display = 'none';
}

function sendChat() {
  if (MeetState.canChat === false || MeetState.isReadOnly) { notify("Le chat est désactivé par l'administration"); return; }
  const inp  = document.getElementById('chat-inp');
  const text = inp.value.trim();
  if (!text) return;
  MeetState.socket?.emit('meeting_chat', {
    meetingId:  MeetState.MEETING_ID,
    text,
    anonymous: meetingChatAnonymousEnabled(),
  });
  inp.value = '';
  const dropdown = document.getElementById('mention-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}



function meetingChatSetUploadProgress(previewId, pct, label) {
  const bar = document.getElementById(previewId + '-bar');
  const lbl = document.getElementById(previewId + '-pct');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (lbl) lbl.textContent = label || (Math.max(0, Math.min(100, pct)) + '%');
}

function meetingChatFinalizeUploadedFile(fileMeta) {
  MeetState.socket?.emit('meeting_chat', {
    meetingId: MeetState.MEETING_ID,
    text: '',
    anonymous: meetingChatAnonymousEnabled(),
    fileName: fileMeta.fileName,
    fileSize: fileMeta.fileSize,
    fileType: fileMeta.fileType,
    fileUrl: fileMeta.fileUrl,
    fileId: fileMeta.fileId,
  });
}

function meetingChatUploadHttp(file, previewId) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('anonymous', meetingChatAnonymousEnabled() ? '1' : '0');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/meetings/${encodeURIComponent(MeetState.MEETING_ID)}/chat-upload`);
    xhr.responseType = 'text';
    xhr.timeout = 120000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-CSRF-Token', document.querySelector('meta[name="csrf-token"]')?.content || '');

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      meetingChatSetUploadProgress(previewId, pct, pct + '%');
    };
    xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload HTTP"));
    xhr.ontimeout = () => reject(new Error('Upload HTTP trop long ou interrompu'));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status < 200 || xhr.status >= 300 || !data?.ok) {
        const err = new Error(data?.error || `Upload HTTP impossible (HTTP ${xhr.status || '?'})`);
        err.httpStatus = xhr.status;
        return reject(err);
      }
      resolve(data.file);
    };
    try { xhr.send(form); } catch (e) { reject(e); }
  });
}

function meetingChatEmitAck(event, payload) {
  return new Promise((resolve) => {
    if (!MeetState.socket) return resolve({ ok: false, error: 'Socket indisponible' });
    try {
      MeetState.socket.timeout(15000).emit(event, payload, (err, response) => {
        if (err) return resolve({ ok: false, error: 'Délai dépassé' });
        resolve(response || { ok: false, error: 'Aucune réponse serveur' });
      });
    } catch (_) {
      resolve({ ok: false, error: 'Socket indisponible' });
    }
  });
}

async function meetingChatUploadSocketChunks(file, previewId) {
  const uploadId = 'upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const chunkSize = 64 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  const init = await meetingChatEmitAck('meeting_chat_upload_init', {
    meetingId: MeetState.MEETING_ID,
    uploadId,
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    totalChunks,
    fileSize: file.size,
  });
  if (!init?.ok) throw new Error(init?.error || "Impossible d'initialiser l'upload simple");

  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
      reader.readAsDataURL(chunk);
    });
    const ack = await meetingChatEmitAck('meeting_chat_upload_chunk', { uploadId, index, data: base64 });
    if (!ack?.ok) throw new Error(ack?.error || 'Chunk refusé');
    const pct = Math.round(((index + 1) / totalChunks) * 100);
    meetingChatSetUploadProgress(previewId, pct, pct + '%');
  }

  const done = await meetingChatEmitAck('meeting_chat_upload_complete', { uploadId });
  if (!done?.ok) throw new Error(done?.error || "Impossible de finaliser l'upload simple");
  return done.file;
}

async function sendFile(input) {
  if (MeetState.canChat === false || MeetState.isReadOnly) { notify("Le chat est désactivé par l'administration"); if (input) input.value=''; return; }
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { notify('Fichier trop grand (max 15 Mo)'); input.value = ''; return; }

  const msgs      = document.getElementById('chat-msgs');
  const fmtSz     = b => b < 1024 ? b+'B' : b < 1048576 ? (b/1024).toFixed(1)+'KB' : (b/1048576).toFixed(1)+'MB';
  const previewId = 'upload-' + Date.now();
  const preview   = document.createElement('div');
  preview.className = 'chat-msg chat-msg-mine';
  preview.id = previewId;
  preview.innerHTML = `<div class="chat-msg-who">${escHtml(MeetState.displayName)} (vous)</div>
    <div class="chat-upload-preview"><div class="chat-upload-name">${escHtml(file.name)}</div>
    <div class="chat-progress-track"><div class="chat-progress-fill" id="${previewId}-bar"></div></div>
    <div class="chat-upload-status"><span id="${previewId}-pct">0%</span><span>${fmtSz(file.size)}</span></div></div>`;
  if (msgs) { msgs.appendChild(preview); msgs.scrollTop = msgs.scrollHeight; }

  try {
    meetingChatSetUploadProgress(previewId, 0, '0%');
    let fileMeta = null;
    try {
      fileMeta = await meetingChatUploadHttp(file, previewId);
    } catch (httpErr) {
      console.warn('[meeting-chat] upload HTTP échoué, fallback socket:', httpErr?.message || httpErr);
      meetingChatSetUploadProgress(previewId, 0, 'bascule…');
      fileMeta = await meetingChatUploadSocketChunks(file, previewId);
    }

    meetingChatSetUploadProgress(previewId, 100, '100%');
    meetingChatFinalizeUploadedFile(fileMeta);
    setTimeout(() => { document.getElementById(previewId)?.remove(); }, 600);
  } catch (e) {
    document.getElementById(previewId)?.remove();
    notify(e?.message || "Impossible d'uploader ce fichier");
  } finally {
    input.value = '';
  }
}


function appendChat(who, text, at, isMine, file, anonymous = false, meta = {}) {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  const time = new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  if (meta?.id && document.querySelector(`.chat-msg[data-message-id="${String(meta.id)}"]`)) return;
  div.className = 'chat-msg' + (isMine ? ' chat-msg-mine' : '');
  if (meta?.id) div.dataset.messageId = String(meta.id);
  const fmtSz = b => b < 1024 ? b+'B' : b < 1048576 ? (b/1024).toFixed(1)+'KB' : (b/1048576).toFixed(1)+'MB';
  const safeWho = anonymous && !isMine ? 'Un participant' : who;
  let inner = `<div class="chat-msg-who">${escHtml(safeWho)}</div>`;
  if (text) inner += `<div class="chat-msg-text">${escHtml(text)}</div>`;
  if (file?.fileUrl) inner += `<a href="${escHtml(file.fileUrl)}" download="${escHtml(file.fileName||'fichier')}" class="chat-file-msg" onclick="return MeetApp.chatHandleDownload(event, this)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
    <div><div class="chat-file-name">${escHtml(file.fileName||'fichier')}</div><div class="chat-file-size">${fmtSz(file.fileSize||0)}</div></div>
    <span class="chat-download-spinner" style="display:none;width:14px;height:14px;border:2px solid rgba(77,184,216,.25);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;"></span>
    <svg class="chat-download-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  </a>`;
  inner += `<div class="chat-msg-time">${time}</div>`;
  div.innerHTML = inner; msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
}


async function meetingChatHandleDownload(event, anchor) {
  if (!anchor?.href) return true;
  event.preventDefault();
  const spinner = anchor.querySelector('.chat-download-spinner');
  const icon = anchor.querySelector('.chat-download-icon');
  if (spinner) spinner.style.display = 'inline-block';
  if (icon) icon.style.display = 'none';
  try {
    const res = await fetch(anchor.href, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = anchor.getAttribute('download') || 'fichier';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  } catch (e) {
    notify(e?.message || 'Téléchargement impossible');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (icon) icon.style.display = 'inline-block';
  }
  return false;
}

// ── Notes collaboratives ─────────────────────────────────────────────────────
function initNotes() {
  const editor = document.getElementById('notes-editor');
  if (!editor) return;
  editor.addEventListener('input', () => {
    setNotesStatus('syncing');
    clearTimeout(MeetState.notesSaveTimer);
    MeetState.notesSaveTimer = setTimeout(() => {
      MeetState.notesRevision++;
      MeetState.socket?.emit('notes_update', {
        meetingId: MeetState.MEETING_ID,
        content: editor.value,
        revision: MeetState.notesRevision,
        author: MeetState.displayName,
      });
    }, 500);
  });
}

function setNotesStatus(state) {
  const dot = document.getElementById('notes-dot');
  if (!dot) return;
  dot.className = 'notes-sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
}

function exportNotes(format) {
  const content = document.getElementById('notes-editor')?.value || '';
  if (!content.trim()) { notify('Aucune note à exporter'); return; }
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
  a.download = 'notes-reunion.' + (format || 'txt');
  a.click();
}

function setupNotesSocket() {
  MeetState.socket?.on('notes_update', ({ content, revision, author }) => {
    const editor = document.getElementById('notes-editor');
    if (editor && revision > MeetState.notesRevision) {
      editor.value = content;
      MeetState.notesRevision = revision;
      setNotesStatus('synced');
    }
  });
  MeetState.socket?.on('notes_state', ({ content, revision }) => {
    const editor = document.getElementById('notes-editor');
    if (editor) { editor.value = content || ''; MeetState.notesRevision = revision || 0; }
  });
  MeetState.socket?.on('notes_ack', () => setNotesStatus('synced'));
}

// ── Sondage ──────────────────────────────────────────────────────────────────
function pollResetZones() {
  document.getElementById('poll-create-zone')?.style.setProperty('display', meetingHasControlPower() ? 'block' : 'none');
  document.getElementById('poll-vote-zone')?.style.setProperty('display', 'none');
  document.getElementById('poll-results-zone')?.style.setProperty('display', 'none');
  document.getElementById('poll-placeholder')?.style.setProperty('display', meetingHasControlPower() ? 'none' : 'block');
  document.getElementById('poll-new-btn')?.style.setProperty('display', meetingHasControlPower() ? 'inline-flex' : 'none');
}

function pollEnsureControls() {
  let wrap = document.getElementById('poll-host-controls');
  if (!wrap) {
    const section = document.getElementById('section-poll') || document.getElementById('poll-results-zone') || document.getElementById('poll-vote-zone');
    if (!section) return;
    wrap = document.createElement('div');
    wrap.id = 'poll-host-controls';
    wrap.style.cssText = 'display:none;gap:8px;align-items:center;justify-content:space-between;margin:8px 0 12px;flex-wrap:wrap;';
    wrap.innerHTML = `
      <div id="poll-host-status" style="font-size:11px;color:var(--muted);"></div>
      <button id="poll-end-btn" onclick="MeetApp.endPoll()" style="display:none;padding:8px 14px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">
        Mettre fin au sondage
      </button>`;
    section.querySelector('.panel-head')?.insertAdjacentElement('afterend', wrap);
  }
}

function pollUpdateHostControls(poll, ended = false) {
  pollEnsureControls();
  const wrap = document.getElementById('poll-host-controls');
  const status = document.getElementById('poll-host-status');
  const endBtn = document.getElementById('poll-end-btn');
  if (!wrap || !status || !endBtn) return;

  const hasActivePoll = !!(poll && !ended && !poll.closed);
  if (!meetingHasControlPower() || !hasActivePoll) {
    wrap.style.display = 'none';
    endBtn.style.display = 'none';
    return;
  }

  const expected = Number.isFinite(poll.expectedVotes) ? poll.expectedVotes : 0;
  const received = Number.isFinite(poll.receivedVotes) ? poll.receivedVotes : (Array.isArray(poll.votes) ? poll.votes.reduce((a, b) => a + b, 0) : 0);
  wrap.style.display = 'flex';
  status.textContent = expected > 0
    ? `Réponses : ${received}/${expected}${poll.allAnswered ? ' — tout le monde a répondu' : ''}`
    : 'Aucun participant à sonder pour le moment';
  endBtn.style.display = 'inline-flex';
}

function initPollUI() {
  MeetState.currentPoll = null;
  newPoll();
}

function addPollOption() {
  const container = document.getElementById('poll-options-list');
  if (!container) return;
  const count = container.querySelectorAll('.poll-option-input').length;
  if (count >= 6) { notify('Maximum 6 options'); return; }
  const div = document.createElement('div');
  div.className = 'poll-option-input';
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
  div.innerHTML = `<input type="text" placeholder="Option ${count + 1}" style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;">
    <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;">×</button>`;
  container.appendChild(div);
}

function launchPoll() {
  const question = document.getElementById('poll-question')?.value.trim();
  const options  = Array.from(document.querySelectorAll('#poll-options-list .poll-option-input input')).map(i => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) { notify('Question et au moins 2 options requises'); return; }
  MeetState.socket?.emit('poll_launch', { meetingId: MeetState.MEETING_ID, question, options });
  pollUpdateHostControls({ expectedVotes: 0, receivedVotes: 0, allAnswered: false }, false);
  notify('Sondage lancé !');
}


function showPollVote(poll) {
  document.getElementById('poll-create-zone')?.style.setProperty('display', 'none');
  document.getElementById('poll-results-zone')?.style.setProperty('display', meetingHasControlPower() ? 'block' : 'none');
  document.getElementById('poll-placeholder')?.style.setProperty('display', 'none');
  document.getElementById('poll-vote-zone')?.style.setProperty('display', meetingHasControlPower() ? 'none' : 'block');
  const q = document.getElementById('poll-question-display');
  const choices = document.getElementById('poll-choices');
  if (q) q.textContent = poll.question || '';
  if (choices) choices.innerHTML = (poll.options || []).map((o, i) => `<button class="poll-choice-btn" onclick="MeetApp.pollCastVote(${i})">${escHtml(o)}</button>`).join('');
  pollUpdateHostControls(poll, false);
  if (meetingHasControlPower()) showPollResults(poll, { live: true });
}

function castVote(optionIndex) {
  if (!MeetState.currentPoll) return;
  MeetState.socket?.emit('poll_vote', { meetingId: MeetState.MEETING_ID, pollId: MeetState.currentPoll.id, optionIndex });
  document.querySelectorAll('.poll-choice-btn').forEach((btn, i) => { btn.disabled = true; if (i === optionIndex) btn.classList.add('voted'); });
}

function showPollResults(poll, opts = {}) {
  const live = !!opts.live;
  document.getElementById('poll-create-zone')?.style.setProperty('display', 'none');
  document.getElementById('poll-vote-zone')?.style.setProperty('display', 'none');
  document.getElementById('poll-placeholder')?.style.setProperty('display', 'none');
  document.getElementById('poll-results-zone')?.style.setProperty('display', 'block');
  document.getElementById('poll-new-btn')?.style.setProperty('display', meetingHasControlPower() && !live ? 'inline-flex' : 'none');
  const title = document.getElementById('poll-results-title');
  const bars = document.getElementById('poll-results-bars');
  const total = (poll.votes || []).reduce((a, b) => a + b, 0);
  if (title) title.textContent = `${live ? 'Sondage en cours' : 'Résultats'} — ${poll.question || ''}`;
  if (bars) bars.innerHTML = (poll.options || []).map((o, i) => {
    const count = poll.votes?.[i] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `<div class="poll-bar-wrap"><div class="poll-bar-label"><span>${escHtml(o)}</span><span>${count} vote${count!==1?'s':''} (${pct}%)</span></div>
      <div class="poll-bar-track"><div class="poll-bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
  pollUpdateHostControls(poll, !live);
}


function newPoll() {
  const question = document.getElementById('poll-question');
  const list = document.getElementById('poll-options-list');
  const choices = document.getElementById('poll-choices');
  const bars = document.getElementById('poll-results-bars');
  const status = document.getElementById('poll-host-status');
  const endBtn = document.getElementById('poll-end-btn');
  if (question) question.value = '';
  if (list) list.innerHTML = '';
  if (choices) choices.innerHTML = '';
  if (bars) bars.innerHTML = '';
  if (status) status.textContent = '';
  if (endBtn) endBtn.style.display = 'none';
  if (meetingHasControlPower()) {
    addPollOption();
    addPollOption();
  }
  pollResetZones();
}

function endPoll() {
  if (!MeetState.currentPoll) return;
  MeetState.socket?.emit('poll_end', { meetingId: MeetState.MEETING_ID, pollId: MeetState.currentPoll.id });
}


// ── AI Assistant ─────────────────────────────────────────────────────────────
function clearAIChat() {
  MeetState.aiMessages = [];
  const msgs = document.getElementById('ai-msgs');
  if (msgs) msgs.innerHTML = '';
}

// Convertit le markdown en HTML (bold, italic, code, listes, titres)
function markdownToHtml(md) {
  return md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // Titres
    .replace(/^### (.+)$/gm, '<div style="font-size:12px;font-weight:800;color:var(--text1);margin:10px 0 4px;">$1</div>')
    .replace(/^## (.+)$/gm,  '<div style="font-size:13px;font-weight:800;color:var(--text1);margin:10px 0 4px;">$1</div>')
    .replace(/^# (.+)$/gm,   '<div style="font-size:14px;font-weight:800;color:var(--text1);margin:10px 0 4px;">$1</div>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,      '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,           '<em>$1</em>')
    // Code inline
    .replace(/`([^`]+)`/g, '<code style="background:rgba(3,92,128,0.15);color:#4db8d8;padding:1px 5px;border-radius:4px;font-size:11px;font-family:monospace;">$1</code>')
    // Listes
    .replace(/^[\-\*] (.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0;"><span style="color:var(--accent);flex-shrink:0;">•</span><span>$1</span></div>')
    .replace(/^\d+\. (.+)$/gm, (m, p1, offset, str) => {
      const num = (str.slice(0, offset).match(/^\d+\./gm) || []).length + 1;
      return `<div style="display:flex;gap:6px;margin:2px 0;"><span style="color:var(--accent);flex-shrink:0;font-weight:700;">${num}.</span><span>${p1}</span></div>`;
    })
    // Séparateur
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">')
    // Sauts de ligne
    .replace(/\n\n/g, '<div style="height:6px;"></div>')
    .replace(/\n/g, '<br>');
}

function appendAIMsg(role, text) {
  const msgs = document.getElementById('ai-msgs');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;

  if (role === 'assistant') {
    div.innerHTML = `
      <div style="font-size:12px;line-height:1.7;">${markdownToHtml(text)}</div>
      <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end;">
        <button onclick="copyAIMsg(this)" data-text="${text.replace(/"/g,'&quot;')}"
          style="padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:10px;cursor:pointer;font-family:'Sora',sans-serif;">
          Copier
        </button>
        <button onclick="downloadAIMsg(this)" data-text="${text.replace(/"/g,'&quot;')}"
          style="padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:10px;cursor:pointer;font-family:'Sora',sans-serif;">
          ↓ Télécharger
        </button>
      </div>`;
  } else {
    div.innerHTML = `<div style="font-size:12px;line-height:1.7;">${markdownToHtml(text)}</div>`;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function copyAIMsg(btn) {
  const text = btn.dataset.text;
  navigator.clipboard.writeText(text).then(() => { btn.textContent = '✓ Copié'; setTimeout(() => btn.textContent = 'Copier', 2000); });
}

function downloadAIMsg(btn) {
  const text = btn.dataset.text;
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  a.download = 'reponse-ia-' + new Date().toISOString().slice(0,10) + '.txt';
  a.click();
}

async function sendAIMessage() {
  const inp = document.getElementById('ai-inp');
  const txt = inp?.value.trim();
  if (!txt) return;
  inp.value = '';
  appendAIMsg('user', txt);
  MeetState.aiMessages.push({ role: 'user', content: txt });
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-msg assistant loading';
  loadingDiv.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
  const msgs = document.getElementById('ai-msgs');
  if (msgs) { msgs.appendChild(loadingDiv); msgs.scrollTop = 99999; }
  try {
    const res = await fetch('/api/meetings/' + MeetState.MEETING_ID + '/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
      body: JSON.stringify({ messages: MeetState.aiMessages, context: { title: document.querySelector('.meet-name')?.textContent, duration: document.getElementById('meet-timer')?.textContent } }),
    });
    const data = await res.json();
    loadingDiv.remove();
    if (data.ok) { appendAIMsg('assistant', data.reply); MeetState.aiMessages.push({ role: 'assistant', content: data.reply }); }
    else appendAIMsg('assistant', 'Erreur — ' + (data.error || 'Erreur IA'));
  } catch(e) { loadingDiv.remove(); appendAIMsg('assistant', 'Erreur — Impossible de contacter l\'assistant IA'); }
}

async function generateSummary() {
  notify('IA • Génération du résumé en cours…');
  try {
    const chatMsgs = Array.from(document.querySelectorAll('.chat-msg')).map(el => ({ displayName: el.querySelector('.chat-msg-who')?.textContent || '', text: el.querySelector('.chat-msg-text')?.textContent || '' })).filter(m => m.text);
    const notes    = document.getElementById('notes-editor')?.value || '';
    const duration = document.getElementById('meet-timer')?.textContent || '';
    const parts    = Array.from(document.querySelectorAll('.peer-name')).map(el => el.textContent.replace(' (vous)', '').trim());
    const res = await fetch('/api/meetings/' + MeetState.MEETING_ID + '/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
      body: JSON.stringify({ chatMessages: chatMsgs, notes, duration, participants: parts }),
    });
    const data = await res.json();
    if (data.ok) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:20px;';
      overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:580px;max-height:80vh;overflow-y:auto;padding:28px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:800;color:var(--text1);">Résumé de la réunion</div>
          <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:20px;">×</button>
        </div>
        <div style="font-size:13px;color:var(--text2);line-height:1.8;white-space:pre-wrap;">${data.summary.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>
        <div style="margin-top:20px;display:flex;gap:10px;">
          <button onclick="navigator.clipboard.writeText(${JSON.stringify(data.summary)}).then(()=>notify('Copié !'))" style="flex:1;padding:10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;">Copier</button>
          <button onclick="const a=document.createElement('a');a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(${JSON.stringify(data.summary)});a.download='resume-reunion.txt';a.click();" style="flex:1;padding:10px;border-radius:9px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:600;cursor:pointer;">Télécharger</button>
        </div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      window.MeetAIExtras?.enhanceSummary(overlay, data.summary, duration);
    } else notify('Erreur — ' + (data.error || 'Erreur génération résumé'));
  } catch(e) { notify('Erreur — Erreur réseau'); }
}
