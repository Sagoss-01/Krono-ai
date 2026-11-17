/**
 * meeting-webrtc.js  — SFU mediasoup
 *
 * Ce fichier remplace intégralement la logique RTCPeerConnection P2P de réunion.
 * Il gère :
 *   - chargement du Device mediasoup-client (via window.TechSphereMediasoupClient)
 *   - création du sendTransport et du recvTransport
 *   - produce() pour audio / caméra / écran
 *   - consume() pour les producteurs distants
 *   - tuiles vidéo / grille (inchangées)
 *
 * Tout ce qui concerne le signaling P2P (RTCPeerConnection, offer/answer/ice)
 * a été supprimé — voir meeting-socket.js pour les événements Socket.IO SFU.
 */

// ── Helpers UI ────────────────────────────────────────────────────────────────

function meetingGetRemoteStream(peerId, source) {
  const key = `${peerId}::${source}`;
  if (!MeetState.sfuRemoteStreams[key]) MeetState.sfuRemoteStreams[key] = new MediaStream();
  return MeetState.sfuRemoteStreams[key];
}

// Rétrocompatibilité avec les fonctions qui utilisent remoteStreams[socketId]
function meetingGetRemoteStreamLegacy(socketId) {
  if (!MeetState.remoteStreams[socketId]) MeetState.remoteStreams[socketId] = new MediaStream();
  return MeetState.remoteStreams[socketId];
}

function meetingGetActiveVideoTrack() {
  if (MeetState.screenEnabled && MeetState.screenTrack && MeetState.screenTrack.readyState === 'live') return MeetState.screenTrack;
  const preferred = MeetState.cameraTrackBeforeScreen;
  if (preferred && preferred.readyState === 'live' && MeetState.camEnabled) return preferred;
  return MeetState.localStream?.getVideoTracks().find(t => t.readyState === 'live') || null;
}

// ── Indicateur qualité connexion (basé sur les stats SFU) ────────────────────

function updateConnectionQuality(id, quality) {
  const tile = document.getElementById('tile-' + id);
  if (!tile) return;
  let el = tile.querySelector('.conn-quality');
  if (!el) {
    el = document.createElement('div');
    el.className = 'conn-quality';
    el.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;align-items:flex-end;gap:2px;height:14px;z-index:10;';
    tile.appendChild(el);
  }
  const color  = quality === 'good' ? '#22c55e' : quality === 'medium' ? '#f59e0b' : '#f87171';
  const active = quality === 'good' ? 3 : quality === 'medium' ? 2 : 1;
  el.innerHTML = [1,2,3].map(i =>
    `<div style="width:3px;border-radius:1px;background:${i<=active?color:'rgba(255,255,255,0.2)'};height:${4+i*3}px;transition:all .4s;"></div>`
  ).join('');
  el.title = quality === 'good' ? 'Connexion bonne' : quality === 'medium' ? 'Connexion instable' : 'Connexion mauvaise';
}

function playConnectionWarning(quality) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(quality === 'poor' ? 330 : 440, ctx.currentTime);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
  } catch(_) {}
}

// Monitoring qualité locale — basé sur le sendTransport SFU
let _localQualityInterval  = null;
let _lastLocalQuality     = 'good';
let _lastLocalQualityNotif = 0;

function startLocalQualityMonitor() {
  clearInterval(_localQualityInterval);
  _localQualityInterval = setInterval(async () => {
    const transport = MeetState.sfuSendTransport;
    if (!transport) return;
    try {
      const stats = await transport.getStats();
      let rtt = null, lost = 0, sent = 0;
      stats.forEach(r => {
        if (r.type === 'remote-inbound-rtp') {
          if (r.roundTripTime !== undefined) rtt = r.roundTripTime * 1000;
          if (r.packetsLost   !== undefined) lost = r.packetsLost;
        }
        if (r.type === 'outbound-rtp' && r.packetsSent) sent = r.packetsSent;
      });
      const lossRate = sent > 0 ? (lost / sent) * 100 : 0;
      const quality  = (rtt === null || (rtt < 150 && lossRate < 3)) ? 'good'
                     : (rtt < 300 && lossRate < 10)                   ? 'medium' : 'poor';
      updateConnectionQuality('local', quality);
      MeetState.audioDiagnostics = MeetState.audioDiagnostics || {};
      MeetState.audioDiagnostics.local = { ...(MeetState.audioDiagnostics.local || {}), selectedPair: { currentRoundTripTime: rtt !== null ? rtt / 1000 : null }, inboundAudio: { packetsLost: lost, jitter: null }, connectionState: transport.connectionState || '' };
      renderParticipationPanel?.();
      meetingMaybeSuggestBitrateReduction(quality);
      if (quality !== _lastLocalQuality && quality !== 'good') {
        const now = Date.now();
        if (!_lastLocalQualityNotif || now - _lastLocalQualityNotif > 300000) {
          notify(quality === 'medium' ? '⚠️ Votre connexion est instable' : '🔴 Votre connexion est très mauvaise');
          playConnectionWarning(quality);
          _lastLocalQualityNotif = now;
        }
      }
      _lastLocalQuality = quality;
    } catch(_) {}
  }, 3000);
}


function meetingUpdateRemoteConnectionQuality(peerId, diag = {}) {
  MeetState.audioDiagnostics = MeetState.audioDiagnostics || {};
  MeetState.audioDiagnostics[peerId] = { ...(MeetState.audioDiagnostics[peerId] || {}), ...diag, at: Date.now() };
  const quality = meetingConnectionQuality?.(MeetState.audioDiagnostics[peerId]) || { label: 'Bon' };
  const mapped = quality.label === 'Bon' ? 'good' : (quality.label === 'Moyen' ? 'medium' : 'poor');
  updateConnectionQuality(peerId, mapped);
}

async function meetingCollectSfuDiagnostics() {
  if (!MeetState.socket) return;
  meetingUpdateRemoteConnectionQuality('local', MeetState.audioDiagnostics?.local || {});
  const now = Date.now();
  const recvTransport = MeetState.sfuRecvTransport;
  if (recvTransport) {
    try {
      const tstats = await recvTransport.getStats();
      let selectedPair = null;
      let transportState = recvTransport.connectionState || '';
      tstats.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.selected || r.nominated || r.state === 'succeeded')) {
          selectedPair = {
            currentRoundTripTime: r.currentRoundTripTime ?? null,
            availableOutgoingBitrate: r.availableOutgoingBitrate ?? null,
            localType: r.localCandidateType || null,
            remoteType: r.remoteCandidateType || null,
          };
        }
      });
      const consumersByPeer = {};
      Object.values(MeetState.sfuConsumers || {}).forEach(({ consumer, peerId, source, kind }) => {
        if (!peerId) return;
        consumersByPeer[peerId] = consumersByPeer[peerId] || [];
        consumersByPeer[peerId].push({ consumer, source, kind });
      });
      for (const [peerId, entries] of Object.entries(consumersByPeer)) {
        const diag = { selectedPair, connectionState: transportState };
        for (const entry of entries) {
          try {
            const cstats = await entry.consumer.getStats();
            cstats.forEach((r) => {
              if (r.type === 'inbound-rtp') {
                if (entry.kind === 'audio') diag.inboundAudio = { packetsLost: r.packetsLost ?? null, jitter: r.jitter ?? null, bytesReceived: r.bytesReceived ?? null };
                if (entry.kind === 'video') diag.inboundVideo = { packetsLost: r.packetsLost ?? null, jitter: r.jitter ?? null, bytesReceived: r.bytesReceived ?? null, framesDecoded: r.framesDecoded ?? null };
              }
            });
          } catch (_) {}
        }
        meetingUpdateRemoteConnectionQuality(peerId, diag);
      }
    } catch (_) {}
  }
  renderParticipationPanel?.();
}

function startSfuDiagnosticsMonitor() {
  if (MeetState.audioDiagTimer) clearInterval(MeetState.audioDiagTimer);
  MeetState.audioDiagTimer = setInterval(() => { meetingCollectSfuDiagnostics().catch?.(() => {}); }, 4000);
  meetingCollectSfuDiagnostics().catch?.(() => {});
}

function meetingMaybeSuggestBitrateReduction(quality) {
  if (quality === 'good') {
    MeetState._badConnectionToastShown = false;
    document.getElementById('network-assist-toast')?.remove();
    return;
  }
  if (MeetState._badConnectionToastShown) return;
  MeetState._badConnectionToastShown = true;
  const old = document.getElementById('network-assist-toast');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'network-assist-toast';
  box.style.cssText = 'position:fixed;left:18px;bottom:92px;z-index:10040;width:320px;max-width:calc(100vw - 24px);background:var(--bg2);border:1px solid rgba(245,158,11,.28);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:14px;';
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start;">
    <div style="width:40px;height:40px;border-radius:12px;background:rgba(245,158,11,.14);display:flex;align-items:center;justify-content:center;flex-shrink:0;">📶</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:800;color:var(--text1);margin-bottom:4px;">Connexion instable</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.45;margin-bottom:10px;">Passe en mode vidéo réduit pour mieux entendre et alléger la réunion.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="MeetApp.toggleBitrateReduction();document.getElementById('network-assist-toast')?.remove();" style="padding:8px 12px;border:none;border-radius:10px;background:rgba(3,92,128,.16);color:var(--accent);font-weight:800;cursor:pointer;">Réduire</button>
        <button onclick="document.getElementById('network-assist-toast')?.remove();" style="padding:8px 12px;border:none;border-radius:10px;background:rgba(255,255,255,.06);color:var(--text2);font-weight:700;cursor:pointer;">Plus tard</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(box);
}

// ── Initialisation SFU ────────────────────────────────────────────────────────

/**
 * Charge le mediasoup-client Device et crée les deux transports (send + recv).
 * Appelé depuis meeting-socket.js après réception de 'sfu:routerCapabilities'.
 */
async function sfuInit(routerRtpCapabilities) {
  const mediasoupClient = window.TechSphereMediasoupClient;
  if (!mediasoupClient) {
    console.error('[SFU] mediasoup-client introuvable — vérifier le bundle');
    return false;
  }

  try {
    // 1. Créer et charger le Device
    const device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities });
    MeetState.sfuDevice = device;
    console.log('[SFU] Device chargé. Peut envoyer audio:', device.canProduce('audio'), 'vidéo:', device.canProduce('video'));

    // 2. Créer le transport d'envoi
    await sfuCreateSendTransport();

    // 3. Créer le transport de réception
    await sfuCreateRecvTransport();

    MeetState.sfuReady = true;
    return true;
  } catch (err) {
    console.error('[SFU] Erreur initialisation:', err);
    return false;
  }
}

async function sfuCreateSendTransport() {
  return new Promise((resolve, reject) => {
    MeetState.socket.emit('sfu:createTransport', { meetingId: MeetState.MEETING_ID, direction: 'send' }, async (res) => {
      if (res.error) return reject(new Error(res.error));
      try {
        const transport = MeetState.sfuDevice.createSendTransport(res);
        _attachTransportEvents(transport, 'send');
        MeetState.sfuSendTransport = transport;
        resolve(transport);
      } catch (err) { reject(err); }
    });
  });
}

async function sfuCreateRecvTransport() {
  return new Promise((resolve, reject) => {
    MeetState.socket.emit('sfu:createTransport', { meetingId: MeetState.MEETING_ID, direction: 'recv' }, async (res) => {
      if (res.error) return reject(new Error(res.error));
      try {
        const transport = MeetState.sfuDevice.createRecvTransport(res);
        _attachTransportEvents(transport, 'recv');
        MeetState.sfuRecvTransport = transport;
        resolve(transport);
      } catch (err) { reject(err); }
    });
  });
}

function _attachTransportEvents(transport, direction) {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    MeetState.socket.emit('sfu:connectTransport', {
      meetingId: MeetState.MEETING_ID,
      transportId: transport.id,
      dtlsParameters,
    }, (res) => {
      if (res?.error) errback(new Error(res.error));
      else callback();
    });
  });

  if (direction === 'send') {
    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      MeetState.socket.emit('sfu:produce', {
        meetingId: MeetState.MEETING_ID,
        transportId: transport.id,
        kind,
        rtpParameters,
        appData,
      }, (res) => {
        if (res?.error) errback(new Error(res.error));
        else callback({ id: res.producerId });
      });
    });
  }

  transport.on('connectionstatechange', (state) => {
    console.log(`[SFU] transport ${direction} state:`, state);
    if (state === 'failed') {
      notify('⚠️ Connexion SFU interrompue — vérifiez votre réseau');
    }
  });
}

// ── Producers locaux ──────────────────────────────────────────────────────────

async function sfuProduce(source, explicitTrack = null) {
  if (!MeetState.sfuReady || !MeetState.sfuSendTransport) {
    console.warn('[SFU] produce() appelé avant que le transport soit prêt');
    return null;
  }

  // Fermer l'ancien producer pour cette source si existant
  await sfuCloseProducer(source);

  let track = null;
  try {
    if (source === 'audio') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      track = stream.getAudioTracks()[0];
      // Ajouter au localStream si pas déjà présent
      if (!MeetState.localStream) MeetState.localStream = new MediaStream();
      const existing = MeetState.localStream.getAudioTracks()[0];
      if (existing) { try { existing.stop(); } catch(_) {} MeetState.localStream.removeTrack(existing); }
      MeetState.localStream.addTrack(track);
    } else if (!track && source === 'camera') {
      track = MeetState.localStream?.getVideoTracks().find(t => t.readyState === 'live' && (!MeetState.screenTrack || t.id !== MeetState.screenTrack.id)) || null;
      if (!track) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        track = stream.getVideoTracks()[0];
        if (!MeetState.localStream) MeetState.localStream = new MediaStream();
        MeetState.localStream.addTrack(track);
      }
    } else if (!track && source === 'screen') {
      track = MeetState.screenTrack;
      if (!track || track.readyState !== 'live') {
        console.warn('[SFU] Pas de screenTrack disponible pour produce');
        return null;
      }
    } else {
      console.warn('[SFU] Source inconnue:', source);
      return null;
    }

    const producer = await MeetState.sfuSendTransport.produce({
      track,
      appData: { source, peerId: MeetState.socket.id },
      ...(source === 'camera' || source === 'screen' ? { encodings: _videoEncodings(source) } : {}),
    });

    producer.on('trackended', () => {
      console.log('[SFU] Track ended pour', source);
      sfuCloseProducer(source);
    });

    producer.on('transportclose', () => { delete MeetState.sfuProducers[source]; });

    MeetState.sfuProducers[source] = producer;
    console.log('[SFU] Producer créé:', source, producer.id);
    return producer;
  } catch (err) {
    console.error('[SFU] Erreur produce', source, err);
    return null;
  }
}

function _videoEncodings(source) {
  if (source === 'screen') {
    return [{ maxBitrate: 1500000, scaleResolutionDownBy: 1 }];
  }
  // Simulcast caméra : 3 couches
  return [
    { rid: 'r0', maxBitrate:  80000, scaleResolutionDownBy: 4 },
    { rid: 'r1', maxBitrate: 300000, scaleResolutionDownBy: 2 },
    { rid: 'r2', maxBitrate: 900000, scaleResolutionDownBy: 1 },
  ];
}

async function sfuCloseProducer(source) {
  const producer = MeetState.sfuProducers[source];
  if (!producer) return;
  try { producer.close(); } catch(_) {}
  delete MeetState.sfuProducers[source];
  // Notifier le serveur
  MeetState.socket?.emit('sfu:closeProducer', { meetingId: MeetState.MEETING_ID, producerId: producer.id });
}

async function sfuPauseProducer(source) {
  const producer = MeetState.sfuProducers[source];
  if (!producer || producer.paused) return;
  await producer.pause();
  MeetState.socket?.emit('sfu:pauseProducer', { meetingId: MeetState.MEETING_ID, producerId: producer.id });
}

async function sfuResumeProducer(source) {
  const producer = MeetState.sfuProducers[source];
  if (!producer || !producer.paused) return;
  await producer.resume();
  MeetState.socket?.emit('sfu:resumeProducer', { meetingId: MeetState.MEETING_ID, producerId: producer.id });
}

// ── Consumers distants ────────────────────────────────────────────────────────

/**
 * Consommer un producer distant.
 * Appelé depuis meeting-socket.js sur réception de 'sfu:newProducer'.
 */
async function sfuConsume({ producerId, peerId, source, kind, email, displayName }) {
  if (!MeetState.sfuReady || !MeetState.sfuRecvTransport) {
    console.warn('[SFU] consume() appelé avant que le transport soit prêt');
    return;
  }
  if (!MeetState.sfuDevice.rtpCapabilities) {
    console.warn('[SFU] Device pas encore chargé');
    return;
  }

  MeetState.socket.emit('sfu:consume', {
    meetingId: MeetState.MEETING_ID,
    transportId: MeetState.sfuRecvTransport.id,
    producerId,
    rtpCapabilities: MeetState.sfuDevice.rtpCapabilities,
  }, async (res) => {
    if (res.error) { console.error('[SFU] consume error:', res.error); return; }

    try {
      const consumer = await MeetState.sfuRecvTransport.consume({
        id:            res.id,
        producerId:    res.producerId,
        kind:          res.kind,
        rtpParameters: res.rtpParameters,
        appData:       { peerId, source },
      });

      // Stocker dans la map
      MeetState.sfuConsumers[consumer.id] = { consumer, peerId, source, kind: res.kind };
      MeetState.sfuProducerMap[producerId] = { peerId, source, kind: res.kind, email, displayName };

      // Attacher la track au stream distant
      const stream = meetingGetRemoteStream(peerId, source);
      // Retirer l'ancienne track du même kind si présente
      stream.getTracks().filter(t => t.kind === res.kind).forEach(t => { try { stream.removeTrack(t); } catch(_) {} });
      stream.addTrack(consumer.track);

      // Mettre à jour aussi le remoteStreams legacy (pour compatibilité UI)
      const legacyStream = meetingGetRemoteStreamLegacy(peerId);
      if (!legacyStream.getTracks().find(t => t.id === consumer.track.id)) {
        legacyStream.getTracks().filter(t => t.kind === res.kind).forEach(t => { try { legacyStream.removeTrack(t); } catch(_) {} });
        legacyStream.addTrack(consumer.track);
      }

      // Créer ou mettre à jour la tuile
      _sfuAttachStreamToTile(peerId, source, email, displayName, stream, legacyStream, consumer.track);

      // Résumer le consumer côté serveur
      MeetState.socket.emit('sfu:resumeConsumer', {
        meetingId: MeetState.MEETING_ID,
        consumerId: consumer.id,
      });

      consumer.on('transportclose', () => { delete MeetState.sfuConsumers[consumer.id]; });
      consumer.on('producerclose', () => {
        delete MeetState.sfuConsumers[consumer.id];
        _sfuOnProducerClosed(producerId, peerId, source, res.kind);
      });

      console.log('[SFU] Consumer créé:', res.kind, source, 'pour', peerId);
    } catch (err) {
      console.error('[SFU] Erreur consumer.consume()', err);
    }
  });
}

function _sfuAttachStreamToTile(peerId, source, email, displayName, stream, legacyStream, track) {
  let tile = document.getElementById('tile-' + peerId);
  if (!tile) {
    addTile(peerId, email, displayName, legacyStream, false);
    tile = document.getElementById('tile-' + peerId);
  }

  if (track.kind === 'video') {
    const vid = tile?.querySelector('video');
    if (vid) {
      // Pour le partage d'écran, on préfère son stream dédié
      const currentSrc = (source === 'screen') ? stream : legacyStream;
      if (vid.srcObject !== currentSrc) vid.srcObject = currentSrc;
      vid.play().catch(() => {});
    }
    if (source === 'screen') {
      applyScreenShare(peerId, true);
    } else {
      tile?.classList.remove('cam-off');
    }
    track.onmute   = () => { if (source !== 'screen') tile?.classList.add('cam-off'); };
    track.onunmute = () => { tile?.classList.remove('cam-off'); vid?.play().catch(() => {}); };
    track.onended  = () => {
      try { stream.removeTrack(track); legacyStream.removeTrack(track); } catch(_) {}
      if (source === 'screen') applyScreenShare(peerId, false);
      else { const hasVid = legacyStream.getVideoTracks().some(t => t.readyState === 'live'); tile?.classList.toggle('cam-off', !hasVid); }
    };
  }
  if (track.kind === 'audio') {
    const vid = tile?.querySelector('video');
    if (vid && vid.srcObject !== legacyStream) vid.srcObject = legacyStream;
    vid?.play().catch(() => {});
    track.onended = () => { try { legacyStream.removeTrack(track); } catch(_) {} };
  }
}

function _sfuOnProducerClosed(producerId, peerId, source, kind) {
  delete MeetState.sfuProducerMap[producerId];
  // Nettoyer la track du stream
  const key = `${peerId}::${source}`;
  const stream = MeetState.sfuRemoteStreams[key];
  if (stream) stream.getTracks().filter(t => t.kind === kind).forEach(t => { try { t.stop(); stream.removeTrack(t); } catch(_) {} });
  const legacy = MeetState.remoteStreams[peerId];
  if (legacy) legacy.getTracks().filter(t => t.kind === kind).forEach(t => { try { legacy.removeTrack(t); } catch(_) {} });

  if (source === 'screen') {
    applyScreenShare(peerId, false);
  } else if (kind === 'video') {
    const hasVid = legacy?.getVideoTracks().some(t => t.readyState === 'live');
    document.getElementById('tile-' + peerId)?.classList.toggle('cam-off', !hasVid);
  }
}

/**
 * Gérer la fermeture propre d'un producer distant (événement 'sfu:producerClosed').
 */
function sfuOnProducerClosed({ producerId }) {
  const meta = MeetState.sfuProducerMap[producerId];
  if (!meta) return;

  // Trouver et fermer le consumer associé
  for (const [cid, entry] of Object.entries(MeetState.sfuConsumers)) {
    if (entry.consumer.producerId === producerId) {
      try { entry.consumer.close(); } catch(_) {}
      delete MeetState.sfuConsumers[cid];
    }
  }
  _sfuOnProducerClosed(producerId, meta.peerId, meta.source, meta.kind);
}

// ── Partage d'écran SFU ───────────────────────────────────────────────────────

async function toggleScreen() {
  const btn = document.getElementById('btn-screen');
  if (MeetState.canShareScreen === false || MeetState.isReadOnly) {
    notify("Le partage d'écran est désactivé par l'administration");
    return;
  }

  if (MeetState.screenEnabled) {
    // ── Arrêter le partage ────────────────────────────────────────────────────
    const oldScreenTrack = MeetState.screenTrack || MeetState.screenStream?.getVideoTracks?.()[0] || null;
    if (oldScreenTrack) {
      try { oldScreenTrack.removeEventListener?.('ended', MeetState._screenEndedHandler); } catch (_) {}
      try { oldScreenTrack.stop(); } catch (_) {}
    }
    try { MeetState.screenStream?.getTracks().forEach(t => { if (t !== oldScreenTrack) t.stop(); }); } catch (_) {}

    MeetState.screenStream  = null;
    MeetState.screenTrack   = null;
    MeetState.screenEnabled = false;
    if (btn) btn.className = 'ctrl-btn active';
    notify("Partage d'écran arrêté");

    // Fermer le producer screen SFU
    await sfuCloseProducer('screen');

    // Restaurer la caméra dans le producer camera
    const localTile = document.getElementById('tile-local');
    const localVid  = document.querySelector('#tile-local video');
    if (localTile) { localTile.classList.remove('screen-share'); localTile.style.height = ''; localTile.style.width = ''; }

    let cameraTrack = MeetState.cameraTrackBeforeScreen;
    if ((!cameraTrack || cameraTrack.readyState !== 'live') && MeetState.camEnabled) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraTrack = camStream.getVideoTracks()[0] || null;
      } catch (_) { cameraTrack = null; }
    }

    if (cameraTrack && MeetState.camEnabled) {
      // Remplacer la track dans le producer SFU camera
      const camProducer = MeetState.sfuProducers['camera'];
      if (camProducer) {
        try { await camProducer.replaceTrack({ track: cameraTrack }); } catch (e) {
          // Si replaceTrack échoue, recréer le producer
          await sfuProduce('camera');
        }
      } else {
        // Recréer le producer camera
        if (!MeetState.localStream) MeetState.localStream = new MediaStream();
        const oldVid = MeetState.localStream.getVideoTracks().find(t => t.readyState === 'live');
        if (oldVid && oldVid.id !== cameraTrack.id) { try { oldVid.stop(); MeetState.localStream.removeTrack(oldVid); } catch(_) {} }
        if (!MeetState.localStream.getVideoTracks().find(t => t.id === cameraTrack.id)) MeetState.localStream.addTrack(cameraTrack);
        await sfuProduce('camera');
      }
      if (localVid) { localVid.srcObject = MeetState.localStream; localVid.style.transform = 'scaleX(-1)'; localVid.style.objectFit = ''; localVid.style.background = ''; }
      localTile?.classList.remove('cam-off');
    } else {
      MeetState.localStream?.getVideoTracks().forEach(t => { t.enabled = false; });
      if (localVid) { localVid.srcObject = MeetState.localStream || null; localVid.style.transform = 'scaleX(-1)'; localVid.style.objectFit = ''; localVid.style.background = ''; }
      localTile?.classList.add('cam-off');
    }

    MeetState.cameraTrackBeforeScreen = null;
    updateGrid();
    MeetState.socket?.emit('meeting_screen_share', { meetingId: MeetState.MEETING_ID, sharing: false });
    MeetState.socket?.emit('meeting_media_state', { meetingId: MeetState.MEETING_ID, mic: MeetState.micEnabled, camera: MeetState.camEnabled });
    return;
  }

  // ── Démarrer le partage ───────────────────────────────────────────────────
  try {
    MeetState.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    MeetState.screenTrack  = MeetState.screenStream.getVideoTracks()[0] || null;
    if (!MeetState.screenTrack) throw new Error("Aucune piste vidéo d'écran disponible");

    MeetState.cameraTrackBeforeScreen = MeetState.localStream?.getVideoTracks?.().find(t => t.readyState === 'live') || null;
    MeetState.screenEnabled = true;
    if (btn) btn.className = 'ctrl-btn screen-on';
    notify("Partage d'écran démarré");

    // Publier le screen via SFU
    await sfuProduce('screen');

    // Mettre à jour l'aperçu local
    const localTile = document.getElementById('tile-local');
    const localVid  = document.querySelector('#tile-local video');
    if (localVid) { localVid.srcObject = MeetState.screenStream; localVid.style.transform = 'none'; localVid.style.objectFit = 'contain'; localVid.style.background = '#111'; }
    if (localTile) { localTile.classList.remove('cam-off'); localTile.classList.add('screen-share'); }
    updateGrid();

    MeetState.socket?.emit('meeting_screen_share', { meetingId: MeetState.MEETING_ID, sharing: true });

    MeetState._screenEndedHandler = () => { if (MeetState.screenEnabled) toggleScreen(); };
    MeetState.screenTrack.addEventListener('ended', MeetState._screenEndedHandler, { once: true });
  } catch (e) {
    MeetState.screenStream  = null;
    MeetState.screenTrack   = null;
    MeetState.screenEnabled = false;
    if (e.name === 'NotAllowedError') return;
    notify("Impossible de partager l'écran : " + e.message);
  }
}

// ── Réduction de débit (bitrate) ─────────────────────────────────────────────

async function meetingApplyBitrateMode(reduced) {
  MeetState.bitrateReduced = !!reduced;
  const producer = MeetState.sfuProducers['camera'];
  if (!producer) return;
  try {
    const params = producer.rtpSender?.getParameters?.() || {};
    if (params.encodings) {
      params.encodings.forEach(enc => { enc.maxBitrate = reduced ? 150000 : 900000; });
      await producer.rtpSender?.setParameters?.(params);
    }
  } catch (_) {}
}

// ── Tuiles vidéo & grille ─────────────────────────────────────────────────────

function addTile(id, email, name, stream, isLocal) {
  document.getElementById('tile-' + id)?.remove();
  const grid = document.getElementById('video-grid');
  const tile = document.createElement('div');
  const camOff = isLocal ? (!MeetState.camEnabled ? ' cam-off' : '') : (!stream || !stream.getVideoTracks().length ? ' cam-off' : '');
  tile.className = 'peer-tile' + camOff;
  tile.id = 'tile-' + id;

  const initials = (name || 'IN').slice(0, 2).toUpperCase();
  tile.innerHTML = `
    <video autoplay playsinline ${isLocal ? 'muted' : ''} style="transform:${isLocal ? 'scaleX(-1)' : 'none'}"></video>
    <div class="peer-avatar-tile"><div class="peer-av">${initials}</div></div>
    <div class="peer-label">
      <span class="peer-name" id="peer-name-${id}">${escHtml(name)}${isLocal ? ' (vous)' : ''}</span>
      <span class="peer-muted" id="muted-${id}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
      </span>
      ${meetingHasControlPower() && !isLocal ? `<button class="host-mute-btn" id="hostmute-${id}" onclick="MeetApp.hostMutePeer('${id}')" title="Couper le micro">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
      </button>` : ''}
      ${MeetState.IS_HOST && !isLocal ? `<button class="host-mute-btn" id="catalyst-${id}" onclick="MeetApp.toggleCatalyst('${id}')" title="Donner les clés Catalyst" style="background:rgba(139,92,246,.55);">✦</button>` : ''}
    </div>
    <div class="peer-hand" id="hand-${id}">${MeetState.HAND_SVG}</div>
    <div class="speech-timer" id="speech-${id}" style="display:none;">0:00</div>`;

  // Badge qualité visible sur chaque carte
  updateConnectionQuality(id, id === 'local' ? 'good' : 'medium');

  if (stream) {
    const v = tile.querySelector('video');
    v.srcObject = stream;
    v.play().catch(() => {});
  }
  if (isLocal && !MeetState.micEnabled) tile.querySelector('.peer-muted').classList.add('show');
  meetingApplyControlPowerUI?.();

  grid.appendChild(tile);
  updateGrid();

  if (MeetState.handQueue.has(id)) {
    const num  = MeetState.handQueue.get(id);
    const hand = tile.querySelector('.peer-hand');
    if (hand) {
      hand.classList.add('raised');
      hand.innerHTML = MeetState.HAND_SVG + `<span style="position:absolute;top:-6px;right:-6px;background:#f59e0b;color:white;font-size:9px;font-weight:800;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${num}</span>`;
      hand.style.position = 'relative';
    }
  }
}

function updatePeerCatalystBadge(socketId, enabled) {
  const nameEl = document.getElementById('peer-name-' + socketId);
  if (!nameEl) return;
  const baseName = (MeetState.peerMeta[socketId]?.name || nameEl.textContent || '').replace(/\s*·\s*Catalyst$/,'').trim();
  nameEl.textContent = enabled ? `${baseName} · Catalyst` : baseName;
  const btn = document.getElementById('catalyst-' + socketId);
  if (btn) {
    btn.style.background = enabled ? 'rgba(34,197,94,.7)' : 'rgba(139,92,246,.55)';
    btn.title = enabled ? 'Retirer les clés Catalyst' : 'Donner les clés Catalyst';
  }
}

function removeTile(id) {
  document.getElementById('tile-' + id)?.remove();
  delete MeetState.remoteStreams[id];
  // Nettoyer les streams SFU pour ce peer
  for (const key of Object.keys(MeetState.sfuRemoteStreams)) {
    if (key.startsWith(id + '::')) delete MeetState.sfuRemoteStreams[key];
  }
  updateGrid();
}

function applyScreenShare(socketId, sharing) {
  const tile = document.getElementById('tile-' + socketId);
  const vid  = tile?.querySelector('video');
  if (MeetState.peers[socketId])    MeetState.peers[socketId].isSharing    = sharing;
  if (MeetState.peerMeta[socketId]) MeetState.peerMeta[socketId].isSharing = sharing;
  if (tile) tile.classList.toggle('screen-share', sharing);
  if (vid)  { vid.style.objectFit = sharing ? 'contain' : 'cover'; vid.style.background = sharing ? 'var(--bg)' : ''; }
  updateGrid();
}

function updateGrid() {
  const grid = document.getElementById('video-grid');
  const row  = document.getElementById('thumbnails-row');
  if (row) Array.from(row.children).forEach(t => grid.insertBefore(t, row));

  const allTiles   = Array.from(grid.querySelectorAll('.peer-tile'));
  const count      = allTiles.length;
  const sharingTile = allTiles.find(t => t.classList.contains('screen-share'));

  if (sharingTile) {
    grid.classList.add('focus-mode');
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows    = '';
    let thumbRow = document.getElementById('thumbnails-row');
    if (!thumbRow) { thumbRow = document.createElement('div'); thumbRow.id = 'thumbnails-row'; grid.appendChild(thumbRow); }
    allTiles.forEach(t => {
      if (t.classList.contains('screen-share')) { if (t.parentElement !== grid) grid.insertBefore(t, thumbRow); }
      else thumbRow.appendChild(t);
    });
  } else {
    grid.classList.remove('focus-mode');
    if (row) row.remove();
    allTiles.forEach(tile => {
      tile.style.height = ''; tile.style.width = '';
      const vid = tile.querySelector('video');
      if (vid && !tile.classList.contains('screen-share')) { vid.style.objectFit = ''; vid.style.background = ''; }
    });
    const isPortrait = window.innerWidth < window.innerHeight;
    if (count === 1) { grid.style.gridTemplateColumns = '1fr'; grid.style.gridTemplateRows = '1fr'; }
    else if (count === 2) {
      grid.style.gridTemplateColumns = isPortrait ? '1fr' : 'repeat(2,1fr)';
      grid.style.gridTemplateRows    = isPortrait ? '1fr 1fr' : '1fr';
    } else if (count <= 4) { grid.style.gridTemplateColumns = 'repeat(2,1fr)'; grid.style.gridTemplateRows = 'repeat(2,1fr)'; }
    else if (count <= 6)   { grid.style.gridTemplateColumns = 'repeat(3,1fr)'; grid.style.gridTemplateRows = 'repeat(2,1fr)'; }
    else                   { grid.style.gridTemplateColumns = 'repeat(3,1fr)'; grid.style.gridTemplateRows = 'repeat(3,1fr)'; }
  }
  updatePeerCount?.();
}

function updatePeerCount() {
  const tiles = document.querySelectorAll('#video-grid .peer-tile');
  const el = document.getElementById('peer-count');
  if (el) el.textContent = tiles.length;
}

// ── Nettoyage complet SFU (déconnexion / fin de réunion) ─────────────────────

function sfuCleanup() {
  // Fermer tous les producers
  for (const [source, producer] of Object.entries(MeetState.sfuProducers)) {
    try { producer.close(); } catch(_) {}
  }
  MeetState.sfuProducers = {};

  // Fermer tous les consumers
  for (const [cid, entry] of Object.entries(MeetState.sfuConsumers)) {
    try { entry.consumer.close(); } catch(_) {}
  }
  MeetState.sfuConsumers = {};
  MeetState.sfuProducerMap = {};

  // Fermer les transports
  try { MeetState.sfuSendTransport?.close(); } catch(_) {}
  try { MeetState.sfuRecvTransport?.close(); } catch(_) {}
  MeetState.sfuSendTransport = null;
  MeetState.sfuRecvTransport = null;
  MeetState.sfuDevice  = null;
  MeetState.sfuReady   = false;
  MeetState.sfuRemoteStreams = {};

  clearInterval(_localQualityInterval);
  if (MeetState.audioDiagTimer) { clearInterval(MeetState.audioDiagTimer); MeetState.audioDiagTimer = null; }
}
