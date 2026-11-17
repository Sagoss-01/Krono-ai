/**
 * public/js/meeting/meeting-bgblur.js
 * Floutage d'arrière-plan, activable/désactivable à tout moment via le
 * bouton dédié (btn-bgblur). 100% côté client — ne touche jamais au serveur
 * mediasoup : on flou la piste vidéo AVANT qu'elle parte, via canvas +
 * remplacement de piste sur le producer déjà ouvert (replaceTrack).
 *
 * ── Correctif important ──────────────────────────────────────────────────
 * Ce module ne communiquait avec RIEN d'autre : couper/rallumer la caméra
 * ou démarrer/arrêter un partage d'écran republiait la piste caméra BRUTE
 * directement (meetingSfuEnsureProducer), sans jamais consulter l'état du
 * floutage. Résultat : le floutage "disparaissait" silencieusement dès que
 * la caméra ou l'écran partagé changeait, et la piste brute restée orpheline
 * dans MeetState.localStream causait des incohérences (caméra qui semble se
 * couper, floutage qui ne revient jamais).
 *
 * Corrigé en introduisant un point d'entrée UNIQUE, publishCameraTrack(),
 * que toutes les autres fonctions (toggleCam, stopScreenShare) doivent
 * désormais appeler au lieu de publier une piste caméra directement — lui
 * seul décide s'il faut republier la piste brute ou relancer le floutage
 * dessus, selon _bgBlurWanted (qui persiste même quand la caméra est coupée
 * ou qu'un écran est partagé, contrairement à _bgBlurActive qui ne reflète
 * que l'état "en ce moment précis").
 */
let _bgBlurActive  = false; // le pipeline de floutage tourne réellement MAINTENANT
let _bgBlurWanted  = false; // l'utilisateur VEUT le floutage — persiste à travers cam off/on et partage d'écran
let _bgBlurLoading = false;
let _bgSegmenter   = null;
let _bgCamera      = null;
let _bgHiddenVideo = null;
let _bgCanvas      = null;
let _bgCanvasCtx   = null;
let _bgRawTrack    = null; // piste caméra brute, gardée pour pouvoir désactiver proprement
let _bgOutputTrack = null; // piste issue du canvas (floutée), celle réellement envoyée

function _bgLoadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Échec de chargement : ' + src));
    document.head.appendChild(s);
  });
}

async function _bgEnsureMediaPipeLoaded() {
  if (window.SelfieSegmentation && window.Camera) return;
  await _bgLoadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
  await _bgLoadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
}

function _bgOnSegmentationResults(results) {
  if (!_bgCanvasCtx || !_bgCanvas) return;
  const ctx = _bgCanvasCtx;
  const w = _bgCanvas.width, h = _bgCanvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // 1. La personne, nette, découpée par le masque de segmentation
  ctx.drawImage(results.segmentationMask, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(results.image, 0, 0, w, h);
  // 2. L'arrière-plan flouté, posé derrière
  ctx.globalCompositeOperation = 'destination-over';
  ctx.filter = 'blur(12px)';
  ctx.drawImage(results.image, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.restore();
}

function _bgFindLocalVideoEl() {
  return (typeof meetingGetLocalVideoEl === 'function' ? meetingGetLocalVideoEl() : null)
      || document.querySelector('#tile-local video');
}

// Applique le même style que le reste de l'app pour la tuile locale
// (miroir + object-fit par défaut).
function _bgApplyLocalPreview(stream) {
  if (typeof meetingSetLocalVideoPreview === 'function') {
    meetingSetLocalVideoPreview(stream, { mirrored: true, screen: false });
    return;
  }
  const localVid = _bgFindLocalVideoEl();
  if (!localVid) return;
  localVid.srcObject = stream;
  localVid.style.transform = 'scaleX(-1)';
  localVid.style.objectFit = '';
  localVid.style.background = '';
}

/**
 * Point d'entrée UNIQUE pour publier une piste caméra fraîchement disponible
 * (caméra réactivée, écran partagé terminé...). À appeler à la place de
 * meetingSfuEnsureProducer('camera', track) directement, partout dans l'app.
 */
async function publishCameraTrack(rawTrack) {
  if (!rawTrack) return;

  if (_bgBlurWanted) {
    await enableBackgroundBlur(rawTrack);
    return;
  }

  if (typeof meetingAddTrackToLocalStream === 'function') meetingAddTrackToLocalStream(rawTrack);
  if (typeof meetingSfuEnsureProducer === 'function') {
    try { await meetingSfuEnsureProducer('camera', rawTrack); }
    catch (e) { console.error('[BgBlur] publishCameraTrack: échec publication piste brute', e); }
  }
  _bgApplyLocalPreview(MeetState.localStream || new MediaStream([rawTrack]));
}

/**
 * Retourne la piste caméra "logique" actuellement utilisée pour la publication,
 * qu'elle soit brute ou floutée — à utiliser par le reste de l'app (ex: avant
 * de démarrer un partage d'écran) au lieu de fouiller MeetState.localStream
 * soi-même, pour ne jamais récupérer par erreur une piste de canvas déjà
 * arrêtée à la place de la vraie source caméra.
 */
function getHandoffCameraTrack() {
  if (_bgBlurActive && _bgRawTrack && _bgRawTrack.readyState === 'live') return _bgRawTrack;
  return typeof meetingGetCameraTrack === 'function' ? meetingGetCameraTrack() : null;
}

/**
 * Met en pause le pipeline de segmentation SANS désactiver l'intention de
 * floutage (_bgBlurWanted reste intact) — utilisé quand la caméra est coupée
 * ou qu'un partage d'écran démarre : la source vidéo va disparaître, inutile
 * de laisser MediaPipe tourner pour rien pendant ce temps.
 */
function pauseBlurPipeline() {
  if (_bgCamera)     { try { _bgCamera.stop(); } catch (_) {} _bgCamera = null; }
  if (_bgSegmenter)  { try { _bgSegmenter.close(); } catch (_) {} _bgSegmenter = null; }
  if (_bgHiddenVideo){ try { _bgHiddenVideo.srcObject = null; _bgHiddenVideo.remove(); } catch (_) {} _bgHiddenVideo = null; }
  if (_bgOutputTrack) {
    // Retirer AVANT d'arrêter : sinon la piste morte reste coincée dans
    // MeetState.localStream à côté de la piste caméra fraîche, et le
    // <video> peut continuer d'afficher cette piste figée/noire au lieu de
    // la vraie caméra — exactement le bug "il faut activer/désactiver deux
    // fois avant que ça marche".
    if (typeof meetingRemoveTrackFromLocalStream === 'function') {
      meetingRemoveTrackFromLocalStream(_bgOutputTrack);
    }
    try { _bgOutputTrack.stop(); } catch (_) {}
    _bgOutputTrack = null;
  }
  _bgCanvas = null;
  _bgCanvasCtx = null;
  _bgBlurActive = false;
  _bgUpdateButton();
}

async function enableBackgroundBlur(explicitRawTrack) {
  if (_bgBlurLoading) return;
  if (_bgBlurActive && !explicitRawTrack) return;

  const rawTrack = explicitRawTrack
    || MeetState.localStream?.getVideoTracks().find(t => t.readyState === 'live' && (!MeetState.screenTrack || t.id !== MeetState.screenTrack.id));

  if (!rawTrack) { notify?.("Active ta caméra avant d'activer le floutage"); return; }

  // Si un pipeline tourne déjà (ex: relance après changement de caméra), on
  // le nettoie proprement avant d'en recréer un plutôt que d'empiler deux
  // boucles MediaPipe en parallèle.
  if (_bgBlurActive) pauseBlurPipeline();

  _bgBlurLoading = true;
  _bgBlurWanted  = true;
  notify?.('Chargement du floutage…');

  try {
    await _bgEnsureMediaPipeLoaded();

    _bgRawTrack = rawTrack;

    // Retirer la piste brute de MeetState.localStream : c'est la piste issue
    // du canvas qui doit y être, pour que le reste de l'app (meetingGetCameraTrack,
    // etc.) reste cohérent avec ce qui est réellement affiché/envoyé.
    if (typeof meetingRemoveTrackFromLocalStream === 'function') {
      meetingRemoveTrackFromLocalStream(rawTrack);
    }

    // Vidéo cachée MAIS attachée au DOM (hors écran) : une <video> jamais
    // insérée dans le document ne décode pas ses frames de façon fiable
    // dans tous les navigateurs.
    _bgHiddenVideo = document.createElement('video');
    _bgHiddenVideo.muted = true;
    _bgHiddenVideo.playsInline = true;
    _bgHiddenVideo.setAttribute('aria-hidden', 'true');
    _bgHiddenVideo.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;';
    document.body.appendChild(_bgHiddenVideo);
    _bgHiddenVideo.srcObject = new MediaStream([rawTrack]);
    await _bgHiddenVideo.play();

    // Dimensions RÉELLES de la vidéo une fois chargée.
    if (!_bgHiddenVideo.videoWidth) {
      await new Promise(resolve => {
        _bgHiddenVideo.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 1500); // filet de sécurité si l'événement tarde
      });
    }
    const width  = _bgHiddenVideo.videoWidth  || rawTrack.getSettings().width  || 640;
    const height = _bgHiddenVideo.videoHeight || rawTrack.getSettings().height || 480;

    _bgCanvas = document.createElement('canvas');
    _bgCanvas.width = width;
    _bgCanvas.height = height;
    _bgCanvasCtx = _bgCanvas.getContext('2d');

    _bgSegmenter = new window.SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    _bgSegmenter.setOptions({ modelSelection: 1 });
    _bgSegmenter.onResults(_bgOnSegmentationResults);

    _bgCamera = new window.Camera(_bgHiddenVideo, {
      onFrame: async () => { if (_bgSegmenter) await _bgSegmenter.send({ image: _bgHiddenVideo }); },
      width, height,
    });
    _bgCamera.start();

    // Laisser quelques frames arriver avant de basculer le flux réellement envoyé.
    await new Promise(r => setTimeout(r, 500));

    _bgOutputTrack = _bgCanvas.captureStream(25).getVideoTracks()[0];

    if (typeof meetingAddTrackToLocalStream === 'function') meetingAddTrackToLocalStream(_bgOutputTrack);

    if (typeof meetingSfuEnsureProducer === 'function') {
      await meetingSfuEnsureProducer('camera', _bgOutputTrack);
    } else {
      const camProducer = MeetState.sfuProducers?.['camera'];
      if (camProducer) await camProducer.replaceTrack({ track: _bgOutputTrack });
    }

    _bgApplyLocalPreview(new MediaStream([_bgOutputTrack]));

    _bgBlurActive = true;
    _bgUpdateButton();
    notify?.('Floutage activé');
  } catch (err) {
    console.error('[BgBlur] Échec activation :', err);
    notify?.("Impossible d'activer le floutage : " + err.message);
    _bgBlurWanted = false;
    pauseBlurPipeline();
  } finally {
    _bgBlurLoading = false;
  }
}

/**
 * Désactivation VOULUE par la personne (clic sur le bouton) — contrairement
 * à pauseBlurPipeline(), ça efface aussi l'intention (_bgBlurWanted = false),
 * donc le floutage ne reviendra plus tout seul après un cam off/on.
 */
async function disableBackgroundBlur() {
  _bgBlurWanted = false;
  pauseBlurPipeline();

  // La piste brute peut s'être terminée entre-temps — on ne suppose jamais
  // qu'elle est toujours valide, on en réacquiert une fraîche si besoin.
  let cameraTrack = _bgRawTrack;
  if (!cameraTrack || cameraTrack.readyState !== 'live') {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraTrack = camStream.getVideoTracks()[0] || null;
    } catch (e) {
      console.error('[BgBlur] Impossible de réacquérir la caméra :', e);
      cameraTrack = null;
    }
  }

  if (cameraTrack) {
    if (typeof meetingAddTrackToLocalStream === 'function') meetingAddTrackToLocalStream(cameraTrack);

    if (typeof meetingSfuEnsureProducer === 'function') {
      try { await meetingSfuEnsureProducer('camera', cameraTrack); }
      catch (e) { console.error('[BgBlur] Restauration caméra impossible :', e); }
    }

    _bgApplyLocalPreview(MeetState.localStream || new MediaStream([cameraTrack]));
  }

  _bgRawTrack = null;
  notify?.('Floutage désactivé');
}

function toggleBackgroundBlur() {
  if (_bgBlurLoading) return;
  if (_bgBlurActive || _bgBlurWanted) disableBackgroundBlur();
  else enableBackgroundBlur();
}

function _bgUpdateButton() {
  const btn = document.getElementById('btn-bgblur');
  if (!btn) return;
  btn.classList.toggle('bg-on', _bgBlurActive);
  btn.title = _bgBlurActive ? "Désactiver le floutage" : "Flouter l'arrière-plan";
}

// Si la caméra est coupée/relancée ou changée pendant que le floutage est actif,
// on le réapplique proprement sur la nouvelle piste.
function reapplyBackgroundBlurIfActive() {
  if (!_bgBlurWanted) return;
  const freshTrack = typeof meetingGetCameraTrack === 'function' ? meetingGetCameraTrack() : null;
  if (freshTrack) enableBackgroundBlur(freshTrack);
}
