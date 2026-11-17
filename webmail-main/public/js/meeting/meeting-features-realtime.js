// ── Push Notifications ───────────────────────────────────────────────────────
async function registerPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const vapidKey = document.querySelector('meta[name="vapid-public-key"]')?.content;
    if (!vapidKey) return;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' }, body: JSON.stringify(sub) });
  } catch(e) { console.log('Push non disponible:', e.message); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}


function playPollSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(988, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

function showRecordingCountdown(seconds = 3) {
  const existing = document.getElementById('recording-countdown-overlay');
  if (existing) existing.remove();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'recording-countdown-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(4,10,20,.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
    overlay.innerHTML = `<div style="width:150px;height:150px;border-radius:999px;background:rgba(239,68,68,.16);border:2px solid rgba(239,68,68,.45);display:flex;align-items:center;justify-content:center;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.45);"><div style="font-size:16px;color:#fecaca;font-weight:700;margin-bottom:6px;">Enregistrement</div><div id="recording-countdown-value" style="font-size:58px;font-weight:900;color:#fff;line-height:1;">${seconds}</div></div>`;
    document.body.appendChild(overlay);
    let left = seconds;
    const tick = () => {
      const value = document.getElementById('recording-countdown-value');
      if (value) value.textContent = String(left);
      if (left <= 1) {
        setTimeout(() => { overlay.remove(); resolve(); }, 650);
        return;
      }
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

// ── Socket listeners pour ces fonctionnalités ────────────────────────────────
function setupNewFeaturesSocket() {
  const socket = MeetState.socket;
  socket.on('speech_start', ({ socketId }) => startSpeechTimer(socketId));
  socket.on('speech_stop',  ({ socketId }) => stopSpeechTimer(socketId));
  socket.on('speech_limit', ({ limit }) => {
    MeetState.speechLimit = limit;
    notify(`Limite de parole : ${Math.round(limit/60)} min`);
  });
  socket.on('poll_launched', (poll) => {
    MeetState.currentPoll = poll;
    playPollSound();
    showPollVote(poll);
    notify(meetingHasControlPower() ? 'Sondage lancé' : '📊 Nouveau sondage disponible');
  });
  socket.on('poll_update', (poll) => {
    MeetState.currentPoll = { ...(MeetState.currentPoll || {}), ...poll };
    if (meetingHasControlPower()) showPollResults(MeetState.currentPoll, { live: true });
  });
  socket.on('poll_all_answered', (poll) => {
    MeetState.currentPoll = { ...(MeetState.currentPoll || {}), ...poll, allAnswered: true };
    if (meetingHasControlPower()) {
      pollUpdateHostControls(MeetState.currentPoll, false);
      notify('✅ Tout le monde a répondu. Tu peux maintenant mettre fin au sondage.');
    }
  });
  socket.on('poll_results',  (poll) => {
    MeetState.currentPoll = poll;
    showPollResults(poll, { live: false });
  });
  socket.on('poll_sync', (poll) => {
    MeetState.currentPoll = poll;
    if (poll?.closed) showPollResults(poll, { live: false });
    else showPollVote(poll);
  });
  socket.on('poll_error', ({ error }) => { if (error) notify(error); });
  socket.on('recording_status', ({ socketId, displayName, active }) => {
    if (!active) return;
    if (socketId === MeetState.socket?.id) return;
    if (meetingHasControlPower()) notify(`⏺️ ${displayName || 'Un participant'} enregistre la réunion`);
  });
  socket.on('meeting_role_sync', ({ socketId, email, displayName, role, enabled, mine }) => {
    const isCatalyst = role === 'catalyst' && !!enabled;
    if (mine) {
      MeetState.IS_CATALYST = isCatalyst;
      notify(isCatalyst ? '✨ Tu es désormais Catalyst sur cette session' : 'Les droits Catalyst ont été retirés');
      playPremiumChime();
      pollResetZones?.();
      meetingApplyControlPowerUI?.();
    }
    if (socketId) {
      if (!MeetState.peerMeta[socketId]) MeetState.peerMeta[socketId] = { email: email || '', name: displayName || email || '', isSharing: false };
      MeetState.peerMeta[socketId].isCatalyst = isCatalyst;
      updatePeerCatalystBadge?.(socketId, isCatalyst);
    }
    if (!mine && isCatalyst) {
      notify(`✨ ${displayName || email || 'Un participant'} devient Catalyst`);
      playPremiumChime();
    }
    meetingApplyControlPowerUI?.();
  });
  socket.on('meeting_role_error', ({ error }) => { if (error) notify(error); });

  socket.on('meeting_timer_sync', (payload) => {
    syncMeetingTimer?.(payload);
  });
  socket.on('meeting_extension_prompt', ({ expiresAt }) => {
    showMeetingExtensionPrompt?.(expiresAt);
  });
  socket.on('meeting_extended', ({ minutes, expiresAt }) => {
    dismissMeetingExtensionPrompt?.();
    MeetState.extensionPromptFor = null;
    if (expiresAt) syncMeetingTimer?.({ startedAt: MeetState.startTime ? new Date(MeetState.startTime).toISOString() : null, expiresAt });
    if (minutes) notify(`⏱️ Réunion prolongée de ${minutes} minutes`);
  });
  socket.on('participation_stats', ({ stats }) => {
    renderParticipationStats?.(stats || []);
    renderParticipationPanel?.();
  });

  socket.on('wb_draw',  (data) => applyWbDraw(data));
  socket.on('wb_shape', (data) => applyWbShape(data));
  socket.on('wb_text',  ({ text, x, y, color, size }) => {
    if (!MeetState.wbCtx) return;
    MeetState.wbCtx.fillStyle = color; MeetState.wbCtx.font = `${size*6}px Sora,sans-serif`; MeetState.wbCtx.fillText(text, x, y);
  });
  socket.on('wb_clear', () => {
    if (typeof wbObjects !== 'undefined') wbObjects = [];
    if (typeof wbSelectedObj !== 'undefined') wbSelectedObj = null;
    if (typeof wbPersistState === 'function') wbPersistState('remote-clear');
    if (typeof wbRedraw === 'function') { wbRedraw(); return; }
    if (!MeetState.wbCtx) return;
    MeetState.wbCtx.fillStyle = typeof wbBgColor_ !== 'undefined' ? wbBgColor_ : '#1a2540';
    MeetState.wbCtx.fillRect(0, 0, MeetState.wbCanvas?.width||800, MeetState.wbCanvas?.height||600);
  });
  socket.on('wb_state', (payload) => {
    if (!payload) return;
    if (payload.bgColor && typeof wbBgColor_ !== 'undefined') wbBgColor_ = payload.bgColor;
    if (payload.objects && Array.isArray(payload.objects)) {
      // Nouveau format : liste d'objets normalisés
      wbObjects = payload.objects;
      if (typeof wbPersistState === 'function') wbPersistState('remote-state');
      if (MeetState.wbCanvas) wbRedraw();
      return;
    }
    if (payload.dataUrl && MeetState.wbCtx && MeetState.wbCanvas) {
      const img = new Image();
      img.onload = () => MeetState.wbCtx.drawImage(img, 0, 0);
      img.src = payload.dataUrl;
    }
  });
  socket.on('wb_sync', (payload) => {
    if (!payload) return;
    if (payload.bgColor && typeof wbBgColor_ !== 'undefined') wbBgColor_ = payload.bgColor;
    if (payload.objects && Array.isArray(payload.objects)) {
      wbObjects = payload.objects;
      if (typeof wbPersistState === 'function') wbPersistState('remote-sync');
      if (MeetState.wbCanvas) wbRedraw();
    } else if (payload.dataUrl && MeetState.wbCtx && MeetState.wbCanvas) {
      const img = new Image();
      img.onload = () => MeetState.wbCtx.drawImage(img, 0, 0);
      img.src = payload.dataUrl;
    }
  });
  socket.on('wb_sticker', (data) => applyWbSticker(data));
  socket.on('wb_text',    (data) => { if(data.id&&!wbObjects.find(o=>o.id===data.id)){wbObjects.push(data);wbRedraw();} });

  // ── Popcorn ──────────────────────────────────────────────────────────────
  socket.on('popcorn_start', ({ targetName, targetSocketId, question, duration }) => {
    const iAmTarget = !meetingHasControlPower() && (targetSocketId === 'all' || MeetState.socket?.id === targetSocketId);
    if (iAmTarget) return showPopcornModal(targetName, targetSocketId, question, duration);
    if (meetingHasControlPower()) {
      notify(`🍿 Question envoyée à ${targetName}`);
      return;
    }
    notify(`🍿 ${targetName} a été désigné pour répondre`);
  });
  socket.on('popcorn_answer', ({ answer, targetName }) => {
    closePopcornModal();
    showPopcornAnswer(targetName, answer);
    appendChat('Popcorn 🍿', `${targetName} : ${answer}`, new Date().toISOString(), false);
  });
  socket.on('popcorn_timeout', ({ targetName }) => {
    closePopcornModal();
    notify(`⏰ ${targetName} n\'a pas répondu à temps`);
  });

  // ── Quiz ─────────────────────────────────────────────────────────────────
  socket.on('quiz_question', (q) => showQuizVote(q));
  socket.on('quiz_results',  (r) => {
    if (r.leaderboard) _quizLiveLeaderboard = r.leaderboard;
    _quizHistory.push({
      question:   r.question,
      options:    r.options,
      correctIdx: r.correctIdx,
      votes:      r.votes,
      voterNames: r.voterNames || {},
      scores:     r.scores || [],
      points:     r.points || 1,
      isBingo:    r.isBingo || false,
      ts:         new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}),
    });
    quizSaveToStorage();
    showQuizResults(r);
    // Rafraîchir la modal si elle est ouverte
    if (document.getElementById('qtab-body')) {
      const active = document.querySelector('[id^=qtab-][style*="var(--accent)"]');
      if (active) quizCreatorTab(active.id.replace('qtab-',''));
    }
  });
  socket.on('quiz_end',      ()  => closeQuizModal());
  socket.on('quiz_vote_count', ({ total }) => {
    const el = document.getElementById('quiz-vote-count');
    if (el) el.textContent = `${total} vote${total>1?'s':''}`;
  });
  // Recevoir le classement restauré par l'hôte
  socket.on('quiz_leaderboard_sync', ({ leaderboard }) => {
    if (leaderboard?.length) {
      _quizLiveLeaderboard = leaderboard;
      quizSaveToStorage();
    }
  });
  socket.on('quiz_applaud', ({ targetName, fromName }) => {
    const isTarget = targetName === MeetState.displayName;
    showApplauseEffect(isTarget ? MeetState.displayName : targetName, false);
    if (!isTarget) notify(`👏 ${fromName} applaudit ${targetName}`);
  });

  // Restaurer l'état quiz depuis localStorage (si reconnexion)
  quizLoadFromStorage();
  if (_quizLiveLeaderboard.length) {
    // Remonter le leaderboard au serveur pour que les autres le reçoivent
    socket.emit('quiz_restore_leaderboard', {
      meetingId:   MeetState.MEETING_ID,
      leaderboard: _quizLiveLeaderboard,
    });
    // Notifier uniquement l'hôte — silencieux pour les autres
    if (meetingHasControlPower()) {
      notify('🏆 Classement restauré — ' + _quizLiveLeaderboard.length + ' joueur(s)');
    }
  }

  // Demander l'état du tableau blanc — tous les handlers sont prêts maintenant
  socket.emit('wb_request_state', { meetingId: MeetState.MEETING_ID });
}
