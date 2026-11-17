/**
 * meeting-controls.js
 * Contrôles media : micro, caméra, écran, main levée, quitter, avis, host mute.
 * Version adaptée SFU mediasoup.
 */

function meetingEnsureSfuMaps() {
  MeetState.sfuProducers = MeetState.sfuProducers || {};
  MeetState.participantPermissions = MeetState.participantPermissions || {};
  MeetState.handQueue = MeetState.handQueue || new Map();
}

function meetingGetLocalTile() {
  return document.getElementById('tile-local');
}

function meetingGetLocalVideoEl() {
  return meetingGetLocalTile()?.querySelector('video') || null;
}

function meetingGetCameraTrack() {
  if (!MeetState.localStream) return null;
  return MeetState.localStream
    .getVideoTracks()
    .find((t) => t.readyState === 'live' && (!MeetState.screenTrack || t.id !== MeetState.screenTrack.id)) || null;
}

function meetingGetScreenTrack() {
  return MeetState.screenTrack && MeetState.screenTrack.readyState === 'live'
    ? MeetState.screenTrack
    : null;
}

function meetingRemoveTrackFromLocalStream(track) {
  if (!track || !MeetState.localStream) return;
  try { MeetState.localStream.removeTrack(track); } catch (_) {}
}

function meetingAddTrackToLocalStream(track) {
  if (!track) return;
  if (!MeetState.localStream) MeetState.localStream = new MediaStream();
  const exists = MeetState.localStream.getTracks().some((t) => t.id === track.id);
  if (!exists) {
    try { MeetState.localStream.addTrack(track); } catch (_) {}
  }
}

function meetingStopTrack(track) {
  if (!track) return;
  try { track.stop(); } catch (_) {}
}

function meetingSetLocalVideoPreview(stream, { mirrored = false, screen = false } = {}) {
  const localTile = meetingGetLocalTile();
  const localVid = meetingGetLocalVideoEl();

  if (!localVid) return;

  localVid.srcObject = stream || null;
  localVid.style.transform = mirrored ? 'scaleX(-1)' : '';
  localVid.style.objectFit = screen ? 'contain' : '';
  localVid.style.background = screen ? '#000' : '';
  localVid.style.width = screen ? '100%' : '';
  localVid.style.height = screen ? '100%' : '';

  if (localTile) {
    localTile.classList.toggle('screen-share', !!screen);
    localTile.classList.toggle('cam-off', !stream);
    if (!screen) {
      localTile.style.height = '';
      localTile.style.width = '';
    }
  }
}

async function meetingSfuCloseProducer(source) {
  meetingEnsureSfuMaps();

  const producer = MeetState.sfuProducers?.[source] || null;

  if (typeof sfuCloseProducer === 'function') {
    try {
      await sfuCloseProducer(source);
    } catch (e) {
      console.warn(`[SFU] Erreur sfuCloseProducer(${source})`, e);
    }
  } else if (producer) {
    try { producer.close(); } catch (_) {}
  }

  if (MeetState.sfuProducers?.[source]) {
    delete MeetState.sfuProducers[source];
  }
}

async function meetingSfuEnsureProducer(source, track) {
  meetingEnsureSfuMaps();

  if (!track) {
    throw new Error(`[SFU] track absente pour ${source}`);
  }

  const currentProducer = MeetState.sfuProducers?.[source] || null;

  if (currentProducer && !currentProducer.closed) {
    try {
      await currentProducer.replaceTrack({ track });
      console.log(`[SFU] Track remplacée sur producer ${source}`);
      return currentProducer;
    } catch (e) {
      console.warn(`[SFU] replaceTrack a échoué pour ${source}, recréation`, e);
      await meetingSfuCloseProducer(source);
    }
  }

  if (typeof sfuProduce !== 'function') {
    throw new Error(`[SFU] sfuProduce() est introuvable pour ${source}`);
  }

  let producer = null;

  try {
    producer = await sfuProduce(source, track);
  } catch (e1) {
    console.warn(`[SFU] sfuProduce(${source}, track) a échoué, tentative fallback`, e1);
    producer = await sfuProduce(source);
  }

  if (producer) {
    MeetState.sfuProducers[source] = producer;

    if (typeof producer.on === 'function') {
      producer.on('transportclose', () => {
        if (MeetState.sfuProducers?.[source] === producer) delete MeetState.sfuProducers[source];
      });
      producer.on('close', () => {
        if (MeetState.sfuProducers?.[source] === producer) delete MeetState.sfuProducers[source];
      });
    }
  }

  console.log(`[SFU] Producer prêt: ${source}`);
  return producer;
}

function toggleMic() {
  if (MeetState.forcedMute || MeetState.canUnmute === false || MeetState.isReadOnly) {
    notify("Votre micro est verrouillé par l'administration");
    return;
  }

  MeetState.micEnabled = !MeetState.micEnabled;

  if (MeetState.localStream) {
    MeetState.localStream.getAudioTracks().forEach((t) => {
      t.enabled = MeetState.micEnabled;
    });
  }

  const btn = document.getElementById('btn-mic');
  if (btn) btn.className = 'ctrl-btn ' + (MeetState.micEnabled ? 'active' : 'inactive');

  const micOn = document.getElementById('mic-on-ico');
  const micOff = document.getElementById('mic-off-ico');
  if (micOn) micOn.style.display = MeetState.micEnabled ? 'block' : 'none';
  if (micOff) micOff.style.display = MeetState.micEnabled ? 'none' : 'block';

  document.getElementById('muted-local')?.classList.toggle('show', !MeetState.micEnabled);

  MeetState.socket?.emit('meeting_media_state', {
    meetingId: MeetState.MEETING_ID,
    mic: MeetState.micEnabled,
    camera: MeetState.camEnabled
  });
}

async function toggleCam() {
  if (MeetState.canUseCamera === false || MeetState.isReadOnly) {
    notify("Votre caméra est désactivée par l'administration");
    return;
  }

  MeetState.camEnabled = !MeetState.camEnabled;
  await applyCamState();

  MeetState.socket?.emit('meeting_media_state', {
    meetingId: MeetState.MEETING_ID,
    mic: MeetState.micEnabled,
    camera: MeetState.camEnabled
  });
}

async function applyCamState() {
  meetingEnsureSfuMaps();

  const btn = document.getElementById('btn-cam');
  const camOnIco = document.getElementById('cam-on-ico');
  const camOffIco = document.getElementById('cam-off-ico');
  const localTile = meetingGetLocalTile();

  if (MeetState.camEnabled) {
    let videoTrack = null;

    if (MeetState.screenEnabled) {
      videoTrack =
        (MeetState.cameraTrackBeforeScreen && MeetState.cameraTrackBeforeScreen.readyState === 'live')
          ? MeetState.cameraTrackBeforeScreen
          : null;
    } else {
      videoTrack = meetingGetCameraTrack();
    }

    if (!videoTrack) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoTrack = camStream.getVideoTracks()[0];

        if (!MeetState.localStream) {
          MeetState.localStream = new MediaStream();
        }

        const existingVideoTracks = MeetState.localStream.getVideoTracks();
        for (const t of existingVideoTracks) {
          if (MeetState.screenEnabled && MeetState.screenTrack && t.id === MeetState.screenTrack.id) continue;
          meetingRemoveTrackFromLocalStream(t);
          meetingStopTrack(t);
        }

        if (videoTrack) {
          meetingAddTrackToLocalStream(videoTrack);
        }
      } catch (e) {
        console.error('[SFU] Impossible de réactiver la caméra:', e);
        MeetState.camEnabled = false;
        notify('Caméra inaccessible');
      }
    }

    if (videoTrack) {
      videoTrack.enabled = true;

      if (MeetState.screenEnabled) {
        MeetState.cameraTrackBeforeScreen = videoTrack;
      } else {
        try {
          if (typeof publishCameraTrack === 'function') {
            await publishCameraTrack(videoTrack);
          } else {
            await meetingSfuEnsureProducer('camera', videoTrack);
          }
        } catch (e) {
          console.error('[SFU] Publication caméra impossible:', e);
          MeetState.camEnabled = false;
          notify('Impossible d’activer la caméra');
        }
      }
    }

    if (!MeetState.screenEnabled && MeetState.localStream) {
      meetingSetLocalVideoPreview(MeetState.localStream, { mirrored: true, screen: false });
    }

    if (!MeetState.screenEnabled && localTile) {
      localTile.classList.remove('cam-off');
      localTile.classList.remove('screen-share');
      localTile.style.height = '';
      localTile.style.width = '';
    }
  } else {
    if (MeetState.screenEnabled) {
      if (MeetState.cameraTrackBeforeScreen) {
        MeetState.cameraTrackBeforeScreen.enabled = false;
      }
    } else {
      // Le floutage tournait peut-être sur la piste qu'on s'apprête à couper —
      // on met le pipeline en pause (sans effacer l'intention de floutage,
      // qui doit persister pour reprendre automatiquement à la réactivation).
      if (typeof pauseBlurPipeline === 'function') pauseBlurPipeline();

      MeetState.localStream?.getVideoTracks().forEach((t) => {
        if (!MeetState.screenTrack || t.id !== MeetState.screenTrack.id) {
          t.enabled = false;
        }
      });

      try {
        await meetingSfuCloseProducer('camera');
        console.log('[SFU] Producer caméra fermé');
      } catch (e) {
        console.warn('[SFU] Erreur fermeture producer caméra:', e);
      }

      localTile?.classList.add('cam-off');
    }
  }

  if (btn) btn.className = 'ctrl-btn ' + (MeetState.camEnabled ? 'active' : 'inactive');
  if (camOnIco) camOnIco.style.display = MeetState.camEnabled ? 'block' : 'none';
  if (camOffIco) camOffIco.style.display = MeetState.camEnabled ? 'none' : 'block';
}

async function toggleScreenShare() {
  if (MeetState.canShareScreen === false || MeetState.isReadOnly) {
    notify("Le partage d’écran est désactivé par l'administration");
    return;
  }

  if (MeetState.screenEnabled) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  meetingEnsureSfuMaps();

  let displayStream;
  let screenTrack;

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) {
      notify('Aucun écran sélectionné');
      return;
    }
  } catch (e) {
    console.error('[SFU] getDisplayMedia impossible:', e);
    notify('Partage d’écran impossible');
    return;
  }

  try {
    const currentCamTrack = (typeof getHandoffCameraTrack === 'function')
      ? getHandoffCameraTrack()
      : meetingGetCameraTrack();
    if (currentCamTrack) {
      MeetState.cameraTrackBeforeScreen = currentCamTrack;
    }

    // Le floutage tournait peut-être sur la caméra qu'on s'apprête à masquer
    // par l'écran partagé — on le met en pause (intention conservée, pour
    // qu'il reprenne tout seul quand le partage d'écran se termine).
    if (typeof pauseBlurPipeline === 'function') pauseBlurPipeline();

    MeetState.screenEnabled = true;
    MeetState.screenTrack = screenTrack;

    if (!MeetState.localStream) {
      MeetState.localStream = new MediaStream();
    }

    const cameraTracks = MeetState.localStream.getVideoTracks().filter((t) => t.id !== screenTrack.id);
    for (const t of cameraTracks) {
      meetingRemoveTrackFromLocalStream(t);
    }

    meetingAddTrackToLocalStream(screenTrack);

    await meetingSfuEnsureProducer('screen', screenTrack);

    meetingSetLocalVideoPreview(new MediaStream([screenTrack]), { mirrored: false, screen: true });

    screenTrack.onended = async () => {
      await stopScreenShare();
    };

    const btn = document.getElementById('btn-screen');
    if (btn) btn.classList.add('active');

    MeetState.socket?.emit('meeting_media_state', {
      meetingId: MeetState.MEETING_ID,
      mic: MeetState.micEnabled,
      camera: MeetState.camEnabled,
      screen: true
    });

    console.log('[SFU] Partage écran démarré');
  } catch (e) {
    console.error('[SFU] Publication écran impossible:', e);
    notify('Impossible de publier le partage d’écran');

    try { meetingStopTrack(screenTrack); } catch (_) {}
    MeetState.screenEnabled = false;
    MeetState.screenTrack = null;
  }
}

async function stopScreenShare() {
  meetingEnsureSfuMaps();

  const btn = document.getElementById('btn-screen');

  try {
    await meetingSfuCloseProducer('screen');
    console.log('[SFU] Producer screen fermé');
  } catch (e) {
    console.warn('[SFU] Erreur fermeture producer screen:', e);
  }

  if (MeetState.screenTrack) {
    meetingRemoveTrackFromLocalStream(MeetState.screenTrack);
    meetingStopTrack(MeetState.screenTrack);
    MeetState.screenTrack = null;
  }

  MeetState.screenEnabled = false;

  const localTile = meetingGetLocalTile();
  localTile?.classList.remove('screen-share');

  if (MeetState.camEnabled && MeetState.cameraTrackBeforeScreen && MeetState.cameraTrackBeforeScreen.readyState === 'live') {
    const camTrack = MeetState.cameraTrackBeforeScreen;

    try {
      if (typeof publishCameraTrack === 'function') {
        await publishCameraTrack(camTrack);
      } else {
        meetingAddTrackToLocalStream(camTrack);
        await meetingSfuEnsureProducer('camera', camTrack);
      }
      console.log('[SFU] Caméra restaurée après partage écran');
    } catch (e) {
      console.error('[SFU] Restauration caméra impossible:', e);
      notify('La caméra n’a pas pu être restaurée');
    }

    if (MeetState.localStream) {
      meetingSetLocalVideoPreview(MeetState.localStream, { mirrored: true, screen: false });
    }
    localTile?.classList.remove('cam-off');
  } else {
    meetingSetLocalVideoPreview(null, { mirrored: false, screen: false });
    localTile?.classList.add('cam-off');
  }

  if (btn) btn.classList.remove('active');

  MeetState.socket?.emit('meeting_media_state', {
    meetingId: MeetState.MEETING_ID,
    mic: MeetState.micEnabled,
    camera: MeetState.camEnabled,
    screen: false
  });

  console.log('[SFU] Partage écran arrêté');
}

function startSpeechDetection() {
  if (!MeetState.localStream || !window.AudioContext) return;
  try {
    MeetState._speechCtx = new (window.AudioContext || window.webkitAudioContext)();
    MeetState._speechAnalyser = MeetState._speechCtx.createAnalyser();
    MeetState._speechAnalyser.fftSize = 512;
    const src = MeetState._speechCtx.createMediaStreamSource(MeetState.localStream);
    src.connect(MeetState._speechAnalyser);
    const buf = new Uint8Array(MeetState._speechAnalyser.frequencyBinCount);
    let speakingMs = 0;
    MeetState._speechInterval = setInterval(() => {
      if (!MeetState.handRaised) { stopSpeechDetection(); return; }
      MeetState._speechAnalyser.getByteFrequencyData(buf);
      const rms = buf.reduce((a, b) => a + b, 0) / buf.length;
      if (rms > MeetState.SPEECH_THRESHOLD) {
        speakingMs += 100;
        if (speakingMs >= MeetState.SPEECH_DURATION) lowerHandOnSpeech();
      } else {
        speakingMs = Math.max(0, speakingMs - 50);
      }
    }, 100);
  } catch (_) {}
}

function stopSpeechDetection() {
  clearInterval(MeetState._speechInterval);
  MeetState._speechInterval = null;
  if (MeetState._speechCtx) {
    try { MeetState._speechCtx.close(); } catch (_) {}
    MeetState._speechCtx = null;
  }
}

function lowerHandOnSpeech() {
  if (!MeetState.handRaised) return;
  stopSpeechDetection();
  MeetState.handRaised = false;
  const btn = document.getElementById('btn-hand');
  if (btn) btn.className = 'ctrl-btn active';
  document.getElementById('hand-local')?.classList.remove('raised');
  setHandBadge('local', null);
  MeetState.handQueue.delete('local');
  renumberHands();
  MeetState.socket?.emit('meeting_hand_raise', { meetingId: MeetState.MEETING_ID, raised: false });
  notify('Vous avez pris la parole — main baissée automatiquement');
}

function toggleHand() {
  if (MeetState.isReadOnly) {
    notify("Mode lecture seule actif");
    return;
  }

  MeetState.handRaised = !MeetState.handRaised;
  const btn = document.getElementById('btn-hand');
  if (btn) btn.className = 'ctrl-btn ' + (MeetState.handRaised ? 'hand-on' : 'active');
  document.getElementById('hand-local')?.classList.toggle('raised', MeetState.handRaised);

  if (MeetState.handRaised) {
    MeetState.handOrder++;
    MeetState.handQueue.set('local', MeetState.handOrder);
    setHandBadge('local', MeetState.handOrder);
    startSpeechDetection();
  } else {
    stopSpeechDetection();
    MeetState.handQueue.delete('local');
    setHandBadge('local', null);
    renumberHands();
  }

  MeetState.socket?.emit('meeting_hand_raise', {
    meetingId: MeetState.MEETING_ID,
    raised: MeetState.handRaised
  });
}

function setHandBadge(id, num) {
  const hand = document.getElementById('hand-' + id);
  if (!hand) return;

  if (num) {
    hand.classList.add('raised');
    hand.innerHTML = MeetState.HAND_SVG + `<span style="position:absolute;top:-6px;right:-6px;background:#f59e0b;color:white;font-size:9px;font-weight:800;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${num}</span>`;
    hand.style.position = 'relative';
  } else {
    hand.classList.remove('raised');
    hand.innerHTML = MeetState.HAND_SVG;
    hand.style.position = '';
  }
}

function renumberHands() {
  Array.from(MeetState.handQueue.entries())
    .sort((a, b) => a[1] - b[1])
    .forEach(([id, _], i) => {
      MeetState.handQueue.set(id, i + 1);
      setHandBadge(id, i + 1);
    });
}

function leave() {
  if (MeetState._mediaRecorder?.state === 'recording') {
    const stopNow = confirm("Un enregistrement est en cours. Voulez-vous l'arrêter et enregistrer la vidéo avant de quitter ?");
    if (stopNow) { try { MeetState._mediaRecorder.stop(); } catch (_) {} }
    else return;
  }
  showLeaveModal();
}

function showLeaveModal() {
  if (document.getElementById('leave-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'leave-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:320px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.6);">
      <div style="width:48px;height:48px;border-radius:13px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </div>
      <div style="text-align:center;margin-bottom:22px;">
        <div style="font-size:16px;font-weight:800;color:var(--text1);margin-bottom:8px;">${meetingHasControlPower() ? 'Terminer la réunion ?' : 'Quitter la réunion ?'}</div>
        <div style="font-size:13px;color:var(--muted);">${meetingHasControlPower() ? 'La réunion sera terminée pour tous.' : 'Vous pouvez rejoindre à nouveau via le lien.'}</div>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('leave-modal').remove()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">Rester</button>
        <button onclick="MeetApp.confirmLeave()" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${meetingHasControlPower() ? 'Terminer' : 'Quitter'}</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function confirmLeave() {
  document.getElementById('leave-modal')?.remove();

  if (meetingHasControlPower()) {
    MeetState.socket?.emit('meeting_end', { meetingId: MeetState.MEETING_ID });
    fetch('/api/meetings/' + MeetState.MEETING_ID + '/end', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
      }
    });
  } else {
    MeetState.socket?.emit('meeting_leave', { meetingId: MeetState.MEETING_ID });
  }

  if (MeetState.audioDiagTimer) {
    clearInterval(MeetState.audioDiagTimer);
    MeetState.audioDiagTimer = null;
  }

  MeetState.localStream?.getTracks().forEach((t) => t.stop());

  Object.values(MeetState.peers || {}).forEach((p) => {
    try { p?.pc?.close?.(); } catch (_) {}
  });

  showReviewModal();
}

function hostMutePeer(socketId) {
  const btn = document.getElementById('hostmute-' + socketId);
  const isMuted = btn?.classList.contains('muted');

  if (isMuted) {
    MeetState.socket?.emit('host_unmute', { meetingId: MeetState.MEETING_ID, targetSocket: socketId });
    btn?.classList.remove('muted');
  } else {
    MeetState.socket?.emit('host_mute', { meetingId: MeetState.MEETING_ID, targetSocket: socketId });
    btn?.classList.add('muted');
  }
}

// ── Avis réunion ────────────────────────────────────────────────────────────
const RATING_LABELS = ['', 'Médiocre', 'Passable', 'Bien', 'Très bien', 'Excellent !'];

function showReviewModal() {
  if (!MeetState.REVIEWS_ENABLED) {
    window.location.href = '/mail';
    return;
  }
  document.getElementById('review-modal')?.classList.add('open');
}

function setRating(n) {
  MeetState.reviewRating = n;
  document.querySelectorAll('.star-btn').forEach((btn, i) => btn.classList.toggle('active', i < n));
  const lbl = document.getElementById('rating-label');
  if (lbl) lbl.textContent = RATING_LABELS[n] || '';
  const submitBtn = document.getElementById('review-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

async function submitReview() {
  if (!MeetState.reviewRating) return;

  const comment = document.getElementById('review-comment')?.value.trim() || '';
  const btn = document.getElementById('review-submit-btn');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Envoi…';
  }

  try {
    await fetch('/api/meetings/' + MeetState.MEETING_ID + '/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
      },
      body: JSON.stringify({
        rating: MeetState.reviewRating,
        comment,
        email: MeetState.USER_EMAIL
      }),
    });
  } catch (_) {}

  window.location.href = '/mail';
}

function skipReview() {
  window.location.href = '/mail';
}

function toggleReactions() {
  const bar = document.querySelector('.meet-reaction-bar');
  if (!bar) return;

  const meetBar = document.querySelector('.meet-bar');
  if (meetBar) {
    const rect = meetBar.getBoundingClientRect();
    bar.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    bar.style.left = '50%';
    bar.style.transform = bar.classList.contains('show')
      ? 'translateX(-50%) translateY(8px)'
      : 'translateX(-50%) translateY(0)';
  }

  bar.classList.toggle('show');

  if (bar.classList.contains('show')) {
    document.addEventListener('click', function close(e) {
      if (!bar.contains(e.target) && !e.target.closest('[onclick*="toggleReactions"]')) {
        bar.classList.remove('show');
        document.removeEventListener('click', close);
      }
    });
  }
}

function sendReaction(emoji) {
  const bar = document.querySelector('.meet-reaction-bar');
  bar?.classList.remove('show');
  MeetState.socket?.emit('meeting_reaction', { meetingId: MeetState.MEETING_ID, emoji });
  const x = 100 + Math.random() * (window.innerWidth - 200);
  flyEmoji(emoji, x, window.innerHeight - 80);
}

function extendMeeting(minutes) {
  if (!meetingHasControlPower()) return;
  // Retour visuel immédiat — la confirmation définitive (fermeture de la
  // fenêtre) arrive via l'événement serveur 'meeting_extended' juste après.
  const toast = document.getElementById('meeting-extension-toast');
  if (toast) {
    const buttonsRow = toast.querySelector('div[style*="flex-wrap"]');
    if (buttonsRow) buttonsRow.innerHTML = '<div style="font-size:12px;color:var(--muted);">Prolongation en cours…</div>';
  }
  MeetState.socket?.emit('meeting_extend', { meetingId: MeetState.MEETING_ID, minutes });
}

function moveParticipantToWaiting(socketId) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_waiting', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
  notify("Participant déplacé en salle d'attente");
}

function removeParticipant(socketId) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_remove', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
  notify('Participant retiré de la réunion');
}

function banParticipant(socketId) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_ban', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
  notify('Participant banni de la réunion');
}

function lockMeeting(mode = 'waiting') {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_lock', { meetingId: MeetState.MEETING_ID, locked: !MeetState.meetingLocked, mode });
}

function muteAllParticipants(locked = true) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_mute_all', { meetingId: MeetState.MEETING_ID, locked });
}

function updateParticipantPermissions(socketId, patch = {}) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_permissions', {
    meetingId: MeetState.MEETING_ID,
    targetSocketId: socketId,
    patch
  });
}

function toggleParticipantPermission(socketId, key) {
  const current = MeetState.participantPermissions[socketId] || {};
  const patch = {};

  if (key === 'forceMuted') {
    patch.forceMuted = !current.forceMuted;
    if (!patch.forceMuted) patch.canUnmute = true;
  } else if (key === 'canUseCamera') {
    patch.canUseCamera = !(current.canUseCamera !== false);
  } else if (key === 'canShareScreen') {
    patch.canShareScreen = !(current.canShareScreen !== false);
  } else if (key === 'canChat') {
    patch.canChat = !(current.canChat !== false);
  } else if (key === 'readOnly') {
    patch.readOnly = !current.readOnly;
  }

  updateParticipantPermissions(socketId, patch);
}

function allowParticipantToSpeak(socketId) {
  if (!meetingHasControlPower()) return;
  MeetState.socket?.emit('meeting_admin_allow_speak', { meetingId: MeetState.MEETING_ID, targetSocketId: socketId });
}

function tempExpelParticipant(socketId, mode = '10') {
  if (!meetingHasControlPower()) return;

  const payload = {
    meetingId: MeetState.MEETING_ID,
    targetSocketId: socketId
  };

  if (mode === 'end') payload.untilEnd = true;
  else if (mode === 'manual') payload.manualApproval = true;
  else payload.durationMinutes = parseInt(mode, 10) || 10;

  MeetState.socket?.emit('meeting_admin_temp_expel', payload);
}




let meetingMiniPipVideo = null;
let meetingMiniPipActive = false;

function meetingGetBestVideoForMini() {
  const grid = document.getElementById('video-grid');
  if (!grid) return null;

  const tiles = Array.from(grid.querySelectorAll('.peer-tile'));

  const visibleTiles = tiles.filter((tile) => {
    const style = window.getComputedStyle(tile);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  // 1) priorité absolue : partage d’écran
  const screenTile = visibleTiles.find((tile) => tile.classList.contains('screen-share'));
  if (screenTile) {
    const v = screenTile.querySelector('video');
    if (v && v.srcObject) return v;
  }

  // 2) ensuite : la personne qui parle
  const speakingTile = visibleTiles.find((tile) => tile.classList.contains('speaking'));
  if (speakingTile) {
    const v = speakingTile.querySelector('video');
    if (v && v.srcObject) return v;
  }

  // 3) ensuite : une vidéo distante visible
  const remoteTile = visibleTiles.find((tile) => {
    if (tile.id === 'tile-local') return false;
    const v = tile.querySelector('video');
    return !!(v && v.srcObject);
  });
  if (remoteTile) {
    return remoteTile.querySelector('video');
  }

  // 4) fallback : vidéo locale
  const localTile = document.getElementById('tile-local');
  const localVideo = localTile?.querySelector('video');
  if (localVideo && localVideo.srcObject) return localVideo;

  // 5) dernier fallback : n’importe quelle vidéo avec flux
  const anyVideo = Array.from(grid.querySelectorAll('video')).find((v) => v.srcObject);
  return anyVideo || null;
}

function meetingUpdateMiniButtonState() {
  const btn = document.getElementById('btn-mini');
  if (!btn) return;
  btn.className = 'ctrl-btn ' + (meetingMiniPipActive ? 'chat-on' : 'active');
}

async function toggleMini() {
  try {
    if (!document.pictureInPictureEnabled) {
      notify('Mini écran non supporté sur ce navigateur');
      return;
    }

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      meetingMiniPipVideo = null;
      meetingMiniPipActive = false;
      meetingUpdateMiniButtonState();
      return;
    }

    const targetVideo = meetingGetBestVideoForMini();

    if (!targetVideo) {
      notify('Aucune vidéo disponible pour le mini écran');
      return;
    }

    if (targetVideo.readyState < 1) {
      notify('La vidéo n’est pas encore prête');
      return;
    }

    meetingMiniPipVideo = targetVideo;
    await targetVideo.requestPictureInPicture();
    meetingMiniPipActive = true;
    meetingUpdateMiniButtonState();
  } catch (e) {
    console.error('[Mini] Erreur Picture-in-Picture:', e);
    notify('Impossible d’ouvrir le mini écran');
    meetingMiniPipActive = false;
    meetingMiniPipVideo = null;
    meetingUpdateMiniButtonState();
  }
}

document.addEventListener('leavepictureinpicture', () => {
  meetingMiniPipActive = false;
  meetingMiniPipVideo = null;
  meetingUpdateMiniButtonState();
});

if (typeof window !== "undefined") {
  window.toggleMini = toggleMini;
  window.toggleScreen = toggleScreenShare;
}