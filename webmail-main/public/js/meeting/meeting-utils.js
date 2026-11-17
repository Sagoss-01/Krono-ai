/**
 * meeting-utils.js
 * Fonctions utilitaires partagées : notifications, helpers, timer, thème.
 */

// ── Contexte audio partagé pour les sons déclenchés par le réseau ──────────
// Bug corrigé : chaque son de notification (applaudissements, alerte de
// prolongation, "toc-toc" de la salle d'attente...) créait son propre
// `new AudioContext()` à chaque appel. Or les navigateurs démarrent un
// AudioContext en état "suspended" tant qu'il n'a pas été créé/relancé
// pendant un vrai geste utilisateur (clic, touche...). Un son déclenché par
// un événement socket (donc SANS clic de la personne qui l'entend) restait
// donc silencieux — c'est pour ça que l'hôte entendait ses propres sons
// (déclenchés par son clic) mais pas les autres participants (qui reçoivent
// l'événement sans avoir cliqué au même moment).
// Solution : un seul contexte, créé/débloqué dès le tout premier geste de
// la personne sur la page (n'importe quel clic), puis réutilisé pour tous
// les sons suivants — y compris ceux déclenchés à distance.
let _sharedAudioCtx = null;
function getSharedAudioCtx() {
  if (!_sharedAudioCtx) {
    _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}
['click', 'keydown', 'touchstart'].forEach((evt) => {
  document.addEventListener(evt, () => { try { getSharedAudioCtx(); } catch (_) {} }, { once: true, passive: true });
});

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function notify(msg) {
  const n   = document.getElementById('meet-notifs');
  if (!n) return;
  const div = document.createElement('div');
  div.className = 'meet-notif';
  div.textContent = msg;
  n.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function flyEmoji(emoji, x, y) {
  const el = document.createElement('div');
  el.className = 'flying-emoji';
  el.textContent = emoji;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function renderMeetingTimer() {
  const el = document.getElementById('meet-timer');
  if (!el) return;
  if (!MeetState.startTime) {
    el.textContent = '00:00:00';
    return;
  }
  const s = Math.max(0, Math.floor((Date.now() - MeetState.startTime) / 1000));
  const m = Math.floor(s / 60);
  el.textContent =
    String(Math.floor(m / 60)).padStart(2, '0') + ':' +
    String(m % 60).padStart(2, '0') + ':' +
    String(s % 60).padStart(2, '0');
}

function startTimer(serverStartedAt = null, expiresAt = null) {
  if (serverStartedAt) MeetState.startTime = new Date(serverStartedAt).getTime();
  else if (!MeetState.startTime) MeetState.startTime = Date.now();
  if (expiresAt) MeetState.meetingExpiresAt = new Date(expiresAt).getTime();
  if (MeetState.timerInterval) clearInterval(MeetState.timerInterval);
  MeetState.timerStarted = true;
  renderMeetingTimer();
  MeetState.timerInterval = setInterval(renderMeetingTimer, 1000);
}

function syncMeetingTimer(payload = {}) {
  const startedAt = payload.startedAt || payload.startTime || null;
  const expiresAt = payload.expiresAt || null;
  if (!startedAt) return;
  startTimer(startedAt, expiresAt);
}

function applyMeetTheme(t) {
  document.getElementById('meeting-html').setAttribute('data-theme', t);
  const sun   = document.getElementById('theme-sun');
  const moon  = document.getElementById('theme-moon');
  const label = document.getElementById('theme-label');
  if (t === 'dark') {
    if (sun)   sun.style.display  = 'none';
    if (moon)  moon.style.display = 'block';
    if (label) label.textContent  = 'Clair';
  } else {
    if (sun)   sun.style.display  = 'block';
    if (moon)  moon.style.display = 'none';
    if (label) label.textContent  = 'Sombre';
  }
}

function toggleTheme() {
  const html    = document.getElementById('meeting-html');
  const current = html.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ts_theme', next);
  applyMeetTheme(next);
}

function showInfo() {
  const link = window.location.href;
  document.getElementById('info-link').textContent = link;
  if (MeetState.MEETING_CODE) {
    document.getElementById('info-code-row').style.display = '';
    document.getElementById('info-code').textContent = MeetState.MEETING_CODE;
  }
  const qrImg = document.getElementById('info-qr-img');
  const qrLink = document.getElementById('info-qr-open');
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(link);
  if (qrImg) {
    qrImg.src = qrUrl;
    qrImg.alt = 'QR code de la réunion';
  }
  if (qrLink) qrLink.href = link;
  document.getElementById('info-modal').classList.add('open');
}

function copy(type) {
  const txt = type === 'link' ? window.location.href : MeetState.MEETING_CODE;
  navigator.clipboard.writeText(txt).then(() => notify('Copié dans le presse-papiers'));
}

function copyMeetingLink() {
  navigator.clipboard.writeText(window.location.href).then(() => notify('Lien copié !'));
}

function updatePeerCount() {
  const grid = document.getElementById('video-grid');
  const n = Array.from(grid.querySelectorAll('.peer-tile')).length;
  const el = document.getElementById('peer-count');
  if (el) el.textContent = n + ' participant' + (n > 1 ? 's' : '');
}

function meetingIsIOSLike() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const touchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || touchMac;
}

function meetingIsMobileDevice() {
  return meetingIsIOSLike() || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || window.innerWidth <= 768;
}

function meetingHasControlPower() {
  return !!(MeetState.IS_HOST || MeetState.IS_CATALYST);
}

function meetingApplyControlPowerUI() {
  const enabled = meetingHasControlPower();
  const popcornWrap = document.getElementById('ctrl-popcorn-wrap');
  const quizWrap = document.getElementById('ctrl-quiz-wrap');
  const participationWrap = document.getElementById('ctrl-participation-wrap');
  const adminWrap = document.getElementById('ctrl-admin-wrap');
  if (popcornWrap) popcornWrap.style.display = enabled ? '' : 'none';
  if (quizWrap) quizWrap.style.display = enabled ? '' : 'none';
  if (participationWrap) participationWrap.style.display = enabled ? '' : 'none';
  if (adminWrap) adminWrap.style.display = enabled ? '' : 'none';
  if (!enabled) { closeParticipationPanel?.(); closeAdminPanel?.(); }

  document.querySelectorAll('.peer-tile').forEach(tile => {
    const id = tile.id.replace('tile-', '');
    const isLocal = id === 'local';
    let muteBtn = document.getElementById('hostmute-' + id);
    if (enabled && !isLocal) {
      if (!muteBtn) {
        const label = tile.querySelector('.peer-label');
        if (label) {
          label.insertAdjacentHTML('beforeend', `<button class="host-mute-btn" id="hostmute-${id}" onclick="MeetApp.hostMutePeer('${id}')" title="Couper le micro"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg></button>`);
        }
      }
    } else if (muteBtn) {
      muteBtn.remove();
    }
  });
}


function meetingRoleLabel() {
  if (MeetState.IS_HOST) return 'Hôte';
  if (MeetState.IS_CATALYST) return 'Catalyst';
  return 'Participant';
}

function playPremiumChime() {
  try {
    const ctx = getSharedAudioCtx();
    const notes = [659.25, 880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle';
      const t = ctx.currentTime + idx * 0.10;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t); osc.stop(t + 0.36);
    });
  } catch (_) {}
}

function meetingApplyAdaptiveRecordingUI() {
  const btn = document.getElementById('btn-rec') || document.getElementById('btn-record');
  if (!btn) return;
  if (meetingIsIOSLike()) {
    btn.dataset.mobileFallback = '1';
    btn.title = 'Enregistrement caméra + micro';
  }
  meetingApplyControlPowerUI();
}

function toggleCatalyst(socketId) {
  if (!MeetState.IS_HOST) return notify("Seul l'hôte peut attribuer les clés Catalyst");
  const current = !!MeetState.peerMeta[socketId]?.isCatalyst;
  MeetState.socket?.emit('meeting_role_set', {
    meetingId: MeetState.MEETING_ID,
    targetSocketId: socketId,
    enabled: !current,
  });
}


function playAlertTone() {
  try {
    const ctx = getSharedAudioCtx();
    [880, 740, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + idx * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + idx * 0.22 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.22 + 0.26);
      osc.start(ctx.currentTime + idx * 0.22);
      osc.stop(ctx.currentTime + idx * 0.22 + 0.28);
    });
  } catch (_) {}
}

function formatMsDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function meetingNormalizeParticipantKey(row = {}) {
  const email = String(row.email || '').trim().toLowerCase();
  const displayName = String(row.displayName || row.name || '').trim().toLowerCase();
  const socketId = String(row.socketId || '').trim();
  if (email && !email.startsWith('guest-')) return 'email:' + email;
  if (displayName) return 'name:' + displayName;
  if (email) return 'guest:' + email;
  if (socketId) return 'socket:' + socketId;
  return 'unknown:' + Math.random().toString(36).slice(2);
}

function meetingMergeParticipationStats(stats = []) {
  const merged = new Map();
  (Array.isArray(stats) ? stats : []).forEach((row, index) => {
    const key = meetingNormalizeParticipantKey(row);
    const prev = merged.get(key);
    merged.set(key, {
      socketId: row.socketId || prev?.socketId || '',
      email: row.email || prev?.email || '',
      displayName: row.displayName || row.name || prev?.displayName || prev?.name || 'Participant',
      handRaises: Math.max(Number(prev?.handRaises || 0), Number(row.handRaises || 0)),
      speechTurns: Math.max(Number(prev?.speechTurns || 0), Number(row.speechTurns || 0)),
      speakingMs: Math.max(Number(prev?.speakingMs || 0), Number(row.speakingMs || 0)),
      _order: prev?._order ?? index,
    });
  });
  return Array.from(merged.values()).sort((a, b) => a._order - b._order);
}

function meetingFormatMetricValue(value, unit = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (typeof value === 'number') {
    if (unit === 's') return `${value.toFixed(3)} s`;
    if (unit === 'bps') return `${Math.round(value / 1000)} kb/s`;
  }
  return String(value);
}

function meetingConnectionQuality(diag = {}) {
  const rtt = Number(diag?.remoteInboundAudio?.roundTripTime ?? diag?.selectedPair?.currentRoundTripTime ?? NaN);
  const lost = Number(diag?.inboundAudio?.packetsLost ?? NaN);
  const jitter = Number(diag?.inboundAudio?.jitter ?? diag?.remoteInboundAudio?.jitter ?? NaN);
  if (Number.isNaN(rtt) && Number.isNaN(lost) && Number.isNaN(jitter)) return { label: 'Aucune mesure', color: 'var(--muted)' };
  if ((!Number.isNaN(rtt) && rtt > 0.40) || (!Number.isNaN(lost) && lost >= 20) || (!Number.isNaN(jitter) && jitter > 0.04)) return { label: 'Mauvais', color: 'var(--red)' };
  if ((!Number.isNaN(rtt) && rtt >= 0.15) || (!Number.isNaN(lost) && lost > 0) || (!Number.isNaN(jitter) && jitter > 0.02)) return { label: 'Moyen', color: 'var(--yellow)' };
  return { label: 'Bon', color: 'var(--green)' };
}

function meetingResolveMetricIdentity(socketId) {
  const meta = MeetState.peerMeta?.[socketId] || MeetState.peers?.[socketId] || {};
  const email = String(meta.email || '').trim();
  const displayName = String(meta.name || meta.displayName || email || 'Participant').trim();
  const key = meetingNormalizeParticipantKey({ email, displayName, socketId });
  return { key, socketId, email, displayName };
}

function meetingCurrentParticipantKeys() {
  const keys = new Set();
  keys.add(meetingNormalizeParticipantKey({ email: MeetState.USER_EMAIL, displayName: MeetState.displayName || MeetState.USER_EMAIL }));
  Object.entries(MeetState.peerMeta || {}).forEach(([socketId, meta]) => {
    keys.add(meetingNormalizeParticipantKey({ email: meta?.email || '', displayName: meta?.name || meta?.displayName || '', socketId }));
  });
  return keys;
}

function meetingBuildMetricsRows() {
  const seen = new Map();
  Object.entries(MeetState.audioDiagnostics || {}).forEach(([socketId, diag]) => {
    if (!MeetState.peers?.[socketId]) return;
    const identity = meetingResolveMetricIdentity(socketId);
    if (!identity.displayName) return;
    const current = seen.get(identity.key);
    const score = Number(diag?.at || 0);
    if (!current || score >= current._score) seen.set(identity.key, { ...identity, diag, _score: score });
  });
  return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }));
}

async function meetingApplyBitrateMode(reduced) {
  for (const [socketId, peer] of Object.entries(MeetState.peers || {})) {
    const pc = peer?.pc;
    if (!pc) continue;
    const videoSenders = pc.getSenders().filter(sender => sender.track?.kind === 'video');
    for (const sender of videoSenders) {
      try {
        const params = sender.getParameters ? sender.getParameters() : {};
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        if (!MeetState.defaultSenderParams[socketId]) MeetState.defaultSenderParams[socketId] = {};
        const senderKey = sender.track?.id || `video-${socketId}`;
        if (!MeetState.defaultSenderParams[socketId][senderKey]) {
          MeetState.defaultSenderParams[socketId][senderKey] = {
            maxBitrate: params.encodings[0].maxBitrate,
            maxFramerate: params.encodings[0].maxFramerate,
            scaleResolutionDownBy: params.encodings[0].scaleResolutionDownBy,
          };
        }
        if (reduced) {
          params.encodings[0].maxBitrate = 250000;
          params.encodings[0].maxFramerate = 12;
          params.encodings[0].scaleResolutionDownBy = 1.5;
        } else {
          const defaults = MeetState.defaultSenderParams[socketId][senderKey] || {};
          if (defaults.maxBitrate == null) delete params.encodings[0].maxBitrate;
          else params.encodings[0].maxBitrate = defaults.maxBitrate;
          if (defaults.maxFramerate == null) delete params.encodings[0].maxFramerate;
          else params.encodings[0].maxFramerate = defaults.maxFramerate;
          if (defaults.scaleResolutionDownBy == null) delete params.encodings[0].scaleResolutionDownBy;
          else params.encodings[0].scaleResolutionDownBy = defaults.scaleResolutionDownBy;
        }
        await sender.setParameters(params);
      } catch (err) {
        console.warn('[Bitrate]', err);
      }
    }
  }
}

async function toggleBitrateReduction() {
  const nextState = !MeetState.bitrateReduced;
  const btn = document.getElementById('bitrate-toggle-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = nextState ? 'Activation…' : 'Restauration…';
  }
  await meetingApplyBitrateMode(nextState);
  MeetState.bitrateReduced = nextState;
  notify(nextState ? 'Mode connexion dégradée activé' : 'Bitrate normal restauré');
  renderParticipationPanel();
}

function switchParticipationTab(tab) {
  MeetState.participationTab = tab;
  renderParticipationPanel();
}

function openParticipationPanel() {
  MeetState.participationOpen = true;
  document.getElementById('participation-panel')?.classList.add('open');
  MeetState.socket?.emit('participation_get', { meetingId: MeetState.MEETING_ID });
  renderParticipationPanel();
}

function closeParticipationPanel() {
  MeetState.participationOpen = false;
  document.getElementById('participation-panel')?.classList.remove('open');
}

function toggleParticipationPanel() {
  if (MeetState.participationOpen) closeParticipationPanel();
  else openParticipationPanel();
}

function renderParticipationPanel() {
  const body = document.getElementById('participation-body');
  if (!body) return;
  document.querySelectorAll('#participation-panel .meet-side-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === MeetState.participationTab);
  });
  if (MeetState.participationTab === 'metrics') return renderMetricsPanelBody();
  if (MeetState.participationTab === 'network') return renderBitratePanelBody();
  return renderParticipationStats(MeetState.participationStats || []);
}

function renderParticipationStats(stats = []) {
  const mergedStats = meetingMergeParticipationStats(stats);
  const activeKeys = meetingCurrentParticipantKeys();
  MeetState.participationStats = mergedStats.filter(row => activeKeys.has(meetingNormalizeParticipantKey(row)));
  const body = document.getElementById('participation-body');
  if (!body) return;
  if (!MeetState.participationStats.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucune donnée de participation pour le moment.</div>`;
    return;
  }
  body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="position:sticky;top:0;background:var(--bg2);">
        <th style="text-align:left;padding:8px;color:var(--muted);font-size:11px;">Participant</th>
        <th style="text-align:center;padding:8px;color:var(--muted);font-size:11px;">✋</th>
        <th style="text-align:center;padding:8px;color:var(--muted);font-size:11px;">🎙</th>
        <th style="text-align:right;padding:8px;color:var(--muted);font-size:11px;">Temps</th>
      </tr>
    </thead>
    <tbody>
      ${MeetState.participationStats.map(row => `
        <tr>
          <td style="padding:9px 8px;border-top:1px solid var(--border);color:var(--text1);font-weight:600;">${escHtml(row.displayName || row.email || 'Participant')}</td>
          <td style="padding:9px 8px;border-top:1px solid var(--border);text-align:center;color:var(--text2);">${row.handRaises || 0}</td>
          <td style="padding:9px 8px;border-top:1px solid var(--border);text-align:center;color:var(--text2);">${row.speechTurns || 0}</td>
          <td style="padding:9px 8px;border-top:1px solid var(--border);text-align:right;color:var(--accent);font-weight:700;">${formatMsDuration(row.speakingMs || 0)}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderMetricsPanelBody() {
  const body = document.getElementById('participation-body');
  if (!body) return;
  const rows = [
    { socketId: 'local', email: MeetState.USER_EMAIL, displayName: (MeetState.displayName || 'Vous'), diag: MeetState.audioDiagnostics?.local || {} },
    ...meetingBuildMetricsRows()
  ];
  if (!rows.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucune métrique distante pour le moment.</div>`;
    return;
  }
  body.innerHTML = rows.map(row => {
    const diag = row.diag || {};
    const quality = meetingConnectionQuality(diag);
    const iceType = diag?.selectedPair?.localType || diag?.selectedPair?.remoteType || '—';
    const connState = diag?.connectionState || diag?.iceConnectionState || 'inconnu';
    const rtt = diag?.remoteInboundAudio?.roundTripTime ?? diag?.selectedPair?.currentRoundTripTime ?? null;
    const lost = diag?.inboundAudio?.packetsLost ?? null;
    const jitter = diag?.inboundAudio?.jitter ?? diag?.remoteInboundAudio?.jitter ?? null;
    return `<div style="border:1px solid var(--border);border-radius:14px;padding:12px 13px;margin-bottom:10px;background:var(--bg2);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:800;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(row.displayName)}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(row.email || row.socketId)}</div>
        </div>
        <span style="flex-shrink:0;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.04);color:${quality.color};font-size:11px;font-weight:800;border:1px solid var(--border);">${quality.label}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;font-size:12px;">
        <div><div style="color:var(--muted);font-size:11px;">ICE sélectionné</div><div style="color:var(--text1);font-weight:700;">${escHtml(iceType)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">État de connexion</div><div style="color:var(--text1);font-weight:700;">${escHtml(connState)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">RTT</div><div style="color:var(--text1);font-weight:700;">${meetingFormatMetricValue(rtt, 's')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Packets lost</div><div style="color:var(--text1);font-weight:700;">${meetingFormatMetricValue(lost)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Jitter</div><div style="color:var(--text1);font-weight:700;">${meetingFormatMetricValue(jitter, 's')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Débit sortant</div><div style="color:var(--text1);font-weight:700;">${meetingFormatMetricValue(diag?.selectedPair?.availableOutgoingBitrate, 'bps')}</div></div>
      </div>
    </div>`;
  }).join('');
}

function renderBitratePanelBody() {
  const body = document.getElementById('participation-body');
  if (!body) return;
  const stateColor = MeetState.bitrateReduced ? 'var(--yellow)' : 'var(--green)';
  const stateLabel = MeetState.bitrateReduced ? 'Réduit' : 'Normal';
  const buttonLabel = MeetState.bitrateReduced ? 'Éteindre' : 'Allumer';
  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;padding:4px 2px;">
    <div style="border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--bg2);">
      <div style="font-size:13px;font-weight:800;color:var(--text1);margin-bottom:6px;">Mode connexion dégradée</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:12px;">Réduit le bitrate vidéo sortant, le framerate et la résolution pour stabiliser la réunion quand la connexion devient mauvaise.</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;color:var(--text2);font-weight:700;">État actuel</div>
          <div style="font-size:12px;color:${stateColor};font-weight:800;">${stateLabel}</div>
        </div>
        <button id="bitrate-toggle-btn" onclick="MeetApp.toggleBitrateReduction()" style="padding:10px 14px;border:none;border-radius:10px;background:${MeetState.bitrateReduced ? 'rgba(248,113,113,.18)' : 'rgba(34,197,94,.18)'};color:${MeetState.bitrateReduced ? 'var(--red)' : 'var(--green)'};font-size:12px;font-weight:800;cursor:pointer;">${buttonLabel}</button>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--bg2);font-size:12px;color:var(--muted);line-height:1.6;">
      <div style="font-weight:800;color:var(--text2);margin-bottom:6px;">Réglages appliqués</div>
      <div>• maxBitrate vidéo ≈ 250 kb/s</div>
      <div>• maxFramerate vidéo = 12 fps</div>
      <div>• réduction de résolution via scaleResolutionDownBy = 1.5</div>
    </div>
  </div>`;
}

function showMeetingExtensionPrompt(expiresAt) {
  if (!(MeetState.IS_HOST || MeetState.IS_CATALYST)) return;
  if (MeetState.extensionPromptFor === expiresAt) return;
  MeetState.extensionPromptFor = expiresAt;
  document.getElementById('meeting-extension-toast')?.remove();
  playAlertTone();
  const box = document.createElement('div');
  box.id = 'meeting-extension-toast';
  box.style.cssText = 'position:fixed;right:20px;bottom:96px;z-index:10040;width:340px;max-width:calc(100vw - 24px);background:var(--bg2);border:1px solid rgba(245,158,11,.35);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:16px;';
  box.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px;">
    <div style="width:42px;height:42px;border-radius:12px;background:rgba(245,158,11,.14);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#f59e0b;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:14px;font-weight:800;color:var(--text1);margin-bottom:4px;">La réunion arrive à échéance</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:12px;">Sans prolongation, la session se coupera automatiquement dans 5 minutes.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="MeetApp.extendMeeting(10)" style="padding:8px 10px;border:none;border-radius:10px;background:rgba(3,92,128,.16);color:var(--accent);font-weight:700;cursor:pointer;">+10 min</button>
        <button onclick="MeetApp.extendMeeting(15)" style="padding:8px 10px;border:none;border-radius:10px;background:rgba(3,92,128,.16);color:var(--accent);font-weight:700;cursor:pointer;">+15 min</button>
        <button onclick="MeetApp.extendMeeting(30)" style="padding:8px 10px;border:none;border-radius:10px;background:rgba(3,92,128,.16);color:var(--accent);font-weight:700;cursor:pointer;">+30 min</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(box);
}

function dismissMeetingExtensionPrompt() {
  document.getElementById('meeting-extension-toast')?.remove();
}


function switchAdminTab(tab) {
  const allowed = ['participants','waiting','permissions','logs','queue'];
  MeetState.adminTab = allowed.includes(tab) ? tab : 'participants';
  renderAdminPanel();
}

function openAdminPanel() {
  if (!meetingHasControlPower()) return;
  MeetState.adminOpen = true;
  document.getElementById('admin-panel')?.classList.add('open');
  renderAdminPanel();
}

function closeAdminPanel() {
  MeetState.adminOpen = false;
  document.getElementById('admin-panel')?.classList.remove('open');
}

function toggleAdminPanel() {
  if (MeetState.adminOpen) closeAdminPanel();
  else openAdminPanel();
}

function meetingAdminParticipantsRows() {
  const rows = [];
  rows.push({
    socketId: 'local',
    email: MeetState.USER_EMAIL || '',
    displayName: (MeetState.displayName || MeetState.USER_EMAIL || 'Moi').trim(),
    isHost: !!MeetState.IS_HOST,
    isCatalyst: !!MeetState.IS_CATALYST,
    mine: true,
  });
  Object.entries(MeetState.peerMeta || {}).forEach(([socketId, meta]) => {
    rows.push({
      socketId,
      email: meta?.email || '',
      displayName: meta?.name || meta?.displayName || meta?.email || 'Participant',
      isHost: false,
      isCatalyst: !!meta?.isCatalyst,
      mine: false,
    });
  });
  return rows;
}

function renderAdminParticipantsTab() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  const actionable = meetingAdminParticipantsRows().filter(row => !row.mine && !row.isHost);
  if (!actionable.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucun participant à gérer pour le moment.</div>`;
    return;
  }
  body.innerHTML = actionable.map(row => {
    const roleBadge = row.isCatalyst
      ? `<span style="padding:3px 8px;border-radius:999px;background:rgba(139,92,246,.14);color:#a78bfa;font-size:10px;font-weight:800;">Catalyst</span>`
      : `<span style="padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:var(--muted);font-size:10px;font-weight:800;">Participant</span>`;
    return `<div style="border:1px solid var(--border);border-radius:14px;padding:12px 13px;margin-bottom:10px;background:var(--bg2);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:800;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(row.displayName)}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(row.email || row.socketId)}</div>
        </div>
        ${roleBadge}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="MeetApp.moveParticipantToWaiting('${row.socketId}')" style="padding:7px 10px;border-radius:9px;border:none;background:rgba(245,158,11,.15);color:#f59e0b;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Salle d'attente</button>
        <button onclick="MeetApp.removeParticipant('${row.socketId}')" style="padding:7px 10px;border-radius:9px;border:none;background:rgba(248,113,113,.15);color:var(--red);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Retirer</button>
        <button onclick="MeetApp.tempExpelParticipant('${row.socketId}','10')" style="padding:7px 10px;border-radius:9px;border:none;background:rgba(245,158,11,.18);color:#fcd34d;font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">Expulser 10 min</button>
        <button onclick="MeetApp.banParticipant('${row.socketId}')" style="padding:7px 10px;border-radius:9px;border:1px solid rgba(220,38,38,.28);background:rgba(220,38,38,.18);color:#fecaca;font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">Bannir</button>
      </div>
    </div>`;
  }).join('');
}

function renderAdminWaitingTab() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  const rows = Array.isArray(MeetState.waitingList) ? MeetState.waitingList : [];
  if (!rows.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Personne en salle d'attente.</div>`;
    return;
  }
  body.innerHTML = rows.map(row => `
    <div style="border:1px solid var(--border);border-radius:14px;padding:12px 13px;margin-bottom:10px;background:var(--bg2);">
      <div style="font-size:13px;font-weight:800;color:var(--text1);margin-bottom:4px;">${escHtml(row.displayName || 'Participant')}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${escHtml(row.email || row.socketId || '')}</div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Arrivée: ${row.joinedAt ? new Date(row.joinedAt).toLocaleTimeString() : '—'} • Tentatives: ${row.attempts || 1}</div>
      ${row.message ? `<div style="font-size:11px;color:var(--text2);margin-bottom:10px;">Message: ${escHtml(row.message)}</div>` : '<div style="margin-bottom:10px;"></div>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="MeetApp.admitWaiting('${row.socketId}')" style="padding:7px 10px;border-radius:9px;border:none;background:var(--green);color:white;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Admettre</button>
        <button onclick="MeetApp.rejectWaiting('${row.socketId}')" style="padding:7px 10px;border-radius:9px;border:none;background:rgba(248,113,113,.15);color:var(--red);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Refuser</button>
      </div>
    </div>`).join('');
}


function meetingPermissionLabel(flag, yes='Autorisé', no='Bloqué') { return flag === false ? no : yes; }

function renderAdminPermissionsTab() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  const rows = meetingAdminParticipantsRows().filter(row => !row.mine && !row.isHost);
  if (!rows.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucun participant à gérer pour le moment.</div>`;
    return;
  }
  body.innerHTML = rows.map(row => {
    const perms = MeetState.participantPermissions[row.socketId] || {};
    return `<div style="border:1px solid var(--border);border-radius:14px;padding:12px 13px;margin-bottom:10px;background:var(--bg2);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div><div style="font-size:13px;font-weight:800;color:var(--text1);">${escHtml(row.displayName)}</div><div style="font-size:11px;color:var(--muted);">${escHtml(row.email || row.socketId)}</div></div>
        <button onclick="MeetApp.allowParticipantToSpeak('${row.socketId}')" style="padding:7px 10px;border:none;border-radius:9px;background:rgba(34,197,94,.14);color:var(--green);font-size:11px;font-weight:800;cursor:pointer;">Autoriser à parler</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
        <button onclick="MeetApp.toggleParticipantPermission('${row.socketId}','forceMuted')" style="padding:8px;border:none;border-radius:10px;background:rgba(248,113,113,.14);color:var(--red);font-size:11px;font-weight:700;cursor:pointer;">${perms.forceMuted ? 'Déverrouiller micro' : 'Verrouiller micro'}</button>
        <button onclick="MeetApp.toggleParticipantPermission('${row.socketId}','canUseCamera')" style="padding:8px;border:none;border-radius:10px;background:rgba(59,130,246,.14);color:#93c5fd;font-size:11px;font-weight:700;cursor:pointer;">Caméra: ${meetingPermissionLabel(perms.canUseCamera)}</button>
        <button onclick="MeetApp.toggleParticipantPermission('${row.socketId}','canShareScreen')" style="padding:8px;border:none;border-radius:10px;background:rgba(168,85,247,.14);color:#d8b4fe;font-size:11px;font-weight:700;cursor:pointer;">Écran: ${meetingPermissionLabel(perms.canShareScreen)}</button>
        <button onclick="MeetApp.toggleParticipantPermission('${row.socketId}','canChat')" style="padding:8px;border:none;border-radius:10px;background:rgba(245,158,11,.14);color:#fbbf24;font-size:11px;font-weight:700;cursor:pointer;">Chat: ${meetingPermissionLabel(perms.canChat)}</button>
        <button onclick="MeetApp.toggleParticipantPermission('${row.socketId}','readOnly')" style="padding:8px;border:none;border-radius:10px;background:rgba(255,255,255,.06);color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;grid-column:span 2;">${perms.readOnly ? 'Retirer lecture seule' : 'Passer en lecture seule'}</button>
      </div>
    </div>`;
  }).join('');
}

function renderAdminLogsTab() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  const rows = Array.isArray(MeetState.adminLogs) ? MeetState.adminLogs.slice().reverse() : [];
  if (!rows.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucune action admin pour le moment.</div>`;
    return;
  }
  body.innerHTML = rows.map(row => `<div style="border:1px solid var(--border);border-radius:12px;padding:11px 12px;margin-bottom:8px;background:var(--bg2);"><div style="font-size:11px;color:var(--muted);margin-bottom:5px;">${new Date(row.at).toLocaleTimeString()}</div><div style="font-size:12px;color:var(--text1);font-weight:700;">${escHtml(row.actor || 'Admin')} • ${escHtml(row.action || '')}</div><div style="font-size:11px;color:var(--text2);margin-top:4px;">${escHtml([row.target,row.detail].filter(Boolean).join(' — '))}</div></div>`).join('');
}

function renderAdminQueueTab() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  const rows = Array.from(MeetState.handQueue.entries()).sort((a,b)=>a[1]-b[1]);
  if (!rows.length) {
    body.innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;text-align:center;">Aucune main levée.</div>`;
    return;
  }
  body.innerHTML = rows.map(([socketId, order]) => {
    const meta = socketId === 'local' ? { name: MeetState.displayName, email: MeetState.USER_EMAIL } : (MeetState.peerMeta[socketId] || {});
    return `<div style="border:1px solid var(--border);border-radius:14px;padding:12px 13px;margin-bottom:10px;background:var(--bg2);display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><div style="font-size:13px;font-weight:800;color:var(--text1);">#${order} ${escHtml(meta.name || meta.displayName || meta.email || socketId)}</div><div style="font-size:11px;color:var(--muted);">${escHtml(meta.email || '')}</div></div>${socketId !== 'local' ? `<button onclick="MeetApp.allowParticipantToSpeak('${socketId}')" style="padding:8px 10px;border:none;border-radius:10px;background:rgba(34,197,94,.16);color:var(--green);font-size:11px;font-weight:800;cursor:pointer;">Autoriser</button>` : ''}</div>`;
  }).join('');
}

function renderAdminPanel() {
  const panel = document.getElementById('admin-panel');
  const body = document.getElementById('admin-body');
  if (!panel || !body) return;
  document.querySelectorAll('#admin-panel .meet-side-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === MeetState.adminTab);
  });
  const waitingCount = Array.isArray(MeetState.waitingList) ? MeetState.waitingList.length : 0;
  const badge = document.getElementById('admin-waiting-badge');
  if (badge) {
    badge.style.display = waitingCount ? 'inline-flex' : 'none';
    badge.textContent = String(waitingCount);
  }
  const lockBadge = document.getElementById('admin-lock-badge');
  if (lockBadge) {
    lockBadge.style.display = MeetState.meetingLocked ? 'inline-flex' : 'none';
    lockBadge.textContent = MeetState.meetingLockMode === 'refuse' ? 'Verrouillée' : 'Attente forcée';
  }
  if (MeetState.adminTab === 'waiting') return renderAdminWaitingTab();
  if (MeetState.adminTab === 'permissions') return renderAdminPermissionsTab();
  if (MeetState.adminTab === 'logs') return renderAdminLogsTab();
  if (MeetState.adminTab === 'queue') return renderAdminQueueTab();
  return renderAdminParticipantsTab();
}


function meetingCreateFloatingMiniButton() {
  if (document.getElementById('meeting-float-tools')) return;
  const wrap = document.createElement('div');
  wrap.id = 'meeting-float-tools';
  wrap.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:10030;display:flex;gap:10px;align-items:center;';
  wrap.innerHTML = `
    <button id="meeting-mini-btn" title="Réduire la réunion dans un mini lecteur" style="padding:10px 14px;border:none;border-radius:999px;background:rgba(3,92,128,.92);color:white;font-size:12px;font-weight:800;box-shadow:0 12px 30px rgba(0,0,0,.28);cursor:pointer;">Mini</button>
    <button id="meeting-net-btn" title="Réduire le bitrate vidéo" style="padding:10px 14px;border:none;border-radius:999px;background:rgba(255,255,255,.08);color:var(--text1);font-size:12px;font-weight:800;box-shadow:0 12px 30px rgba(0,0,0,.22);cursor:pointer;">Réseau</button>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#meeting-mini-btn')?.addEventListener('click', () => toggleMeetingMiniPlayer());
  wrap.querySelector('#meeting-net-btn')?.addEventListener('click', () => MeetApp.toggleBitrateReduction());
}

async function toggleMeetingMiniPlayer() {
  try {
    if (document.pictureInPictureElement && MeetState._pipVideo) {
      await document.exitPictureInPicture();
      return;
    }
    const canvas = MeetState._pipCanvas || document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    MeetState._pipCanvas = canvas;
    MeetState._pipCtx = ctx;
    const video = MeetState._pipVideo || document.createElement('video');
    video.muted = false;
    video.autoplay = true;
    video.playsInline = true;
    MeetState._pipVideo = video;
    const draw = () => {
      const vids = Array.from(document.querySelectorAll('.peer-tile video')).filter(v => v.srcObject && v.readyState >= 2);
      ctx.fillStyle = '#060d1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
      const n = Math.max(1, vids.length);
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const tw = Math.floor(canvas.width / cols), th = Math.floor(canvas.height / rows);
      vids.forEach((v,i)=>{ const col=i%cols,row=Math.floor(i/cols); try { ctx.drawImage(v,col*tw,row*th,tw,th); } catch(_){} });
      MeetState._pipFrame = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(MeetState._pipFrame);
    draw();
    const stream = canvas.captureStream(12);
    video.srcObject = stream;
    await video.play();
    await video.requestPictureInPicture();
    video.addEventListener('leavepictureinpicture', () => { cancelAnimationFrame(MeetState._pipFrame); }, { once: true });
  } catch (e) {
    notify('Mini lecteur non disponible sur ce navigateur');
  }
}
