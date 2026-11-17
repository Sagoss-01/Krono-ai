/**
 * public/js/settings.js
 * Gestion des onglets paramètres + signature (header/footer)
 */

const Settings = (() => {
  let currentTab = 'general';

  function showTab(tab) {
    // Désactiver tous les onglets
    ['general','signature','security','accounts','privacy','server'].forEach(t => {
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
    if (tab === 'security')  { loadRecoveryStatus(); load2FAStatus(); }
    if (tab === 'accounts')  App.renderSettingsAccounts?.();
  }

  // ── Email de secours ──────────────────────────────────────────────────────
  async function loadRecoveryStatus() {
    const block = document.getElementById('recovery-status-block');
    block.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Chargement…</div>';

    const res = await App.apiGet('/api/account/recovery-email');
    if (!res.ok) {
      block.innerHTML = '<div style="font-size:12px;color:#f87171;">Erreur de chargement</div>';
      return;
    }

    document.getElementById('recovery-confirm-form').style.display = 'none';

    if (!res.recoveryEmail) {
      block.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Aucun email de secours configuré.</div>';
      document.getElementById('recovery-email-inp').value = '';
    } else if (res.verified) {
      block.innerHTML = `<div style="font-size:12px;color:#22c55e;">✓ Confirmé — ${res.recoveryEmail}</div>`;
      document.getElementById('recovery-email-inp').value = res.recoveryEmail;
    } else {
      block.innerHTML = `<div style="font-size:12px;color:#f59e0b;">⏳ En attente de confirmation — ${res.recoveryEmail}</div>`;
      document.getElementById('recovery-email-inp').value = res.recoveryEmail;
      document.getElementById('recovery-confirm-form').style.display = 'block';
    }
  }

  async function linkRecoveryEmail() {
    const recoveryEmail = document.getElementById('recovery-email-inp').value.trim();
    const statusEl = document.getElementById('recovery-link-status');
    if (!recoveryEmail) { statusEl.textContent = 'Entrez une adresse email'; statusEl.style.color = '#f87171'; return; }

    statusEl.textContent = 'Envoi du code…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/account/recovery-email/link', { recoveryEmail });
    if (res.ok) {
      statusEl.textContent = '✓ ' + (res.message || 'Code envoyé');
      statusEl.style.color = '#22c55e';
      document.getElementById('recovery-confirm-form').style.display = 'block';
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Erreur');
      statusEl.style.color = '#f87171';
    }
  }

  async function confirmRecoveryEmail() {
    const code = document.getElementById('recovery-code-inp').value.trim();
    const statusEl = document.getElementById('recovery-confirm-status');
    if (!code) { statusEl.textContent = 'Entrez le code reçu'; statusEl.style.color = '#f87171'; return; }

    statusEl.textContent = 'Vérification…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/account/recovery-email/confirm', { code });
    if (res.ok) {
      App.toast('Email de secours confirmé', 'success');
      loadRecoveryStatus();
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Code invalide');
      statusEl.style.color = '#f87171';
    }
  }

  // ── 2FA ───────────────────────────────────────────────────────────────────
  function hideAll2FABlocks() {
    ['twofa-start-block','twofa-setup-block','twofa-enabled-block'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
  }

  async function load2FAStatus() {
    const statusEl = document.getElementById('twofa-status-block');
    statusEl.textContent = 'Chargement…';
    hideAll2FABlocks();

    const res = await App.apiGet('/api/account/2fa/status');
    if (!res.ok) { statusEl.textContent = 'Erreur de chargement'; return; }

    if (res.enabled) {
      statusEl.textContent = '';
      document.getElementById('twofa-enabled-block').style.display = 'block';
    } else {
      statusEl.textContent = 'Non activée — protège ton compte avec une application comme Google Authenticator ou Authy.';
      document.getElementById('twofa-start-block').style.display = 'block';
    }
  }

  async function start2FASetup() {
    hideAll2FABlocks();
    document.getElementById('twofa-status-block').textContent = 'Génération du QR code…';

    const res = await App.apiPost('/api/account/2fa/setup', {});
    if (!res.ok) {
      document.getElementById('twofa-status-block').textContent = '❌ ' + (res.error || 'Erreur');
      document.getElementById('twofa-start-block').style.display = 'block';
      return;
    }

    document.getElementById('twofa-status-block').textContent = '';
    document.getElementById('twofa-qr-img').src = res.qrDataUrl;
    document.getElementById('twofa-manual-key').textContent = res.secret;
    document.getElementById('twofa-backup-codes-list').innerHTML =
      res.backupCodes.map(c => `<div>${c}</div>`).join('');
    document.getElementById('twofa-confirm-code').value = '';
    document.getElementById('twofa-setup-status').textContent = '';
    document.getElementById('twofa-setup-block').style.display = 'block';
  }

  function cancel2FASetup() {
    load2FAStatus();
  }

  async function confirm2FASetup() {
    const token = document.getElementById('twofa-confirm-code').value.trim();
    const statusEl = document.getElementById('twofa-setup-status');
    if (!token) { statusEl.textContent = 'Entre le code affiché par ton application'; statusEl.style.color = '#f87171'; return; }

    statusEl.textContent = 'Vérification…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/account/2fa/enable', { token });
    if (res.ok) {
      App.toast('2FA activée — garde tes codes de secours en lieu sûr', 'success');
      load2FAStatus();
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Code invalide');
      statusEl.style.color = '#f87171';
    }
  }

  async function disable2FA() {
    const password = document.getElementById('twofa-disable-pwd').value;
    const statusEl = document.getElementById('twofa-disable-status');
    if (!password) { statusEl.textContent = 'Mot de passe requis'; statusEl.style.color = '#f87171'; return; }

    statusEl.textContent = 'Désactivation…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/account/2fa/disable', { password });
    if (res.ok) {
      document.getElementById('twofa-disable-pwd').value = '';
      App.toast('2FA désactivée', 'warning');
      load2FAStatus();
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Erreur');
      statusEl.style.color = '#f87171';
    }
  }

  async function changePassword() {
    const currentPassword = document.getElementById('pwd-current-inp').value;
    const newPassword     = document.getElementById('pwd-new-inp').value;
    const confirmPassword = document.getElementById('pwd-new2-inp').value;
    const statusEl = document.getElementById('pwd-change-status');

    if (!currentPassword) { statusEl.textContent = 'Entrez votre mot de passe actuel'; statusEl.style.color = '#f87171'; return; }
    if (!newPassword || newPassword.length < 8) { statusEl.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères'; statusEl.style.color = '#f87171'; return; }
    if (newPassword !== confirmPassword) { statusEl.textContent = 'Les mots de passe ne correspondent pas'; statusEl.style.color = '#f87171'; return; }

    statusEl.textContent = 'Modification en cours…';
    statusEl.style.color = 'var(--text-muted)';

    const res = await App.apiPost('/api/account/change-password', { currentPassword, newPassword, confirmPassword });
    if (res.ok) {
      statusEl.textContent = '✓ Mot de passe modifié';
      statusEl.style.color = '#22c55e';
      document.getElementById('pwd-current-inp').value = '';
      document.getElementById('pwd-new-inp').value = '';
      document.getElementById('pwd-new2-inp').value = '';
      App.toast('Mot de passe modifié avec succès', 'success');
    } else {
      statusEl.textContent = '❌ ' + (res.error || 'Erreur');
      statusEl.style.color = '#f87171';
    }
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

  // ── RGPD : export et suppression de compte ──────────────────────────────

  function exportMyData() {
    // Simple navigation vers l'URL : le navigateur gère le téléchargement
    // via l'en-tête Content-Disposition renvoyé par le serveur.
    window.location.href = '/api/account/export';
  }

  function openDeleteAccountConfirm() {
    const block = document.getElementById('delete-account-confirm');
    block.style.display = block.style.display === 'none' ? 'block' : 'none';
  }

  async function confirmDeleteAccount() {
    const word = document.getElementById('delete-account-word').value.trim();
    const password = document.getElementById('delete-account-password').value;
    const msg = document.getElementById('delete-account-msg');
    const btn = document.getElementById('delete-account-btn');

    msg.style.display = 'none';

    if (word !== 'SUPPRIMER') {
      msg.style.display = 'block'; msg.style.color = '#f87171';
      msg.textContent = 'Tape exactement SUPPRIMER (en majuscules) pour confirmer.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Suppression en cours…';

    try {
      const res = await App.apiPost('/api/account/delete', { confirmation: word, password });
      if (res.ok) {
        alert('Ton compte a été supprimé. Tu vas être redirigé vers la page de connexion.');
        window.location.href = '/login';
      } else {
        msg.style.display = 'block'; msg.style.color = '#f87171';
        msg.textContent = res.error || 'Erreur lors de la suppression.';
        btn.disabled = false;
        btn.textContent = 'Supprimer définitivement';
      }
    } catch (err) {
      msg.style.display = 'block'; msg.style.color = '#f87171';
      msg.textContent = 'Erreur réseau — réessaie.';
      btn.disabled = false;
      btn.textContent = 'Supprimer définitivement';
    }
  }

  return {
    showTab, loadSignature, saveSignature, togglePreview,
    loadRecoveryStatus, linkRecoveryEmail, confirmRecoveryEmail, changePassword,
    load2FAStatus, start2FASetup, cancel2FASetup, confirm2FASetup, disable2FA,
    exportMyData, openDeleteAccountConfirm, confirmDeleteAccount,
  };
})();
