/**
 * confirm-modal.js — Modale de confirmation globale
 * Styles 100% inline dans le HTML — aucune dépendance CSS externe
 */
const ConfirmModal = (() => {
  let _resolve = null;

  function show({ title, body, danger, icon } = {}) {
    const modal   = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const bodyEl  = document.getElementById('confirm-body');
    const iconEl  = document.getElementById('confirm-icon');
    const okBtn   = document.getElementById('confirm-ok-btn');
    if (!modal) { console.error('confirm-modal introuvable'); return Promise.resolve(false); }

    if (titleEl) titleEl.textContent = title || 'Confirmer';
    if (bodyEl)  bodyEl.textContent  = body  || '';
    if (iconEl)  iconEl.innerHTML    = icon  || '';
    if (okBtn) {
      okBtn.style.background = danger ? '#ef4444' : '#035c80';
    }

    // Afficher l'overlay avec styles inline complets
    modal.style.cssText = [
      'display:flex',
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,0.65)',
      'z-index:99999',
      'align-items:center',
      'justify-content:center',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
    ].join(';');

    document.body.style.overflow = 'hidden';
    return new Promise(res => { _resolve = res; });
  }

  function _close() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.style.cssText = 'display:none';
    document.body.style.overflow = '';
  }

  function ok()     { _close(); if (_resolve) { _resolve(true);  _resolve = null; } }
  function cancel() { _close(); if (_resolve) { _resolve(false); _resolve = null; } }

  return { show, ok, cancel };
})();
