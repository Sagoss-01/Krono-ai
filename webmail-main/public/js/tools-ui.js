/**
 * public/js/tools-ui.js
 * Bascule Mail <-> Outils (même pattern que ChatUI.showChatMode),
 * et gère les deux sous-vues : Calendrier et Contacts.
 */
const ToolsUI = (() => {
  // ── État Calendrier ──────────────────────────────────────────────────────
  let calCurrent = new Date();
  let calEvents = [];
  let calSelectedDayKey = null;

  // ── État Contacts ────────────────────────────────────────────────────────
  let cxAll = [];
  let cxSearchTimer = null;

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }
  async function apiGet(url) { const r = await fetch(url); return r.json(); }
  async function apiSend(url, body, method) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }
  async function apiDelete(url) {
    const r = await fetch(url, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfToken() } });
    return r.json();
  }
  function escHtml(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Bascule Mail <-> Outils ──────────────────────────────────────────────
  function clearActiveFolders() {
    document.querySelectorAll('#folder-list .folder-item.active').forEach(el => el.classList.remove('active'));
  }

  function showCalendar() {
    document.getElementById('mode-mail').style.display = 'none';
    document.getElementById('mode-chat').style.display = 'none';
    document.getElementById('mode-ai') && (document.getElementById('mode-ai').style.display = 'none');
    document.getElementById('sb-ai-item')?.classList.remove('active');
    document.getElementById('mode-tools').style.display = 'flex';
    document.getElementById('tools-view-calendar').style.display = 'flex';
    document.getElementById('tools-view-contacts').style.display = 'none';
    document.getElementById('tools-view-admin').style.display = 'none';
    sessionStorage.setItem('ts_mode', 'tools-calendar');
    clearActiveFolders();
    document.getElementById('sb-tool-calendar')?.classList.add('active');
    document.getElementById('sb-tool-contacts')?.classList.remove('active');
    document.getElementById('sb-tool-admin')?.classList.remove('active');
    calLoadMonth();
  }

  function showContacts() {
    document.getElementById('mode-mail').style.display = 'none';
    document.getElementById('mode-chat').style.display = 'none';
    document.getElementById('mode-ai') && (document.getElementById('mode-ai').style.display = 'none');
    document.getElementById('sb-ai-item')?.classList.remove('active');
    document.getElementById('mode-tools').style.display = 'flex';
    document.getElementById('tools-view-calendar').style.display = 'none';
    document.getElementById('tools-view-contacts').style.display = 'flex';
    document.getElementById('tools-view-admin').style.display = 'none';
    sessionStorage.setItem('ts_mode', 'tools-contacts');
    clearActiveFolders();
    document.getElementById('sb-tool-contacts')?.classList.add('active');
    document.getElementById('sb-tool-calendar')?.classList.remove('active');
    document.getElementById('sb-tool-admin')?.classList.remove('active');
    cxLoad();
  }

  function showAdmin() {
    document.getElementById('mode-mail').style.display = 'none';
    document.getElementById('mode-chat').style.display = 'none';
    document.getElementById('mode-ai') && (document.getElementById('mode-ai').style.display = 'none');
    document.getElementById('sb-ai-item')?.classList.remove('active');
    document.getElementById('mode-tools').style.display = 'flex';
    document.getElementById('tools-view-calendar').style.display = 'none';
    document.getElementById('tools-view-contacts').style.display = 'none';
    document.getElementById('tools-view-admin').style.display = 'flex';
    sessionStorage.setItem('ts_mode', 'tools-admin');
    clearActiveFolders();
    document.getElementById('sb-tool-admin')?.classList.add('active');
    document.getElementById('sb-tool-calendar')?.classList.remove('active');
    document.getElementById('sb-tool-contacts')?.classList.remove('active');
    admLoadStats();
    admShowTab('activity');
  }

  // ═══ CALENDRIER ═══════════════════════════════════════════════════════════
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function toLocalInput(date) {
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function calLoadMonth() {
    const start = new Date(calCurrent.getFullYear(), calCurrent.getMonth(), 1);
    const end = new Date(calCurrent.getFullYear(), calCurrent.getMonth() + 1, 1);
    const res = await apiGet('/api/calendar/events?start=' + start.toISOString() + '&end=' + end.toISOString());
    calEvents = res.ok ? res.events : [];
    calRender();
  }

  function calRender() {
    document.getElementById('cal-month-label').textContent =
      calCurrent.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    document.getElementById('tools-cal-dow').innerHTML =
      ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d => `<div class="tools-cal-dow-cell">${d}</div>`).join('');

    const firstOfMonth = new Date(calCurrent.getFullYear(), calCurrent.getMonth(), 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const todayKey = dayKey(new Date());
    const byDay = {};
    calEvents.forEach(e => { const k = dayKey(new Date(e.start_at)); (byDay[k] = byDay[k] || []).push(e); });

    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const k = dayKey(d);
      const isOther = d.getMonth() !== calCurrent.getMonth();
      const isToday = k === todayKey;
      const dayEvents = (byDay[k] || []).sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
      const shown = dayEvents.slice(0, 2);
      const rest = dayEvents.length - shown.length;

      html += `<div class="tools-cal-cell ${isOther?'other-month':''} ${isToday?'today':''}" onclick="ToolsUI.calSelectDay('${k}')">
        <div class="tools-cal-daynum">${d.getDate()}</div>
        ${shown.map(e => `<div class="tools-cal-evt ${e.meeting_id?'meeting':''}">${escHtml(e.title)}</div>`).join('')}
        ${rest > 0 ? `<div class="tools-cal-evt-more">+${rest}</div>` : ''}
      </div>`;
    }
    document.getElementById('tools-cal-grid').innerHTML = html;

    if (calSelectedDayKey) calSelectDay(calSelectedDayKey);
  }

  function calSelectDay(k) {
    calSelectedDayKey = k;
    const byDay = {};
    calEvents.forEach(e => { const key = dayKey(new Date(e.start_at)); (byDay[key] = byDay[key] || []).push(e); });
    const dayEvents = (byDay[k] || []).sort((a,b) => new Date(a.start_at) - new Date(b.start_at));

    const [y,m,d] = k.split('-').map(Number);
    document.getElementById('tools-cal-day-title').textContent =
      new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    const itemsEl = document.getElementById('tools-cal-day-items');
    if (!dayEvents.length) {
      itemsEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Aucun événement ce jour-là.</div>';
    } else {
      itemsEl.innerHTML = dayEvents.map(e => {
        const time = e.all_day ? 'Journée' : new Date(e.start_at).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        return `<div class="tools-cal-day-item" onclick="ToolsUI.calOpenEdit(${e.id})">
          <div class="time">${time}</div>
          <div class="title">${escHtml(e.title)}</div>
          <div class="meta">${e.location ? escHtml(e.location) : ''}</div>
        </div>`;
      }).join('');
    }
    document.getElementById('tools-cal-day-list').style.display = 'block';
  }

  function calPrevMonth() { calCurrent.setMonth(calCurrent.getMonth() - 1); calLoadMonth(); }
  function calNextMonth() { calCurrent.setMonth(calCurrent.getMonth() + 1); calLoadMonth(); }

  function calOnMeetingToggle() {
    const isMeeting = document.getElementById('tools-cal-is-meeting').checked;
    document.getElementById('tools-cal-location-field').style.display = isMeeting ? 'none' : 'block';
  }

  function calOpenNew() {
    document.getElementById('tools-cal-modal-title').textContent = 'Nouvel événement';
    document.getElementById('tools-cal-id').value = '';
    document.getElementById('tools-cal-is-meeting').checked = false;
    document.getElementById('tools-cal-is-meeting').disabled = false;
    document.getElementById('tools-cal-title').value = '';
    document.getElementById('tools-cal-location').value = '';
    document.getElementById('tools-cal-description').value = '';
    document.getElementById('tools-cal-attendees').value = '';
    document.getElementById('tools-cal-reminder').value = '10';
    document.getElementById('tools-cal-location-field').style.display = 'block';
    document.getElementById('tools-cal-delete-link').style.display = 'none';
    document.getElementById('tools-cal-modal-err').textContent = '';

    const now = calSelectedDayKey ? new Date(calSelectedDayKey + 'T09:00') : new Date(Date.now() + 30*60000);
    const end = new Date(now.getTime() + 60*60000);
    document.getElementById('tools-cal-start').value = toLocalInput(now);
    document.getElementById('tools-cal-end').value = toLocalInput(end);

    document.getElementById('tools-cal-modal').classList.add('open');
  }

  function calOpenEdit(id) {
    const e = calEvents.find(x => x.id === id);
    if (!e) return;
    document.getElementById('tools-cal-modal-title').textContent = "Éditer l'événement";
    document.getElementById('tools-cal-id').value = e.id;
    document.getElementById('tools-cal-is-meeting').checked = !!e.meeting_id;
    document.getElementById('tools-cal-is-meeting').disabled = !!e.meeting_id;
    document.getElementById('tools-cal-title').value = e.title;
    document.getElementById('tools-cal-location').value = e.location || '';
    document.getElementById('tools-cal-description').value = e.description || '';
    document.getElementById('tools-cal-attendees').value = (e.attendee_emails || []).join(', ');
    document.getElementById('tools-cal-reminder').value = e.reminder_minutes ?? '';
    document.getElementById('tools-cal-start').value = toLocalInput(e.start_at);
    document.getElementById('tools-cal-end').value = toLocalInput(e.end_at);
    document.getElementById('tools-cal-location-field').style.display = e.meeting_id ? 'none' : 'block';
    document.getElementById('tools-cal-delete-link').style.display = 'block';
    document.getElementById('tools-cal-modal-err').textContent = '';
    document.getElementById('tools-cal-modal').classList.add('open');
  }

  function calCloseModal() {
    document.getElementById('tools-cal-modal').classList.remove('open');
    document.getElementById('tools-cal-is-meeting').disabled = false;
  }

  async function calSave() {
    const id = document.getElementById('tools-cal-id').value;
    const title = document.getElementById('tools-cal-title').value.trim();
    const startAt = document.getElementById('tools-cal-start').value;
    const endAt = document.getElementById('tools-cal-end').value;
    const location = document.getElementById('tools-cal-location').value.trim();
    const description = document.getElementById('tools-cal-description').value.trim();
    const attendees = document.getElementById('tools-cal-attendees').value.trim();
    const reminderMinutes = document.getElementById('tools-cal-reminder').value || null;
    const isMeeting = document.getElementById('tools-cal-is-meeting').checked;
    const errEl = document.getElementById('tools-cal-modal-err');

    if (!title) { errEl.textContent = 'Titre requis'; return; }
    if (!startAt || !endAt) { errEl.textContent = 'Dates requises'; return; }
    if (new Date(endAt) < new Date(startAt)) { errEl.textContent = 'La fin doit être après le début'; return; }

    const payload = {
      title, description, location,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      allDay: false,
      reminderMinutes: reminderMinutes ? parseInt(reminderMinutes) : null,
      attendees, isMeeting,
    };

    const res = id
      ? await apiSend('/api/calendar/events/' + id, payload, 'PUT')
      : await apiSend('/api/calendar/events', payload, 'POST');

    if (res.ok) { calCloseModal(); calLoadMonth(); }
    else errEl.textContent = res.error || 'Erreur';
  }

  async function calRemoveCurrent() {
    const id = document.getElementById('tools-cal-id').value;
    if (!id) return;
    const ok = await ConfirmModal.show({
      title: 'Supprimer cet événement ?',
      body: 'Cette action est définitive. Les invités ne seront pas notifiés de la suppression.',
      danger: true,
    });
    if (!ok) return;
    await apiDelete('/api/calendar/events/' + id);
    calCloseModal();
    calLoadMonth();
  }

  // ═══ CONTACTS ═══════════════════════════════════════════════════════════
  function cxInitials(name) {
    return (name || '?').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
  }

  function cxRender(list) {
    const el = document.getElementById('tools-cx-list');
    if (!list.length) {
      el.innerHTML = '<div class="tools-empty">Aucun contact. Ajoute ton premier contact avec le bouton +.</div>';
      return;
    }
    el.innerHTML = list.map(c => `
      <div class="tools-cx-card">
        <div class="tools-cx-avatar">${cxInitials(c.name)}</div>
        <div class="tools-cx-info">
          <div class="tools-cx-name">${escHtml(c.name)}</div>
          <div class="tools-cx-sub">${escHtml(c.email)}${c.company ? ' · ' + escHtml(c.company) : ''}</div>
        </div>
        <div class="tools-cx-actions">
          <button class="tools-cx-icon-btn fav ${c.favorite ? 'active' : ''}" title="Favori" onclick="ToolsUI.cxToggleFav(${c.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${c.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="tools-cx-icon-btn" title="Éditer" onclick="ToolsUI.cxOpenEdit(${c.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="tools-cx-icon-btn" title="Supprimer" onclick="ToolsUI.cxRemove(${c.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>`).join('');
  }

  async function cxLoad() {
    const res = await apiGet('/api/contacts');
    if (res.ok) { cxAll = res.contacts; cxRender(cxAll); }
  }

  function cxSearch(q) {
    clearTimeout(cxSearchTimer);
    cxSearchTimer = setTimeout(async () => {
      const res = await apiGet('/api/contacts?q=' + encodeURIComponent(q));
      if (res.ok) cxRender(res.contacts);
    }, 250);
  }

  function cxOpenNew() {
    document.getElementById('tools-cx-modal-title').textContent = 'Nouveau contact';
    document.getElementById('tools-cx-id').value = '';
    ['tools-cx-name','tools-cx-email','tools-cx-phone','tools-cx-company','tools-cx-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('tools-cx-modal-err').textContent = '';
    document.getElementById('tools-cx-modal').classList.add('open');
  }

  function cxOpenEdit(id) {
    const c = cxAll.find(x => x.id === id);
    if (!c) return;
    document.getElementById('tools-cx-modal-title').textContent = 'Éditer le contact';
    document.getElementById('tools-cx-id').value = c.id;
    document.getElementById('tools-cx-name').value = c.name;
    document.getElementById('tools-cx-email').value = c.email;
    document.getElementById('tools-cx-phone').value = c.phone || '';
    document.getElementById('tools-cx-company').value = c.company || '';
    document.getElementById('tools-cx-notes').value = c.notes || '';
    document.getElementById('tools-cx-modal-err').textContent = '';
    document.getElementById('tools-cx-modal').classList.add('open');
  }

  function cxCloseModal() { document.getElementById('tools-cx-modal').classList.remove('open'); }

  async function cxSave() {
    const id = document.getElementById('tools-cx-id').value;
    const name = document.getElementById('tools-cx-name').value.trim();
    const email = document.getElementById('tools-cx-email').value.trim();
    const phone = document.getElementById('tools-cx-phone').value.trim();
    const company = document.getElementById('tools-cx-company').value.trim();
    const notes = document.getElementById('tools-cx-notes').value.trim();
    const errEl = document.getElementById('tools-cx-modal-err');
    if (!name || !email) { errEl.textContent = 'Nom et email requis'; return; }

    const payload = { name, email, phone, company, notes };
    const res = id
      ? await apiSend('/api/contacts/' + id, payload, 'PUT')
      : await apiSend('/api/contacts', payload, 'POST');

    if (res.ok) { cxCloseModal(); cxLoad(); }
    else errEl.textContent = res.error || 'Erreur';
  }

  async function cxToggleFav(id) { await apiSend('/api/contacts/' + id + '/favorite', {}, 'POST'); cxLoad(); }
  async function cxRemove(id) {
    const ok = await ConfirmModal.show({
      title: 'Supprimer ce contact ?',
      body: 'Cette action est définitive.',
      danger: true,
    });
    if (!ok) return;
    await apiDelete('/api/contacts/' + id);
    cxLoad();
  }

  // Fermer les modals en cliquant en dehors
  document.getElementById('tools-cal-modal')?.addEventListener('click', e => { if (e.target.id === 'tools-cal-modal') calCloseModal(); });
  document.getElementById('tools-cx-modal')?.addEventListener('click', e => { if (e.target.id === 'tools-cx-modal') cxCloseModal(); });

  // ═══ ADMINISTRATION ═══════════════════════════════════════════════════════
  const ADM_EVENT_LABELS = {
    login_success: 'Connexion réussie',
    login_failed: 'Échec de connexion',
    login_blocked_suspended: 'Connexion bloquée (suspendu)',
    login_pending_2fa: 'Connexion — code 2FA en attente',
    password_reset: 'Mot de passe réinitialisé',
    '2fa_enabled': '2FA activée',
    '2fa_disabled': '2FA désactivée',
    admin_added: 'Administrateur ajouté',
    admin_removed: 'Administrateur retiré',
    account_suspended: 'Compte suspendu',
    account_unsuspended: 'Compte réactivé',
    account_deleted: 'Compte supprimé',
  };

  function admFmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function admLoadStats() {
    const el = document.getElementById('tools-adm-stats');
    el.innerHTML = '<div class="tools-adm-stat-card"><div class="tools-adm-stat-value">…</div><div class="tools-adm-stat-label">Chargement</div></div>';
    const res = await apiGet('/api/admin/overview');
    if (!res.ok) { el.innerHTML = '<div class="tools-empty">Erreur de chargement</div>'; return; }
    const s = res.stats;
    const cards = [
      { v: s.uniqueUsers, l: 'Comptes connus' },
      { v: s.liveMeetings, l: 'Réunions en direct' },
      { v: s.scheduledMeetings, l: 'Programmées' },
      { v: s.suspendedCount, l: 'Suspendus' },
      { v: s.activity24h, l: 'Événements (24h)' },
      { v: s.failedLogins24h, l: 'Échecs (24h)' },
    ];
    el.innerHTML = cards.map(c => `<div class="tools-adm-stat-card"><div class="tools-adm-stat-value">${c.v}</div><div class="tools-adm-stat-label">${c.l}</div></div>`).join('');
  }

  function admShowTab(tab) {
    ['activity', 'accounts', 'meetings', 'admins', 'ai'].forEach(t => {
      document.getElementById('adm-tab-' + t).classList.toggle('active', t === tab);
      document.getElementById('adm-panel-' + t).style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'activity') admLoadActivity();
    if (tab === 'accounts') admLoadAccounts();
    if (tab === 'meetings') admLoadMeetings();
    if (tab === 'admins') admLoadAdmins();
    if (tab === 'ai' && typeof AdminAI !== 'undefined') AdminAI.load();
  }

  async function admLoadActivity() {
    const el = document.getElementById('adm-panel-activity');
    el.innerHTML = '<div class="tools-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/activity?limit=150');
    if (!res.ok || !res.activity.length) { el.innerHTML = '<div class="tools-empty">Aucune activité enregistrée</div>'; return; }
    el.innerHTML = `<table class="tools-adm-table">
      <thead><tr><th>Compte</th><th>Événement</th><th>IP</th><th>Date</th></tr></thead>
      <tbody>${res.activity.map(a => `
        <tr>
          <td>${escHtml(a.email)}</td>
          <td><span class="tools-adm-badge ${a.event.includes('failed') || a.event.includes('blocked') || a.event.includes('deleted') ? 'fail' : 'ok'}">${escHtml(ADM_EVENT_LABELS[a.event] || a.event)}</span></td>
          <td>${escHtml(a.ip || '—')}</td>
          <td>${admFmtDate(a.created_at)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  }

  async function admLoadAccounts() {
    const el = document.getElementById('adm-panel-accounts');
    el.innerHTML = '<div class="tools-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/accounts');
    if (!res.ok || !res.accounts.length) { el.innerHTML = '<div class="tools-empty">Aucun compte connu pour l\'instant</div>'; return; }
    el.innerHTML = `<table class="tools-adm-table">
      <thead><tr><th>Email</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr></thead>
      <tbody>${res.accounts.map(a => `
        <tr>
          <td>${escHtml(a.email)}</td>
          <td><span class="tools-adm-badge ${a.status}">${a.status === 'suspended' ? 'Suspendu' : 'Actif'}</span></td>
          <td>${admFmtDate(a.last_login)}</td>
          <td>
            ${a.status === 'suspended'
              ? `<button class="tools-adm-mini-btn" onclick="ToolsUI.admUnsuspend('${a.email}')">Réactiver</button>`
              : `<button class="tools-adm-mini-btn" onclick="ToolsUI.admOpenSuspend('${a.email}')">Suspendre</button>`}
            <button class="tools-adm-mini-btn danger" onclick="ToolsUI.admOpenDelete('${a.email}')">Supprimer</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
  }

  async function admLoadMeetings() {
    const el = document.getElementById('adm-panel-meetings');
    el.innerHTML = '<div class="tools-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/meetings');
    if (!res.ok || !res.meetings.length) { el.innerHTML = '<div class="tools-empty">Aucune réunion en cours ou programmée</div>'; return; }
    el.innerHTML = `<table class="tools-adm-table">
      <thead><tr><th>Titre</th><th>Hôte</th><th>Statut</th><th>Quand</th></tr></thead>
      <tbody>${res.meetings.map(m => `
        <tr>
          <td>${escHtml(m.title || 'Réunion')}${m.parent_meeting_id ? ' <span style="color:var(--text-muted);">(sous-groupe)</span>' : ''}</td>
          <td>${escHtml(m.host)}</td>
          <td><span class="tools-adm-badge ${m.status}">${m.status === 'live' ? 'Direct' : 'Programmée'}</span></td>
          <td>${admFmtDate(m.started_at || m.scheduled_at)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  }

  async function admLoadAdmins() {
    const el = document.getElementById('adm-panel-admins');
    el.innerHTML = '<div class="tools-empty">Chargement…</div>';
    const res = await apiGet('/api/admin/admins');
    if (!res.ok) { el.innerHTML = '<div class="tools-empty">Erreur de chargement</div>'; return; }
    el.innerHTML = `
      <button class="tools-cx-icon-btn" style="width:auto;padding:6px 12px;margin-bottom:12px;" onclick="ToolsUI.admOpenAddAdmin()">+ Ajouter un administrateur</button>
      <table class="tools-adm-table">
        <thead><tr><th>Email</th><th>Ajouté par</th><th>Depuis</th><th></th></tr></thead>
        <tbody>${res.admins.map(a => `
          <tr>
            <td>${escHtml(a.email)}</td>
            <td>${escHtml(a.added_by || '—')}</td>
            <td>${admFmtDate(a.created_at)}</td>
            <td><button class="tools-adm-mini-btn danger" onclick="ToolsUI.admRemoveAdmin('${a.email}')">Retirer</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  // ── Modal confirmation (suspendre / supprimer) ──────────────────────────────
  let _admPendingAction = null; // { type: 'suspend'|'delete', email }

  function admOpenSuspend(email) {
    _admPendingAction = { type: 'suspend', email };
    document.getElementById('tools-adm-modal-title').textContent = 'Suspendre ce compte ?';
    document.getElementById('tools-adm-modal-body').innerHTML = `<b>${escHtml(email)}</b> ne pourra plus se connecter tant que le compte est suspendu. Un email de notification lui sera envoyé.`;
    document.getElementById('tools-adm-reason-field').style.display = 'block';
    document.getElementById('tools-adm-reason-inp').value = '';
    document.getElementById('tools-adm-modal-err').textContent = '';
    document.getElementById('tools-adm-modal-confirm').textContent = 'Suspendre';
    document.getElementById('tools-adm-modal-confirm').onclick = admConfirmSuspend;
    document.getElementById('tools-adm-modal').classList.add('open');
  }

  function admOpenDelete(email) {
    _admPendingAction = { type: 'delete', email };
    document.getElementById('tools-adm-modal-title').textContent = 'Supprimer ce compte ?';
    document.getElementById('tools-adm-modal-body').innerHTML = `Action <b>définitive et irréversible</b> — la boîte mail de <b>${escHtml(email)}</b> sera supprimée du serveur. Un email de notification lui sera envoyé avant suppression.`;
    document.getElementById('tools-adm-reason-field').style.display = 'none';
    document.getElementById('tools-adm-modal-err').textContent = '';
    document.getElementById('tools-adm-modal-confirm').textContent = 'Supprimer définitivement';
    document.getElementById('tools-adm-modal-confirm').onclick = admConfirmDelete;
    document.getElementById('tools-adm-modal').classList.add('open');
  }

  function admCloseModal() {
    document.getElementById('tools-adm-modal').classList.remove('open');
    _admPendingAction = null;
  }

  async function admConfirmSuspend() {
    if (!_admPendingAction) return;
    const reason = document.getElementById('tools-adm-reason-inp').value.trim();
    const res = await apiSend(`/api/admin/accounts/${encodeURIComponent(_admPendingAction.email)}/suspend`, { reason }, 'POST');
    if (res.ok) { admCloseModal(); admLoadAccounts(); admLoadStats(); }
    else document.getElementById('tools-adm-modal-err').textContent = res.error || 'Erreur';
  }

  async function admConfirmDelete() {
    if (!_admPendingAction) return;
    const res = await apiDelete(`/api/admin/accounts/${encodeURIComponent(_admPendingAction.email)}`);
    if (res.ok) { admCloseModal(); admLoadAccounts(); admLoadStats(); }
    else document.getElementById('tools-adm-modal-err').textContent = res.error || 'Erreur';
  }

  async function admUnsuspend(email) {
    const res = await apiSend(`/api/admin/accounts/${encodeURIComponent(email)}/unsuspend`, {}, 'POST');
    if (res.ok) { admLoadAccounts(); admLoadStats(); }
  }

  // ── Ajout d'administrateur ───────────────────────────────────────────────
  function admOpenAddAdmin() {
    document.getElementById('tools-adm-add-email').value = '';
    document.getElementById('tools-adm-add-err').textContent = '';
    document.getElementById('tools-adm-add-modal').classList.add('open');
  }
  function admCloseAddModal() { document.getElementById('tools-adm-add-modal').classList.remove('open'); }

  async function admConfirmAddAdmin() {
    const email = document.getElementById('tools-adm-add-email').value.trim();
    const errEl = document.getElementById('tools-adm-add-err');
    if (!email) { errEl.textContent = 'Email requis'; return; }
    const res = await apiSend('/api/admin/admins', { email }, 'POST');
    if (res.ok) { admCloseAddModal(); admLoadAdmins(); }
    else errEl.textContent = res.error || 'Erreur';
  }

  async function admRemoveAdmin(email) {
    const ok = await ConfirmModal.show({ title: 'Retirer cet administrateur ?', body: escHtml(email), danger: true });
    if (!ok) return;
    const res = await apiDelete('/api/admin/admins/' + encodeURIComponent(email));
    if (res.ok) admLoadAdmins();
    else App.toast(res.error || 'Erreur', 'error');
  }

  // ── Visibilité de la section Admin dans la sidebar (recalculée au switch de compte) ──
  // Limite connue : si la section n'existait pas au chargement initial (compte
  // non-admin), on ne peut pas l'injecter dynamiquement sans dupliquer le
  // template EJS en JS — passer d'un compte non-admin à un compte admin sans
  // recharger la page ne fera donc pas apparaître la section (elle apparaîtra
  // au prochain rechargement). On gère en revanche correctement le cas où
  // elle existe déjà (masquage si on bascule vers un compte non-admin).
  async function refreshAdminVisibility() {
    const res = await apiGet('/api/admin/status');
    const section = document.getElementById('sb-admin-section');
    if (!section) return;
    const show = res.ok && res.isAdmin;
    section.style.display = show ? '' : 'none';
    const hr = section.previousElementSibling;
    if (hr && hr.tagName === 'HR') hr.style.display = show ? '' : 'none';
  }

  document.getElementById('tools-adm-modal')?.addEventListener('click', e => { if (e.target.id === 'tools-adm-modal') admCloseModal(); });
  document.getElementById('tools-adm-add-modal')?.addEventListener('click', e => { if (e.target.id === 'tools-adm-add-modal') admCloseAddModal(); });

  return {
    showCalendar, showContacts, showAdmin,
    calPrevMonth, calNextMonth, calSelectDay, calOpenNew, calOpenEdit, calCloseModal, calSave, calRemoveCurrent, calOnMeetingToggle,
    cxSearch, cxOpenNew, cxOpenEdit, cxCloseModal, cxSave, cxToggleFav, cxRemove,
    refreshContacts: cxLoad, refreshCalendar: calLoadMonth,
    admShowTab, admOpenSuspend, admOpenDelete, admCloseModal, admUnsuspend,
    admOpenAddAdmin, admCloseAddModal, admConfirmAddAdmin, admRemoveAdmin,
    refreshAdminVisibility,
  };
})();
