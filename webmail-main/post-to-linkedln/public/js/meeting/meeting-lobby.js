/**
 * meeting-lobby.js
 * Lobby, salle d'attente, cache session, contrôles mic/cam.
 */

// ── Cache session ─────────────────────────────────────────────────────────────
// Clé localStorage : meeting_session_{meetingId}
// Stocke : { displayName, approved }
function getSessionCache() {
  try {
    const raw = localStorage.getItem('meeting_session_' + MeetState.MEETING_ID);
    return raw ? JSON.parse(raw) : null;
  } catch(_) { return null; }
}

function setSessionCache(data) {
  try {
    localStorage.setItem('meeting_session_' + MeetState.MEETING_ID, JSON.stringify(data));
  } catch(_) {}
}

// ── Lobby init ────────────────────────────────────────────────────────────────
let _joinStarted = false; // Empêche les double-joins

async function initLobby() {
  const initials = (MeetState.USER_EMAIL || 'IN').split('@')[0].slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('lobby-avatar-init');
  if (avatarEl) avatarEl.textContent = initials;

  // Pré-remplir le nom depuis le cache
  const cache = getSessionCache();
  if (cache?.displayName) {
    const nameInp = document.getElementById('lobby-name');
    if (nameInp) nameInp.value = cache.displayName;
  }

  const camOff = document.getElementById('lobby-cam-off');
  const vid    = document.getElementById('lobby-video');

  if (vid) {
    vid.setAttribute('playsinline', '');
    vid.setAttribute('autoplay', '');
    vid.muted = true;
  }

  try {
    MeetState.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (vid) { vid.srcObject = MeetState.localStream; vid.play().catch(() => {}); }
    if (camOff) camOff.style.display = 'none';
    MeetState.micEnabled = true; MeetState.camEnabled = true;
  } catch(e) {
    try {
      MeetState.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      MeetState.micEnabled = true; MeetState.camEnabled = false;
    } catch(e2) {
      MeetState.localStream = null; MeetState.micEnabled = false; MeetState.camEnabled = false;
    }
    if (camOff) camOff.style.display = 'flex';
    if (vid) vid.style.display = 'none';
  }
  updateLobbyButtons();

  // Si session déjà approuvée → rejoindre directement sans passer par la salle d'attente
  // _joinStarted évite les doubles joins si initLobby est appelé plusieurs fois
  if (cache?.approved && !_joinStarted) {
    _joinStarted = true;
    setTimeout(() => joinRoom(true), 300);
  }
}

function toggleLobbyMic() {
  MeetState.micEnabled = !MeetState.micEnabled;
  if (MeetState.localStream) MeetState.localStream.getAudioTracks().forEach(t => t.enabled = MeetState.micEnabled);
  updateLobbyButtons();
}

function toggleLobbyCam() {
  MeetState.camEnabled = !MeetState.camEnabled;
  if (MeetState.localStream) MeetState.localStream.getVideoTracks().forEach(t => t.enabled = MeetState.camEnabled);
  const camOff = document.getElementById('lobby-cam-off');
  const vid    = document.getElementById('lobby-video');
  if (camOff) camOff.style.display = MeetState.camEnabled ? 'none' : 'flex';
  if (vid)    vid.style.display    = MeetState.camEnabled ? 'block' : 'none';
  updateLobbyButtons();
}

function updateLobbyButtons() {
  const mc = document.getElementById('lctrl-mic-btn');
  if (mc) mc.className = 'lctrl ' + (MeetState.micEnabled ? 'on' : 'off');
  const micOn  = document.getElementById('lmic-on');
  const micOff = document.getElementById('lmic-off');
  if (micOn)  micOn.style.display  = MeetState.micEnabled ? 'block' : 'none';
  if (micOff) micOff.style.display = MeetState.micEnabled ? 'none'  : 'block';
  const cc = document.getElementById('lctrl-cam-btn');
  if (cc) cc.className = 'lctrl ' + (MeetState.camEnabled ? 'on' : 'off');
  const camOn  = document.getElementById('lcam-on');
  const camOff = document.getElementById('lcam-off');
  if (camOn)  camOn.style.display  = MeetState.camEnabled ? 'block' : 'none';
  if (camOff) camOff.style.display = MeetState.camEnabled ? 'none'  : 'block';
  const ml = document.getElementById('lmic-label');
  const cl = document.getElementById('lcam-label');
  if (ml) { ml.textContent = MeetState.micEnabled ? 'Micro actif' : 'Micro coupé'; ml.style.color = MeetState.micEnabled ? 'rgba(255,255,255,0.6)' : '#f87171'; }
  if (cl) { cl.textContent = MeetState.camEnabled ? 'Caméra active' : 'Caméra désactivée'; cl.style.color = MeetState.camEnabled ? 'rgba(255,255,255,0.6)' : '#f87171'; }
}

// ── Rejoindre la salle ────────────────────────────────────────────────────────
// bypassWaiting=true quand reconnexion depuis cache session approuvée
async function joinRoom(bypassWaiting = false) {
  if (_joinStarted && !bypassWaiting) return; // Éviter double-join depuis le bouton
  _joinStarted = true;
  const btn = document.getElementById('btn-join');

  if (MeetState.NEEDS_CODE && !bypassWaiting) {
    const codeVal = (document.getElementById('lobby-code')?.value || '').trim();
    const errEl   = document.getElementById('code-err');
    if (!codeVal) {
      if (errEl) { errEl.textContent = 'Veuillez entrer le code d\'accès'; errEl.style.display = ''; }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
    try {
      const check = await fetch('/api/meetings/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' },
        body: JSON.stringify({ meetingId: MeetState.MEETING_ID, code: codeVal }),
      });
      const result = await check.json();
      if (!result.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Rejoindre la réunion'; }
        if (errEl) { errEl.textContent = result.error || 'Code incorrect'; errEl.style.display = ''; }
        return;
      }
      if (errEl) errEl.style.display = 'none';
    } catch(e) { if (btn) { btn.disabled = false; btn.textContent = 'Rejoindre la réunion'; } return; }
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Connexion…'; }

  const nameInp = document.getElementById('lobby-name');
  MeetState.displayName = nameInp?.value.trim() || (MeetState.IS_GUEST ? 'Invité' : MeetState.USER_EMAIL.split('@')[0]);

  // Sauvegarder le nom en cache
  setSessionCache({ displayName: MeetState.displayName, approved: false });

  if (!MeetState.localStream) {
    try { MeetState.localStream = await navigator.mediaDevices.getUserMedia({ video: MeetState.camEnabled, audio: true }); }
    catch(e) { MeetState.localStream = null; }
  }

  // Connecter le socket et émettre meeting_join
    // Connecter le socket et émettre meeting_join
  setupSocket(bypassWaiting, document.getElementById('lobby-message')?.value.trim() || '');
}

// ── Entrer dans la salle (après approbation ou direct) ────────────────────────
function enterRoom() {
  document.getElementById('lobby').style.display    = 'none';
  document.getElementById('waiting-room')?.remove();
  const isMobile = window.innerWidth <= 768;
  document.getElementById('room').style.display = isMobile ? 'grid' : 'flex';

  window._roomResizeHandler = () => {
    const room = document.getElementById('room');
    if (room && room.style.display !== 'none')
      room.style.display = window.innerWidth <= 768 ? 'grid' : 'flex';
  };
  window.addEventListener('resize', window._roomResizeHandler);

  addTile('local', MeetState.USER_EMAIL, MeetState.displayName, MeetState.localStream, true);

  const micBtn = document.getElementById('btn-mic'); if (micBtn) micBtn.className = 'ctrl-btn ' + (MeetState.micEnabled ? 'active' : 'inactive');
  const camBtn = document.getElementById('btn-cam'); if (camBtn) camBtn.className = 'ctrl-btn ' + (MeetState.camEnabled ? 'active' : 'inactive');
  ['mic-on-ico','mic-off-ico','cam-on-ico','cam-off-ico'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    if (id === 'mic-on-ico')  el.style.display = MeetState.micEnabled ? 'block' : 'none';
    if (id === 'mic-off-ico') el.style.display = MeetState.micEnabled ? 'none'  : 'block';
    if (id === 'cam-on-ico')  el.style.display = MeetState.camEnabled ? 'block' : 'none';
    if (id === 'cam-off-ico') el.style.display = MeetState.camEnabled ? 'none'  : 'block';
  });
  const localTileInit = document.getElementById('tile-local');
  if (localTileInit && !MeetState.camEnabled) localTileInit.classList.add('cam-off');
  const mutedInit = document.getElementById('muted-local');
  if (mutedInit && !MeetState.micEnabled) mutedInit.classList.add('show');

  renderMeetingTimer?.();
  meetingApplyAdaptiveRecordingUI();
  startAudioDiagnosticsLoop?.();
  setTimeout(initSpeechTimers, 1000);
}

// ── Salle d'attente UI ────────────────────────────────────────────────────────
function showWaitingRoom(meta = {}) {
  document.getElementById('lobby').style.display = 'none';
  // Créer l'écran d'attente
  const div = document.createElement('div');
  div.id = 'waiting-room';
  div.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:200;flex-direction:column;gap:20px;';
  div.innerHTML = `
    <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <div style="text-align:center;">
      <div style="font-size:20px;font-weight:800;color:var(--text1);margin-bottom:8px;">Salle d'attente</div>
      <div style="font-size:14px;color:var(--muted);">L'organisateur va vous admettre dans quelques instants…</div>
      ${meta.joinedAt ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">Arrivée: ${new Date(meta.joinedAt).toLocaleTimeString()}</div>` : ''}
      ${meta.message ? `<div style="font-size:12px;color:var(--text2);margin-top:8px;max-width:420px;">Message: ${escHtml(meta.message)}</div>` : ''}
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);animation:waitPulse 1.4s infinite;"></div>
      <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);animation:waitPulse 1.4s .2s infinite;"></div>
      <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);animation:waitPulse 1.4s .4s infinite;"></div>
    </div>
    <style>@keyframes waitPulse{0%,100%{opacity:.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}</style>`;
  document.body.appendChild(div);
}

// ── Panneau d'attente pour l'hôte ─────────────────────────────────────────────
// Son de notification
function playKnockSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch(_) {}
}

function renderWaitingList(waitList) {
  MeetState.waitingList = Array.isArray(waitList) ? waitList.slice() : [];
  const panel = document.getElementById('waiting-panel');
  const badge = document.getElementById('waiting-badge');
  const list  = document.getElementById('waiting-list');
  if (!panel || !list) return;

  if (!waitList.length) {
    panel.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  if (badge) { badge.style.display = 'flex'; badge.textContent = waitList.length; }

  renderAdminPanel?.();

  list.innerHTML = waitList.map(w => `
    <div class="waiting-entry" id="we-${w.socketId}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:white;flex-shrink:0;">
        ${escHtml((w.displayName||'?').slice(0,2).toUpperCase())}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(w.displayName)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(w.email)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button onclick="MeetApp.admitWaiting('${w.socketId}')"
          style="padding:6px 12px;border-radius:8px;border:none;background:var(--green);color:white;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">
          Admettre
        </button>
        <button onclick="MeetApp.rejectWaiting('${w.socketId}')"
          style="padding:6px 12px;border-radius:8px;border:none;background:rgba(248,113,113,0.2);color:var(--red);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">
          Refuser
        </button>
      </div>
    </div>`).join('');
}

function admitWaiting(socketId) {
  MeetState.socket?.emit('waiting_room_admit', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
  MeetState.waitingList = (MeetState.waitingList || []).filter(w => w.socketId !== socketId);
  renderAdminPanel?.();
  document.getElementById('we-' + socketId)?.remove();
  const list = document.getElementById('waiting-list');
  if (list && !list.children.length) {
    document.getElementById('waiting-panel').style.display = 'none';
    const badge = document.getElementById('waiting-badge');
    if (badge) badge.style.display = 'none';
  }
}

function rejectWaiting(socketId) {
  MeetState.socket?.emit('waiting_room_reject', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
  MeetState.waitingList = (MeetState.waitingList || []).filter(w => w.socketId !== socketId);
  renderAdminPanel?.();
  document.getElementById('we-' + socketId)?.remove();
  const list = document.getElementById('waiting-list');
  if (list && !list.children.length) {
    document.getElementById('waiting-panel').style.display = 'none';
    const badge = document.getElementById('waiting-badge');
    if (badge) badge.style.display = 'none';
  }
}



//function de diagnostique
function startAudioDiagnosticsLoop() {
  if (MeetState.audioDiagTimer) clearInterval(MeetState.audioDiagTimer);

  MeetState.audioDiagTimer = setInterval(() => {
    const activePeerIds = new Set(Object.keys(MeetState.peers || {}));
    Object.keys(MeetState.audioDiagnostics || {}).forEach(peerId => {
      if (!activePeerIds.has(peerId)) delete MeetState.audioDiagnostics[peerId];
    });

    Object.entries(MeetState.peers || {}).forEach(([peerId, peer]) => {
      const pc = peer?.pc;
      if (pc) collectPeerAudioStats(peerId, pc);
    });

    renderParticipationPanel?.();
  }, 5000);
}
