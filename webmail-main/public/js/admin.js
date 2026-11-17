const Admin = (() => {
  async function apiGet(url) {
    const r = await fetch(url);
    return r.json();
  }

  function escHtml(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function loadStats() {
    const res = await apiGet('/api/admin/overview');
    const el = document.getElementById('adm-stats');
    if (!res.ok) { el.innerHTML = '<div class="adm-empty">Erreur de chargement</div>'; return; }
    const s = res.stats;
    const cards = [
      { v: s.uniqueUsers, l: 'Comptes connus' },
      { v: s.liveMeetings, l: 'Réunions en direct' },
      { v: s.scheduledMeetings, l: 'Réunions programmées' },
      { v: s.activity24h, l: 'Événements (24h)' },
      { v: s.failedLogins24h, l: 'Échecs de connexion (24h)' },
    ];
    el.innerHTML = cards.map(c => `
      <div class="adm-stat-card">
        <div class="adm-stat-value">${c.v}</div>
        <div class="adm-stat-label">${c.l}</div>
      </div>`).join('');
  }

  function showTab(tab) {
    ['activity', 'accounts', 'meetings'].forEach(t => {
      document.getElementById('adm-tab-' + t).classList.toggle('active', t === tab);
      document.getElementById('adm-panel-' + t).style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'activity') loadActivity();
    if (tab === 'accounts') loadAccounts();
    if (tab === 'meetings') loadMeetings();
  }

  const EVENT_LABELS = {
    login_success: 'Connexion réussie',
    login_failed: 'Échec de connexion',
    login_pending_2fa: 'Connexion — code 2FA en attente',
    password_reset: 'Mot de passe réinitialisé',
    '2fa_enabled': '2FA activée',
    '2fa_disabled': '2FA désactivée',
  };

  async function loadActivity() {
    const el = document.getElementById('adm-panel-activity');
    el.innerHTML = '<div class="adm-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/activity?limit=150');
    if (!res.ok || !res.activity.length) { el.innerHTML = '<div class="adm-empty">Aucune activité enregistrée</div>'; return; }

    el.innerHTML = `<table class="adm-table">
      <thead><tr><th>Compte</th><th>Événement</th><th>IP</th><th>Détail</th><th>Date</th></tr></thead>
      <tbody>
        ${res.activity.map(a => `
          <tr>
            <td>${escHtml(a.email)}</td>
            <td><span class="adm-badge ${a.event.includes('failed') ? 'fail' : 'ok'}">${escHtml(EVENT_LABELS[a.event] || a.event)}</span></td>
            <td>${escHtml(a.ip || '—')}</td>
            <td>${escHtml(a.detail || '—')}</td>
            <td>${fmtDate(a.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  }

  async function loadAccounts() {
    const el = document.getElementById('adm-panel-accounts');
    el.innerHTML = '<div class="adm-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/accounts');
    if (!res.ok || !res.accounts.length) { el.innerHTML = '<div class="adm-empty">Aucun compte connu pour l\'instant</div>'; return; }

    el.innerHTML = `<table class="adm-table">
      <thead><tr><th>Email</th><th>Dernière connexion</th><th>Connexions réussies</th><th>Échecs</th></tr></thead>
      <tbody>
        ${res.accounts.map(a => `
          <tr>
            <td>${escHtml(a.email)}</td>
            <td>${fmtDate(a.last_login)}</td>
            <td>${a.login_count}</td>
            <td>${a.failed_count > 0 ? `<span class="adm-badge fail">${a.failed_count}</span>` : '0'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  }

  async function loadMeetings() {
    const el = document.getElementById('adm-panel-meetings');
    el.innerHTML = '<div class="adm-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/meetings');
    if (!res.ok || !res.meetings.length) { el.innerHTML = '<div class="adm-empty">Aucune réunion en cours ou programmée</div>'; return; }

    el.innerHTML = `<table class="adm-table">
      <thead><tr><th>Titre</th><th>Hôte</th><th>Statut</th><th>Type</th><th>Quand</th></tr></thead>
      <tbody>
        ${res.meetings.map(m => `
          <tr>
            <td>${escHtml(m.title || 'Réunion')}${m.parent_meeting_id ? ' <span style="color:var(--text-muted);">(sous-groupe)</span>' : ''}</td>
            <td>${escHtml(m.host)}</td>
            <td><span class="adm-badge ${m.status}">${m.status === 'live' ? 'En direct' : 'Programmée'}</span></td>
            <td>${escHtml(m.access)}</td>
            <td>${fmtDate(m.started_at || m.scheduled_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadActivity();
  });

  return { showTab };
})();
