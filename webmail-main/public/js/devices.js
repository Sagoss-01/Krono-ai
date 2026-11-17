const DevicesUI = (() => {
  // Icônes SVG en traits fins (même style que la barre du haut) — jamais
  // d'emoji dans cette modale, qui s'affichent en gros "stickers" colorés
  // selon les systèmes (voulu explicitement : pas de stickers, des icônes).
  const ICONS = {
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    alertTriangle: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shieldOff: '<path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'
  };
  function icon(name, size = 14) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  function escHtml(v = '') {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtDate(d) {
    return new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function deviceTypeIcon(label = '') {
    return /android|ios|iphone|ipad/i.test(label) ? icon('smartphone', 16) : icon('monitor', 16);
  }

  // ── Onglets de la modale (Appareils / Historique) ────────────────────────

  function showTab(tab) {
    ['devices', 'history'].forEach((t) => {
      const btn = document.getElementById('dtab-' + t);
      const panel = document.getElementById('dtab-panel-' + t);
      if (!btn || !panel) return;
      const active = t === tab;
      btn.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent';
      btn.style.color = active ? 'var(--accent)' : 'var(--text-muted)';
      btn.style.fontWeight = active ? '800' : '600';
      panel.style.display = active ? 'block' : 'none';
    });
    if (tab === 'devices') load();
    if (tab === 'history') loadHistory();
  }

  async function loadHistory() {
    const list = document.getElementById('history-modal-list');
    if (!list) return;
    list.innerHTML = 'Chargement…';
    try {
      const res = await App.apiGet('/api/account/login-history');
      if (!res.ok || !res.events.length) {
        list.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;">Aucun événement à afficher.</div>';
        return;
      }
      const FAIL_EVENTS = new Set(['login_failed', 'login_blocked_device', 'login_blocked_suspended']);
      list.innerHTML = res.events.map(e => {
        const isFail = FAIL_EVENTS.has(e.event);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);margin-bottom:6px;">
          <span style="color:${isFail ? '#f87171' : '#22c55e'};display:inline-flex;flex-shrink:0;">${icon(isFail ? 'alertTriangle' : 'checkCircle', 15)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text-1);">${escHtml(e.label)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${e.ip ? escHtml(e.ip) + ' · ' : ''}${fmtDate(e.createdAt)}</div>
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      list.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;">Erreur de chargement.</div>';
    }
  }

  async function load() {
    const list = document.getElementById('devices-modal-list');
    if (!list) return;
    list.innerHTML = 'Chargement…';
    try {
      const res = await App.apiGet('/api/devices');
      if (!res.ok || !res.devices.length) {
        list.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;">Aucun appareil connecté pour l\'instant.</div>';
        return;
      }
      list.innerHTML = res.devices.map(d => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid ${d.current ? 'rgba(34,197,94,.4)' : 'var(--border)'};background:${d.current ? 'rgba(34,197,94,.06)' : 'var(--bg-card)'};margin-bottom:8px;">
          <div style="width:36px;height:36px;border-radius:9px;background:var(--accent-lo);display:flex;align-items:center;justify-content:center;color:var(--text-2);flex-shrink:0;">${deviceTypeIcon(d.label)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--text-1);display:flex;align-items:center;gap:6px;">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(d.label)}</span>
              ${d.current ? `<span title="Cet appareil" style="color:#22c55e;display:inline-flex;">${icon('checkCircle', 13)}</span>` : ''}
              ${!d.trusted && !d.current ? `<span title="Appareil non vérifié" style="color:#f59e0b;display:inline-flex;">${icon('alertTriangle', 13)}</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${d.ip ? escHtml(d.ip) + ' · ' : ''}Actif ${fmtDate(d.lastSeen)}</div>
          </div>
          ${d.current ? '' : `
            <div style="display:flex;gap:5px;flex-shrink:0;">
              ${d.trusted
                ? `<button class="icon-btn-sm" title="Retirer la confiance (alertera à nouveau)" onclick="DevicesUI.trust(${d.id}, false)">${icon('shieldOff')}</button>`
                : `<button class="icon-btn-sm" title="Marquer de confiance" onclick="DevicesUI.trust(${d.id}, true)">${icon('shield')}</button>`}
              <button class="icon-btn-sm" title="Retirer cet appareil" onclick="DevicesUI.revoke(${d.id})">${icon('logOut')}</button>
              <button class="icon-btn-sm danger" title="Bloquer définitivement" onclick="DevicesUI.block(${d.id})">${icon('ban')}</button>
            </div>`}
        </div>`).join('');
    } catch (err) {
      list.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;">Erreur de chargement.</div>';
    }
  }

  async function revoke(id) {
    if (!confirm('Déconnecter cet appareil ? Il pourra se reconnecter avec le bon mot de passe.')) return;
    const res = await App.apiPost(`/api/devices/${id}/revoke`, {});
    if (res.ok) load(); else alert(res.error || 'Erreur');
  }

  async function block(id) {
    if (!confirm('Bloquer définitivement cet appareil ? Il ne pourra plus se reconnecter, même avec le bon mot de passe.')) return;
    const res = await App.apiPost(`/api/devices/${id}/block`, {});
    if (res.ok) load(); else alert(res.error || 'Erreur');
  }

  async function trust(id, value) {
    const res = await App.apiPost(`/api/devices/${id}/trust`, { trusted: value });
    if (res.ok) load(); else alert(res.error || 'Erreur');
  }

  return { load, revoke, block, trust, showTab };
})();
