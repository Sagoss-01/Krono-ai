/**
 * notifications.js — Web Notifications API + raccourcis clavier
 */
const Notifs = (() => {
  let permitted = false;

  async function request() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { permitted = true; return; }
    if (Notification.permission !== 'denied') {
      const p = await Notification.requestPermission();
      permitted = p === 'granted';
    }
  }

  function send(title, body, icon, onClick) {
    if (!permitted || document.visibilityState === 'visible') return;
    try {
      const n = new Notification(title, {
        body, icon: icon || '/favicon.ico',
        badge: '/favicon.ico', silent: false,
      });
      if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
      setTimeout(() => n.close(), 6000);
    } catch(_) {}
  }

  return { request, send };
})();

/* ══ Raccourcis clavier globaux ══════════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
  // Ignorer si on est dans un input/textarea/select
  const tag = document.activeElement?.tagName;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;

  const isChatMode = document.getElementById('mode-chat')?.style.display !== 'none';
  const isMailMode = !isChatMode;

  if (isMailMode) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); Mail.navigateEmail?.(-1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); Mail.navigateEmail?.(1);  return; }

    switch(e.key) {
      case 'r': case 'R':
        Mail.reply?.();
        break;
      case 'a': case 'A':
        Mail.replyAll?.();
        break;
      case 'f': case 'F':
        Mail.forward?.();
        break;
      case 'd': case 'D':
        // Utiliser ConfirmModal au lieu de confirm() natif
        e.preventDefault();
        Mail.deleteEmail?.();
        break;
      case 'u': case 'U':
        Mail.toggleRead?.();
        break;
      case 's': case 'S':
        Mail.toggleStar?.();
        break;
      case 'Escape':
        Mail.closeMobile?.();
        break;
      case '/':
        e.preventDefault();
        document.getElementById('search-inp')?.focus();
        break;
    }
  }

  // Aide
  if (e.key === '?') {
    window.open('/help', '_blank');
  }

  // Escape global
  if (e.key === 'Escape') {
    // Fermer confirm modal en priorité
    var cm = document.getElementById('confirm-modal');
    if (cm && cm.style.display === 'flex') { ConfirmModal.cancel(); return; }
    // Fermer autres modales
    ['modal-settings','modal-add-account','help-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    App.closeModal?.('modal-settings');
    App.closeModal?.('modal-add-account');
  }
});
