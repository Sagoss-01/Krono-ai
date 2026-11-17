/**
 * public/js/settings.js
 * Gestion des onglets paramètres + signature (header/footer)
 */

const Settings = (() => {
  let currentTab = 'general';

  function showTab(tab) {
    // Désactiver tous les onglets
    ['general','signature','accounts','server'].forEach(t => {
      document.getElementById(`stab-${t}`)?.classList.remove('active');
      const panel = document.getElementById(`stab-panel-${t}`);
      if (panel) panel.style.display = 'none';
    });
    // Activer l'onglet sélectionné
    document.getElementById(`stab-${tab}`)?.classList.add('active');
    const panel = document.getElementById(`stab-panel-${tab}`);
    if (panel) panel.style.display = 'block';
    currentTab = tab;

    if (tab === 'signature') loadSignature();
    if (tab === 'accounts')  App.renderSettingsAccounts?.();
  }

  async function loadSignature() {
    const res = await App.apiGet('/api/signature');
    if (res.ok) {
      document.getElementById('sig-header').value = res.header_html || '';
      document.getElementById('sig-footer').value = res.footer_html || '';
    }
  }

  async function saveSignature() {
    const header_html = document.getElementById('sig-header').value;
    const footer_html = document.getElementById('sig-footer').value;
    const statusEl    = document.getElementById('sig-status');
    statusEl.textContent = 'Enregistrement…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/signature', { header_html, footer_html });
    if (res.ok) {
      statusEl.textContent = 'Signature enregistree';
      statusEl.style.color = '#22c55e';
      App.toast('Signature sauvegardée', 'success');
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Erreur');
      statusEl.style.color = '#f87171';
    }
  }

  function togglePreview() {
    const preview  = document.getElementById('sig-preview');
    const isHidden = preview.style.display === 'none';
    if (isHidden) {
      const header = document.getElementById('sig-header').value;
      const footer = document.getElementById('sig-footer').value;
      preview.innerHTML = (header ? `<div style="border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:8px;">${header}</div>` : '') +
        `<div style="color:var(--text-3);font-size:12px;font-style:italic;">[Corps de votre email]</div>` +
        (footer ? `<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">${footer}</div>` : '');
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  return { showTab, loadSignature, saveSignature, togglePreview };
})();
