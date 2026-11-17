/**
 * meeting-socket.js  — signaling SFU mediasoup
 *
 * Ce fichier remplace le signaling P2P (meeting_offer / meeting_answer / meeting_ice)
 * par les événements SFU mediasoup :
 *   sfu:join · sfu:routerCapabilities · sfu:createTransport · sfu:connectTransport
 *   sfu:produce · sfu:newProducer · sfu:consume · sfu:resumeConsumer
 *   sfu:producerClosed · sfu:closeProducer · sfu:pauseProducer · sfu:resumeProducer
 *
 * Toute la gestion : salle d'attente, chat, contrôles admin, réactions…
 * est conservée intacte.
 */

// Son de @mention
function playMentionSound() {
  try {
    const ctx  = getSharedAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046, ctx.currentTime);
    osc.frequency.setValueAtTime(1318, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch(_) {}
}

function setupSocket(bypassWaiting = false, joinMessage = '') {
  // Éviter de créer plusieurs sockets
  if (MeetState.socket?.connected) return;
  if (MeetState.socket) { try { MeetState.socket.disconnect(); } catch(_) {} }
  MeetState.socket = io({ transports: ['websocket'], upgrade: false });
  const socket = MeetState.socket;

  initNotes();
  setupNotesSocket();
  setupNewFeaturesSocket();
  initPollUI();
  bindCaptionsSocket(socket);
  setTimeout(registerPushNotifications, 2000);

  const doJoin = () => {
    socket.emit('meeting_join', {
      meetingId:     MeetState.MEETING_ID,
      email:         MeetState.USER_EMAIL,
      displayName:   MeetState.displayName,
      isHost:        MeetState.IS_HOST,
      bypassWaiting: bypassWaiting,
      accessCode:    MeetState.lastVerifiedCode || (document.getElementById('lobby-code')?.value || '').trim(),
      message:       joinMessage,
    });
    socket.emit('meeting_media_state', { meetingId: MeetState.MEETING_ID, mic: MeetState.micEnabled, camera: MeetState.camEnabled });
  };

  if (socket.connected) { doJoin(); } else { socket.once('connect', doJoin); }

  socket.on('reconnect', async () => {
    console.log('[Socket] Reconnecté — réinitialisation SFU');
    // Nettoyage SFU propre avant de rejoindre
    sfuCleanup?.();
    MeetState.peers     = {};
    MeetState.peerMeta  = {};
    // Les tuiles seront recréées via meeting_peers_list + sfu:newProducer
    socket.emit('meeting_join', {
      meetingId:     MeetState.MEETING_ID,
      email:         MeetState.USER_EMAIL,
      displayName:   MeetState.displayName,
      isHost:        MeetState.IS_HOST,
      bypassWaiting: true,
      accessCode:    MeetState.lastVerifiedCode || '',
    });
  });

  // ── Salle d'attente — côté participant ──────────────────────────────────────
  socket.on('waiting_room_entered', payload => {
    showWaitingRoom(payload || {});
  });

  socket.on('waiting_room_rejected', () => {
    document.getElementById('waiting-room')?.remove();
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;z-index:999;';
    div.innerHTML = `
      <div style="width:56px;height:56px;border-radius:16px;background:rgba(248,113,113,0.15);display:flex;align-items:center;justify-content:center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div style="text-align:center;">
        <div style="font-size:18px;font-weight:800;color:var(--text1);">Accès refusé</div>
        <div style="font-size:13px;color:var(--muted);margin-top:6px;">L'organisateur a refusé votre demande d'accès.</div>
      </div>
      <button onclick="window.location.href='/mail'" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Retour</button>`;
    document.body.appendChild(div);
  });

  // ── Salle d'attente — côté hôte ──────────────────────────────────────────────
  socket.on('waiting_room_list', ({ waitList }) => {
    MeetState.waitingList = Array.isArray(waitList) ? waitList.slice() : [];
    renderWaitingList(waitList);
    renderAdminPanel?.();
  });

  socket.on('waiting_room_knock', payload => {
    const { socketId, email, displayName: dn, joinedAt, attempts, message } = payload || {};
    MeetState.waitingList = (MeetState.waitingList || []).filter(w => w.socketId !== socketId);
    MeetState.waitingList.push({ socketId, email, displayName: dn, joinedAt, attempts, message });
    if (!meetingHasControlPower()) return;
    const list = document.getElementById('waiting-list');
    const panel = document.getElementById('waiting-panel');
    const badge = document.getElementById('waiting-badge');
    if (!list) return;
    playKnockSound();
    notify(`🚪 ${dn || email} demande à entrer`);
    if (panel) panel.style.display = 'block';
    if (badge) { badge.style.display = 'flex'; badge.textContent = (parseInt(badge.textContent) || 0) + 1; }
    const entry = document.createElement('div');
    entry.className = 'waiting-entry';
    entry.id = 'we-' + socketId;
    entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);animation:moveSlideUp .2s ease;';
    entry.innerHTML = `
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:white;flex-shrink:0;">
        ${escHtml((dn||'?').slice(0,2).toUpperCase())}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(dn)}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(email)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button onclick="MeetApp.admitWaiting('${socketId}')"
          style="padding:6px 12px;border-radius:8px;border:none;background:var(--green);color:white;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">
          ✓ Admettre
        </button>
        <button onclick="MeetApp.rejectWaiting('${socketId}')"
          style="padding:6px 12px;border-radius:8px;border:none;background:rgba(248,113,113,0.15);color:var(--red);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">
          ✕ Refuser
        </button>
      </div>`;
    list.appendChild(entry);
    renderAdminPanel?.();
  });

  socket.on('waiting_room_admitted', ({ socketId, displayName: dn }) => {
    MeetState.waitingList = (MeetState.waitingList || []).filter(w => w.socketId !== socketId);
    renderAdminPanel?.();
    notify(`✅ ${dn} a été admis`);
  });

  socket.on('meeting_waiting_moved', ({ reason }) => {
    setSessionCache({ displayName: MeetState.displayName, approved: false });
    showWaitingRoom();
    notify(reason || "Vous avez été déplacé en salle d'attente");
  });

  socket.on('meeting_removed', ({ reason }) => {
    setSessionCache({ displayName: MeetState.displayName, approved: false });
    document.getElementById('waiting-room')?.remove();
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;z-index:999;';
    div.innerHTML = `<div style="width:56px;height:56px;border-radius:16px;background:rgba(248,113,113,0.15);display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text1);">Vous avez été retiré</div><div style="font-size:13px;color:var(--muted);margin-top:6px;">${escHtml(reason || "L'organisateur a retiré votre accès à la réunion.")}</div></div><button onclick="window.location.href='/mail'" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Retour</button>`;
    document.body.appendChild(div);
  });

  socket.on('meeting_banned', ({ reason }) => {
    setSessionCache({ displayName: MeetState.displayName, approved: false });
    localStorage.setItem(`meeting_banned:${MeetState.MEETING_ID}`, '1');
    document.getElementById('waiting-room')?.remove();
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;z-index:999;';
    div.innerHTML = `<div style="width:56px;height:56px;border-radius:16px;background:rgba(220,38,38,0.16);display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg></div><div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text1);">Accès bloqué</div><div style="font-size:13px;color:var(--muted);margin-top:6px;">${escHtml(reason || 'Vous avez été banni de cette réunion.')}</div></div><button onclick="window.location.href='/mail'" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Retour</button>`;
    document.body.appendChild(div);
  });

  // ── Entrée dans la salle (après approbation) — initialisation SFU ───────────
  socket.on('meeting_peers_list', async ({ peers: existingPeers }) => {
    setSessionCache({ displayName: MeetState.displayName, approved: true });
    if (document.getElementById('room').style.display === 'none' || document.getElementById('room').style.display === '') { enterRoom(); }

    // Enregistrer les métadonnées de chaque pair et créer les tuiles (sans flux — ils arriveront via sfu:newProducer)
    for (const p of existingPeers) {
      delete MeetState.audioDiagnostics[p.socketId];
      MeetState.peerMeta[p.socketId] = { email: p.email, name: p.displayName, isSharing: p.isSharing || false, isCatalyst: !!p.isCatalyst };
      MeetState.peers[p.socketId]    = { email: p.email, name: p.displayName, isSharing: p.isSharing || false };
      addTile(p.socketId, p.email, p.displayName, null, false);
      updatePeerCatalystBadge?.(p.socketId, !!p.isCatalyst);
    }

    // Initialiser mediasoup : récupérer les routerRtpCapabilities puis créer Device + transports
    socket.emit('sfu:getRouterRtpCapabilities', { meetingId: MeetState.MEETING_ID }, async (res) => {
      if (res.error) { console.error('[SFU] Impossible de récupérer les capabilities:', res.error); return; }
      const ok = await sfuInit(res.routerRtpCapabilities);
      if (!ok) { console.error('[SFU] Échec initialisation Device'); return; }

      // Informer le serveur que ce client a rejoint la room SFU
      socket.emit('sfu:join', { meetingId: MeetState.MEETING_ID }, async (joinRes) => {
        if (joinRes?.error) { console.error('[SFU] sfu:join error:', joinRes.error); return; }

        // Publier le micro
        if (MeetState.micEnabled) await sfuProduce('audio');
        // Publier la caméra si active
        if (MeetState.camEnabled) await sfuProduce('camera');

        // Consommer les producers existants que le serveur nous envoie
        if (Array.isArray(joinRes.producers)) {
          for (const prod of joinRes.producers) {
            await sfuConsume(prod);
          }
        }

        // Démarrer le monitoring local
        startLocalQualityMonitor?.();
      });
    });
  });

  socket.on('meeting_peer_joined', async ({ socketId, email, displayName: dn, isSharing, isCatalyst }) => {
    notify(`${dn || email} a rejoint la réunion`);
    delete MeetState.audioDiagnostics[socketId];
    MeetState.peerMeta[socketId] = { email, name: dn, isSharing: !!isSharing, isCatalyst: !!isCatalyst };
    MeetState.peers[socketId]    = { email, name: dn, isSharing: !!isSharing };
    addTile(socketId, email, dn, null, false);
    socket.emit('meeting_media_state', { meetingId: MeetState.MEETING_ID, mic: MeetState.micEnabled, camera: MeetState.camEnabled });
    renderAdminPanel?.();
  });

  socket.on('meeting_peer_left', ({ socketId }) => {
    const p = MeetState.peers[socketId];
    if (p) { notify(`${p.name || 'Un participant'} a quitté`); }
    delete MeetState.peers[socketId];
    delete MeetState.peerMeta[socketId];
    delete MeetState.audioDiagnostics[socketId];
    delete MeetState.defaultSenderParams[socketId];
    // Nettoyer les consumers SFU liés à ce peer
    for (const [cid, entry] of Object.entries(MeetState.sfuConsumers)) {
      if (entry.peerId === socketId) { try { entry.consumer.close(); } catch(_) {} delete MeetState.sfuConsumers[cid]; }
    }
    removeTile(socketId);
    renderParticipationPanel?.();
    document.getElementById('we-' + socketId)?.remove();
    renderAdminPanel?.();
  });

  // ── Signaling SFU ─────────────────────────────────────────────────────────

  /**
   * Le serveur nous notifie qu'un nouveau producer est disponible.
   * On le consomme immédiatement si le Device est prêt.
   */
  socket.on('sfu:newProducer', async ({ producerId, peerId, source, kind, email, displayName }) => {
    if (!MeetState.sfuReady) {
      console.warn('[SFU] sfu:newProducer reçu avant que le Device soit prêt — ignoré (le join le traitera)');
      return;
    }
    // Ne pas consommer ses propres producers
    if (peerId === socket.id) return;
    await sfuConsume({ producerId, peerId, source, kind, email, displayName });
  });

  /**
   * Un producer distant a été fermé (peer parti, mic coupé, partage arrêté…).
   */
  socket.on('sfu:producerClosed', ({ producerId }) => {
    sfuOnProducerClosed({ producerId });
  });

  // ── Nettoyage forcé (reconnexion admin / rejoin) ───────────────────────────
  socket.on('meeting_force_cleanup', ({ reason }) => {
    sfuCleanup?.();
    for (const sid of Object.keys(MeetState.peers || {})) {
      delete MeetState.peers[sid];
      delete MeetState.peerMeta[sid];
      removeTile?.(sid);
    }
    MeetState.audioDiagnostics = {};
    notify(reason === 'rejoin' ? 'Reconnexion propre en cours…' : 'Nettoyage de session en cours…');
  });

  // ── Permissions ───────────────────────────────────────────────────────────
  socket.on('meeting_permissions_sync', ({ permissions, socketId, mine }) => {
    if (socketId) MeetState.participantPermissions[socketId] = permissions || {};
    if (mine) {
      MeetState.forcedMute    = !!permissions?.forceMuted;
      MeetState.canUnmute     = permissions?.canUnmute !== false;
      MeetState.isReadOnly    = !!permissions?.readOnly;
      MeetState.canUseCamera  = permissions?.canUseCamera !== false;
      MeetState.canShareScreen = permissions?.canShareScreen !== false;
      MeetState.canChat       = permissions?.canChat !== false;
    }
    renderAdminPanel?.();
  });


  socket.on('meeting_role_sync', ({ socketId, email, displayName, role, enabled, mine }) => {
    if (role !== 'catalyst') return;
    if (socketId) {
      MeetState.peerMeta[socketId] = MeetState.peerMeta[socketId] || {};
      MeetState.peerMeta[socketId].email = email || MeetState.peerMeta[socketId].email || '';
      MeetState.peerMeta[socketId].name = displayName || MeetState.peerMeta[socketId].name || '';
      MeetState.peerMeta[socketId].isCatalyst = !!enabled;
      updatePeerCatalystBadge?.(socketId, !!enabled);
    }
    if (mine || (email && String(email).trim().toLowerCase() === String(MeetState.USER_EMAIL || '').trim().toLowerCase())) {
      MeetState.IS_CATALYST = !!enabled;
      notify(enabled ? 'Vous êtes maintenant Catalyst' : 'Vos droits Catalyst ont été retirés');
      meetingApplyControlPowerUI?.();
      renderAdminPanel?.();
      renderParticipationPanel?.();
    }
  });

  socket.on('meeting_timer_sync', (payload) => {
    syncMeetingTimer?.(payload || {});
  });

  socket.on('meeting_extension_prompt', ({ expiresAt }) => {
    showMeetingExtensionPrompt?.(expiresAt);
  });

  socket.on('meeting_extended', ({ minutes, expiresAt }) => {
    dismissMeetingExtensionPrompt?.();
    MeetState.extensionPromptFor = null;
    if (expiresAt) syncMeetingTimer?.({ startedAt: MeetState.startTime ? new Date(MeetState.startTime).toISOString() : null, expiresAt });
    notify(`Réunion prolongée de ${minutes} min`);
  });

  socket.on('meeting_admin_state', ({ logs, lock }) => {
    MeetState.adminLogs      = Array.isArray(logs) ? logs.slice() : [];
    MeetState.meetingLocked  = !!lock?.locked;
    MeetState.meetingLockMode = lock?.mode || 'waiting';
    renderAdminPanel?.();
  });

  socket.on('meeting_admin_log_sync', ({ logs }) => {
    MeetState.adminLogs = Array.isArray(logs) ? logs.slice() : [];
    renderAdminPanel?.();
  });

  socket.on('meeting_lock_state', ({ locked, mode }) => {
    MeetState.meetingLocked   = !!locked;
    MeetState.meetingLockMode = mode || 'waiting';
    notify(locked ? 'Réunion verrouillée' : 'Réunion déverrouillée');
    renderAdminPanel?.();
  });

  socket.on('meeting_allow_to_speak', ({ by }) => {
    notify((by || 'Admin') + ' vous autorise à parler');
    if (MeetState.forcedMute) { MeetState.forcedMute = false; MeetState.canUnmute = true; }
  });

  socket.on('meeting_permission_denied', ({ feature }) => {
    notify(`Action refusée par l'administration: ${feature}`);
  });

  socket.on('meeting_disable_camera', async () => {
    if (MeetState.camEnabled) {
      MeetState.canUseCamera = false;
      MeetState.camEnabled   = false;
      await applyCamState?.();
    }
  });

  socket.on('meeting_disable_screen_share', async () => {
    MeetState.canShareScreen = false;
    if (MeetState.screenEnabled) await toggleScreen?.();
  });

  socket.on('meeting_temp_expelled', ({ until, manual }) => {
    setSessionCache({ displayName: MeetState.displayName, approved: false });
    document.getElementById('waiting-room')?.remove();
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;z-index:999;';
    div.innerHTML = `<div style="width:56px;height:56px;border-radius:16px;background:rgba(245,158,11,0.16);display:flex;align-items:center;justify-content:center;">⏳</div><div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text1);">Accès suspendu</div><div style="font-size:13px;color:var(--muted);margin-top:6px;">${manual ? 'Vous pourrez revenir après validation manuelle.' : ('Réessayez plus tard' + (until && until !== 'end' ? ' — jusqu\'à ' + new Date(until).toLocaleTimeString() : ''))}</div></div><button onclick="window.location.href='/mail'" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Retour</button>`;
    document.body.appendChild(div);
  });

  socket.on('meeting_ended', () => {
    notify("La réunion a été terminée par l'hôte");
    try { localStorage.removeItem('meeting_session_' + MeetState.MEETING_ID); } catch(_) {}
    MeetState.localStream?.getTracks().forEach(t => t.stop());
    sfuCleanup?.();
    setTimeout(() => showReviewModal(), 1500);
  });

  socket.on('meeting_screen_share', ({ socketId: sid, sharing }) => {
    applyScreenShare(sid, sharing);
    const name = MeetState.peers[sid]?.name || MeetState.peerMeta[sid]?.name || 'Quelqu\'un';
    notify(sharing ? name + ' partage son écran' : name + ' a arrêté le partage');
  });

  // ── Host mute / unmute ────────────────────────────────────────────────────
  socket.on('host_mute', async () => {
    MeetState.micEnabled = false;
    // Pause du producer audio SFU
    await sfuPauseProducer?.('audio');
    MeetState.localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
    const micBtn = document.getElementById('btn-mic');
    if (micBtn) micBtn.className = 'ctrl-btn inactive';
    document.getElementById('mic-on-ico').style.display  = 'none';
    document.getElementById('mic-off-ico').style.display = 'block';
    document.getElementById('muted-local')?.classList.add('show');
    socket.emit('meeting_media_state', { meetingId: MeetState.MEETING_ID, mic: false, camera: MeetState.camEnabled });
    notify('[Micro coupé] L\'hôte a coupé votre micro');
  });

  socket.on('host_unmute', async () => {
    MeetState.micEnabled = true;
    // Résumer le producer audio SFU
    await sfuResumeProducer?.('audio');
    MeetState.localStream?.getAudioTracks().forEach(t => { t.enabled = true; });
    const micBtn = document.getElementById('btn-mic');
    if (micBtn) micBtn.className = 'ctrl-btn active';
    document.getElementById('mic-on-ico').style.display  = 'block';
    document.getElementById('mic-off-ico').style.display = 'none';
    document.getElementById('muted-local')?.classList.remove('show');
    socket.emit('meeting_media_state', { meetingId: MeetState.MEETING_ID, mic: true, camera: MeetState.camEnabled });
    notify("L'hôte a réactivé votre micro");
  });

  // ── Réactions ─────────────────────────────────────────────────────────────
  socket.on('meeting_reaction', ({ displayName: dn, emoji }) => {
    const x = 100 + Math.random() * (window.innerWidth - 200);
    flyEmoji(emoji, x, window.innerHeight - 80);
    notify((dn || 'Quelqu\'un') + ' a réagi ' + emoji);
  });

  // ── Lever la main ─────────────────────────────────────────────────────────
  socket.on('meeting_hand_raise', ({ socketId, displayName: dn, raised }) => {
    const hand = document.getElementById('hand-' + socketId);
    if (hand) hand.classList.toggle('raised', raised);
    if (raised) {
      MeetState.handOrder++;
      MeetState.handQueue.set(socketId, MeetState.handOrder);
      setHandBadge(socketId, MeetState.handOrder);
      notify(`✋ ${dn || 'Quelqu\'un'} lève la main (#${MeetState.handOrder})`);
    } else {
      MeetState.handQueue.delete(socketId);
      setHandBadge(socketId, null);
      renumberHands();
    }
  });

  // ── État micro / caméra ───────────────────────────────────────────────────
  socket.on('meeting_media_state', ({ socketId, mic, camera }) => {
    const muted = document.getElementById('muted-' + socketId);
    if (muted) muted.classList.toggle('show', !mic);
    const tile = document.getElementById('tile-' + socketId);
    if (tile) tile.classList.toggle('cam-off', !camera);
  });

  // ── Chat ──────────────────────────────────────────────────────────────────
  socket.on('meeting_chat', ({ id, email: senderEmail, displayName: dn, text, at, anonymous, fileUrl, fileName, fileSize, fileType, fileId }) => {
    const isMine = senderEmail === MeetState.USER_EMAIL;
    const senderLabel = meetingChatSenderLabel({ email: senderEmail, displayName: dn, anonymous }, isMine);
    appendChat(senderLabel, text, at, isMine, { fileUrl, fileName, fileSize, fileType, fileId }, anonymous, { id });

    if (!isMine && text) {
      const lower    = text.toLowerCase();
      const myName   = (MeetState.displayName || '').toLowerCase();
      const myAlias  = (MeetState.USER_EMAIL || '').split('@')[0].toLowerCase();
      const mentionedMe       = (myName && lower.includes('@' + myName)) || (myAlias && lower.includes('@' + myAlias));
      const mentionedEveryone = meetingChatTextContainsEveryone(text);
      if (mentionedMe || mentionedEveryone) {
        playMentionSound();
        notify(mentionedEveryone ? '💬 Un message a mentionné tout le monde' : `💬 ${senderLabel} vous a mentionné dans le chat`);
        const badge = document.getElementById('chat-badge');
        if (badge && !MeetState.chatOpen) { badge.style.background = '#f87171'; badge.style.display = 'flex'; }
      }
    }

    if (!MeetState.chatOpen && !isMine) {
      MeetState.unreadCount++;
      const badge = document.getElementById('chat-badge');
      if (badge) {
        badge.style.display = 'flex';
        badge.textContent   = MeetState.unreadCount;
        badge.style.animation = 'none';
        requestAnimationFrame(() => { badge.style.animation = 'badgePop .2s ease'; });
      }
      clearTimeout(MeetState.badgeTimer);
      MeetState.badgeTimer = setTimeout(() => {
        if (badge && !badge.style.background?.includes('f87171')) badge.style.display = 'none';
        MeetState.unreadCount = 0;
      }, 3000);
    }
  });

  socket.on('meeting_chat_history', ({ messages }) => {
    if (!messages?.length) return;
    messages.forEach(m => {
      const isMine = m.email === MeetState.USER_EMAIL;
      const senderLabel = meetingChatSenderLabel(m, isMine);
      appendChat(senderLabel, m.text, m.at, isMine, { fileUrl: m.fileUrl, fileName: m.fileName, fileSize: m.fileSize, fileType: m.fileType, fileId: m.fileId }, m.anonymous, { id: m.id });
    });
  });
}
