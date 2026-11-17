/**
 * meeting-captions.js
 *
 * Sous-titres en direct, activables/désactivables à la volée.
 *
 * Fonctionnement : l'API SpeechRecognition du navigateur (Web Speech API)
 * ne peut transcrire QUE le micro local de la personne qui l'active — il
 * est techniquement impossible de transcrire le flux audio d'un autre
 * participant via cette API. Donc : chaque personne qui active ses
 * sous-titres fait transcrire SA PROPRE voix, qui est ensuite diffusée en
 * texte à tout le monde dans la réunion. Si personne n'active la fonction,
 * personne ne voit de sous-titres.
 *
 * Limite assumée (gratuite mais Chrome/Edge uniquement) : Firefox et Safari
 * ne supportent pas SpeechRecognition — le bouton le signale proprement au
 * lieu d'échouer silencieusement. Passer par un vrai service de
 * transcription (payant) lèverait cette limite si besoin un jour.
 */
let _captionsRecognition = null;
let _captionsEnabled = false;
let _captionsHideTimer = null;

function _captionsSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function toggleCaptions() {
  if (!_captionsSupported()) {
    notify?.("Les sous-titres ne sont pris en charge que sur Chrome/Edge pour l'instant.");
    return;
  }
  _captionsEnabled ? stopCaptions() : startCaptions();
}

function startCaptions() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  _captionsRecognition = new Recognition();
  _captionsRecognition.lang = 'fr-FR';
  _captionsRecognition.continuous = true;
  _captionsRecognition.interimResults = true;

  _captionsRecognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = result[0]?.transcript?.trim();
    if (!text) return;

    MeetState.socket?.emit('caption_text', {
      meetingId: MeetState.MEETING_ID,
      text,
      isFinal: result.isFinal,
    });

    // On s'affiche aussi à soi-même immédiatement (pas besoin d'attendre l'aller-retour serveur)
    showCaption('Vous', text);
  };

  _captionsRecognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      notify?.("Micro refusé pour les sous-titres — vérifie les autorisations du navigateur.");
      stopCaptions();
    }
    // Les autres erreurs (ex: 'no-speech') sont bénignes ; onend relance automatiquement.
  };

  _captionsRecognition.onend = () => {
    // Chrome coupe la reconnaissance après un silence — on relance tant que
    // la fonction est toujours activée, pour un sous-titrage réellement continu.
    if (_captionsEnabled) {
      try { _captionsRecognition.start(); } catch (_) {}
    }
  };

  try {
    _captionsRecognition.start();
    _captionsEnabled = true;
    document.getElementById('btn-captions')?.classList.add('active');
    document.getElementById('captions-bar').style.display = 'block';
    notify?.('Sous-titres activés — ta voix sera transcrite pour tout le monde.');
  } catch (err) {
    notify?.('Impossible de démarrer les sous-titres : ' + err.message);
  }
}

function stopCaptions() {
  _captionsEnabled = false;
  try { _captionsRecognition?.stop(); } catch (_) {}
  _captionsRecognition = null;
  document.getElementById('btn-captions')?.classList.remove('active');
  const bar = document.getElementById('captions-bar');
  if (bar) bar.style.display = 'none';
  clearTimeout(_captionsHideTimer);
}

// Réception des sous-titres des AUTRES participants (et affichage local en écho)
function bindCaptionsSocket(socket) {
  socket.on('caption_text', ({ name, text }) => {
    showCaption(name || 'Un participant', text);
  });
}

function showCaption(speakerName, text) {
  const bar = document.getElementById('captions-bar');
  if (!bar) return;
  bar.style.display = 'block';
  bar.innerHTML = `<strong style="color:#7dd3fc;">${escHtml(speakerName)} :</strong> ${escHtml(text)}`;

  clearTimeout(_captionsHideTimer);
  _captionsHideTimer = setTimeout(() => {
    if (!_captionsEnabled) bar.style.display = 'none';
    else bar.innerHTML = '';
  }, 4000);
  window.MeetAIExtras?.onCaption(speakerName, text);
}
