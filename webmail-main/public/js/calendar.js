const Cal = (() => {
  let current = new Date();
  let events = [];
  let selectedDayKey = null;

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  async function apiGet(url) {
    const r = await fetch(url);
    return r.json();
  }

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

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function toLocalInput(date) {
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function loadMonth() {
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const res = await apiGet('/api/calendar/events?start=' + start.toISOString() + '&end=' + end.toISOString());
    events = res.ok ? res.events : [];
    render();
  }

  function render() {
    const label = current.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('cal-month-label').textContent = label;

    const dowEl = document.getElementById('cal-dow');
    dowEl.innerHTML = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d => `<div class="cal-dow">${d}</div>`).join('');

    const firstOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // lundi = 0
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const todayKey = dayKey(new Date());
    const byDay = {};
    events.forEach(e => {
      const k = dayKey(new Date(e.start_at));
      (byDay[k] = byDay[k] || []).push(e);
    });

    const grid = document.getElementById('cal-grid');
    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const k = dayKey(d);
      const isOther = d.getMonth() !== current.getMonth();
      const isToday = k === todayKey;
      const dayEvents = (byDay[k] || []).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
      const shown = dayEvents.slice(0, 3);
      const rest = dayEvents.length - shown.length;

      html += `<div class="cal-cell ${isOther ? 'other-month' : ''} ${isToday ? 'today' : ''}" onclick="Cal.selectDay('${k}')">
        <div class="cal-daynum">${d.getDate()}</div>
        ${shown.map(e => `<div class="cal-evt ${e.meeting_id ? 'meeting' : ''}">${e.meeting_id ? '🎥 ' : ''}${escHtml(e.title)}</div>`).join('')}
        ${rest > 0 ? `<div class="cal-evt-more">+${rest} autre(s)</div>` : ''}
      </div>`;
    }
    grid.innerHTML = html;

    if (selectedDayKey) renderDayList(selectedDayKey, byDay[selectedDayKey] || []);
  }

  function selectDay(k) {
    selectedDayKey = k;
    const byDay = {};
    events.forEach(e => {
      const key = dayKey(new Date(e.start_at));
      (byDay[key] = byDay[key] || []).push(e);
    });
    renderDayList(k, (byDay[k] || []).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)));
  }

  function renderDayList(k, dayEvents) {
    const listEl = document.getElementById('cal-day-list');
    const titleEl = document.getElementById('cal-day-title');
    const itemsEl = document.getElementById('cal-day-items');
    const [y, m, d] = k.split('-').map(Number);
    titleEl.textContent = new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    if (!dayEvents.length) {
      itemsEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Aucun événement ce jour-là.</div>';
    } else {
      itemsEl.innerHTML = dayEvents.map(e => {
        const time = e.all_day ? 'Journée' : new Date(e.start_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="cal-day-item" onclick="Cal.openEdit(${e.id})" style="cursor:pointer;">
          <div class="time">${time}</div>
          <div class="title">${e.meeting_id ? '🎥 ' : ''}${escHtml(e.title)}</div>
          <div class="meta">${e.location ? escHtml(e.location) : ''}</div>
        </div>`;
      }).join('');
    }
    listEl.style.display = 'block';
  }

  function prevMonth() { current.setMonth(current.getMonth() - 1); loadMonth(); }
  function nextMonth() { current.setMonth(current.getMonth() + 1); loadMonth(); }

  function onMeetingToggle() {
    const isMeeting = document.getElementById('cal-is-meeting').checked;
    document.getElementById('cal-location-field').style.display = isMeeting ? 'none' : 'block';
  }

  function openNew() {
    document.getElementById('cal-modal-title').textContent = 'Nouvel événement';
    document.getElementById('cal-id').value = '';
    document.getElementById('cal-is-meeting').checked = false;
    document.getElementById('cal-title').value = '';
    document.getElementById('cal-location').value = '';
    document.getElementById('cal-description').value = '';
    document.getElementById('cal-attendees').value = '';
    document.getElementById('cal-reminder').value = '10';
    document.getElementById('cal-location-field').style.display = 'block';
    document.getElementById('cal-delete-link').style.display = 'none';
    document.getElementById('cal-modal-err').textContent = '';

    const now = selectedDayKey ? new Date(selectedDayKey + 'T09:00') : new Date(Date.now() + 30 * 60000);
    const end = new Date(now.getTime() + 60 * 60000);
    document.getElementById('cal-start').value = toLocalInput(now);
    document.getElementById('cal-end').value = toLocalInput(end);

    document.getElementById('cal-modal').classList.add('open');
  }

  function openEdit(id) {
    const e = events.find(x => x.id === id);
    if (!e) return;
    document.getElementById('cal-modal-title').textContent = 'Éditer l\'événement';
    document.getElementById('cal-id').value = e.id;
    document.getElementById('cal-is-meeting').checked = !!e.meeting_id;
    document.getElementById('cal-is-meeting').disabled = !!e.meeting_id; // pas de bascule après coup
    document.getElementById('cal-title').value = e.title;
    document.getElementById('cal-location').value = e.location || '';
    document.getElementById('cal-description').value = e.description || '';
    document.getElementById('cal-attendees').value = (e.attendee_emails || []).join(', ');
    document.getElementById('cal-reminder').value = e.reminder_minutes ?? '';
    document.getElementById('cal-start').value = toLocalInput(e.start_at);
    document.getElementById('cal-end').value = toLocalInput(e.end_at);
    document.getElementById('cal-location-field').style.display = e.meeting_id ? 'none' : 'block';
    document.getElementById('cal-delete-link').style.display = 'block';
    document.getElementById('cal-modal-err').textContent = '';
    document.getElementById('cal-modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('cal-modal').classList.remove('open');
    document.getElementById('cal-is-meeting').disabled = false;
  }

  async function save() {
    const id = document.getElementById('cal-id').value;
    const title = document.getElementById('cal-title').value.trim();
    const startAt = document.getElementById('cal-start').value;
    const endAt = document.getElementById('cal-end').value;
    const location = document.getElementById('cal-location').value.trim();
    const description = document.getElementById('cal-description').value.trim();
    const attendees = document.getElementById('cal-attendees').value.trim();
    const reminderMinutes = document.getElementById('cal-reminder').value || null;
    const isMeeting = document.getElementById('cal-is-meeting').checked;
    const errEl = document.getElementById('cal-modal-err');

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

    if (res.ok) {
      closeModal();
      loadMonth();
    } else {
      errEl.textContent = res.error || 'Erreur';
    }
  }

  async function removeCurrent() {
    const id = document.getElementById('cal-id').value;
    if (!id) return;
    if (!confirm('Supprimer cet événement ?')) return;
    await apiDelete('/api/calendar/events/' + id);
    closeModal();
    loadMonth();
  }

  document.addEventListener('DOMContentLoaded', loadMonth);
  document.getElementById('cal-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'cal-modal') closeModal();
  });

  return { prevMonth, nextMonth, openNew, openEdit, closeModal, save, removeCurrent, selectDay, onMeetingToggle };
})();
