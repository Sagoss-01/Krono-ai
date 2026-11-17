const QuickConnectUI = (() => {
  let currentToken = null, pollTimer = null, countdownTimer = null;

  // ── Mode A : cet appareil (déjà connecté) génère le QR ──────────────────

  async function generate() {
    stop();
    const qr = document.getElementById('qc-modal-qr');
    const statusEl = document.getElementById('qc-modal-status');
    if (statusEl) statusEl.style.display = 'none';
    if (qr) qr.innerHTML = '<span style="color:#333;font-size:12px;">Génération…</span>';

    const res = await App.apiPost('/api/quick-connect/generate', {});
    if (!res.ok) {
      if (qr) qr.innerHTML = '<span style="color:#c00;font-size:11px;padding:10px;">Erreur</span>';
      return;
    }

    currentToken = res.token;
    if (qr) qr.innerHTML = `<img src="${res.qrDataUrl}" alt="QR code" style="width:100%;height:100%;">`;
    const linkInput = document.getElementById('qc-modal-link');
    if (linkInput) linkInput.value = res.url;

    startCountdown(new Date(res.expiresAt));
    pollTimer = setInterval(checkStatus, 2000);
  }

  function startCountdown(expiresAt) {
    const el = document.getElementById('qc-modal-timer');
    countdownTimer = setInterval(() => {
      if (!el) return;
      const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      el.textContent = s > 0 ? `Expire dans ${s}s` : 'Expiré — régénération…';
      if (s <= 0) { clearInterval(countdownTimer); generate(); }
    }, 500);
  }

  async function checkStatus() {
    if (!currentToken) return;
    const res = await App.apiGet('/api/quick-connect/status/' + currentToken);
    if (res.status === 'used') {
      stop();
      const statusEl = document.getElementById('qc-modal-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(34,197,94,.12)';
        statusEl.style.color = '#86efac';
        statusEl.textContent = 'Un appareil vient de se connecter avec ce code !';
      }
    }
  }

  function copyLink() {
    const input = document.getElementById('qc-modal-link');
    if (!input) return;
    input.select();
    navigator.clipboard?.writeText(input.value);
  }

  function stop() {
    clearInterval(pollTimer); pollTimer = null;
    clearInterval(countdownTimer); countdownTimer = null;
  }

  // ── Mode B (réponse) : un autre appareil a scanné le lien, on approuve ──

  let approveToken = null;

  async function openApproveModal(token) {
    approveToken = token;
    App.openModal('modal-quick-approve');
    const info = document.getElementById('qc-approve-info');
    const msg = document.getElementById('qc-approve-msg');
    if (msg) msg.style.display = 'none';
    if (info) info.textContent = 'Chargement…';

    const res = await App.apiGet('/api/quick-connect/token-info/' + token);
    if (!res.ok || !res.valid) {
      if (info) info.textContent = 'Ce lien est invalide, a expiré, ou a déjà été utilisé.';
      return;
    }
    if (info) {
      info.innerHTML = `<div><strong style="color:#fef3c7;">Appareil :</strong> ${escHtml(res.requesterUa || 'Inconnu')}</div>
        <div><strong style="color:#fef3c7;">Adresse IP :</strong> ${escHtml(res.requesterIp || 'Inconnue')}</div>`;
    }
  }

  async function decideApprove(decision) {
    const msg = document.getElementById('qc-approve-msg');
    const res = await App.apiPost('/api/quick-connect/decide', { token: approveToken, decision });

    if (msg) {
      msg.style.display = 'block';
      msg.style.background = res.ok ? 'rgba(34,197,94,.12)' : 'rgba(248,113,113,.1)';
      msg.style.color = res.ok ? '#86efac' : '#fca5a5';
      msg.textContent = res.ok
        ? (decision === 'approve' ? "Appareil autorisé — il va se connecter automatiquement." : 'Demande refusée.')
        : (res.error || 'Erreur');
    }
  }

  function escHtml(v = '') {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { generate, copyLink, stop, openApproveModal, decideApprove };
})();

// Auto-ouverture de la modale d'approbation si on arrive avec ?quickApprove=TOKEN
// (lien ouvert depuis un appareil déjà connecté après avoir scanné le QR
// affiché sur l'appareil qui demande à se connecter).
(function handleQuickApproveParam() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('quickApprove');
  if (!token) return;

  params.delete('quickApprove');
  const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', clean);

  window.addEventListener('DOMContentLoaded', () => {
    QuickConnectUI.openApproveModal(token);
  });
})();
