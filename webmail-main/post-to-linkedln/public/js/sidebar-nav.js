/**
 * public/js/sidebar-nav.js
 */
const SidebarNav = (() => {
  function showMail() {
    document.getElementById('tab-mail').classList.add('active');
    document.getElementById('tab-chat').classList.remove('active');
    document.getElementById('sb-panel-mail').style.display = 'flex';
    document.getElementById('sb-panel-chat').style.display = 'none';
  }

  function showChat() {
    document.getElementById('tab-chat').classList.add('active');
    document.getElementById('tab-mail').classList.remove('active');
    document.getElementById('sb-panel-mail').style.display = 'none';
    document.getElementById('sb-panel-chat').style.display = 'flex';
    // Cacher notif dot
    const dot = document.getElementById('chat-notif-dot');
    if (dot) dot.style.display = 'none';
    // Assurer qu'on est sur la vue contacts (pas chat)
    const chatView     = document.getElementById('sb-chat-view');
    const contactsView = document.getElementById('sb-contacts-view');
    if (chatView && chatView.style.display !== 'none') {
      // garder la vue chat si déjà ouverte
    } else {
      if (chatView)     chatView.style.display     = 'none';
      if (contactsView) contactsView.style.display = 'flex';
    }
    Chat.loadContacts();
  }

  function backToContacts() {
    Chat.backToContacts();
  }

  return { showMail, showChat, backToContacts };
})();
