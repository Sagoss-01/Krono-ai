const Contacts = (() => {
  let allContacts = [];
  let searchTimer = null;

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  async function apiGet(url) {
    const r = await fetch(url);
    return r.json();
  }

  async function apiPost(url, body, method = 'POST') {
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

  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  }

  function escHtml(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(list) {
    const el = document.getElementById('cx-list');
    if (!list.length) {
      el.innerHTML = '<div class="cx-empty">Aucun contact. Ajoute ton premier contact avec le bouton ci-dessus.</div>';
      return;
    }
    el.innerHTML = list.map(c => `
      <div class="cx-card">
        <div class="cx-avatar">${initials(c.name)}</div>
        <div class="cx-info">
          <div class="cx-name">${escHtml(c.name)}</div>
          <div class="cx-sub">${escHtml(c.email)}${c.company ? ' · ' + escHtml(c.company) : ''}${c.phone ? ' · ' + escHtml(c.phone) : ''}</div>
        </div>
        <div class="cx-actions">
          <button class="cx-icon-btn fav ${c.favorite ? 'active' : ''}" title="Favori" onclick="Contacts.toggleFav(${c.id})">★</button>
          <button class="cx-icon-btn" title="Éditer" onclick="Contacts.openEdit(${c.id})">✎</button>
          <button class="cx-icon-btn" title="Supprimer" onclick="Contacts.remove(${c.id})">🗑</button>
        </div>
      </div>`).join('');
  }

  async function load() {
    const res = await apiGet('/api/contacts');
    if (res.ok) { allContacts = res.contacts; render(allContacts); }
  }

  function onSearch(q) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const res = await apiGet('/api/contacts?q=' + encodeURIComponent(q));
      if (res.ok) render(res.contacts);
    }, 250);
  }

  function openNew() {
    document.getElementById('cx-modal-title').textContent = 'Nouveau contact';
    document.getElementById('cx-id').value = '';
    ['cx-name','cx-email','cx-phone','cx-company','cx-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cx-modal-err').textContent = '';
    document.getElementById('cx-modal').classList.add('open');
  }

  function openEdit(id) {
    const c = allContacts.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cx-modal-title').textContent = 'Éditer le contact';
    document.getElementById('cx-id').value = c.id;
    document.getElementById('cx-name').value = c.name;
    document.getElementById('cx-email').value = c.email;
    document.getElementById('cx-phone').value = c.phone || '';
    document.getElementById('cx-company').value = c.company || '';
    document.getElementById('cx-notes').value = c.notes || '';
    document.getElementById('cx-modal-err').textContent = '';
    document.getElementById('cx-modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('cx-modal').classList.remove('open');
  }

  async function save() {
    const id = document.getElementById('cx-id').value;
    const name = document.getElementById('cx-name').value.trim();
    const email = document.getElementById('cx-email').value.trim();
    const phone = document.getElementById('cx-phone').value.trim();
    const company = document.getElementById('cx-company').value.trim();
    const notes = document.getElementById('cx-notes').value.trim();
    const errEl = document.getElementById('cx-modal-err');

    if (!name || !email) { errEl.textContent = 'Nom et email requis'; return; }

    const payload = { name, email, phone, company, notes };
    const res = id
      ? await apiPost('/api/contacts/' + id, payload, 'PUT')
      : await apiPost('/api/contacts', payload, 'POST');

    if (res.ok) { closeModal(); load(); }
    else errEl.textContent = res.error || 'Erreur';
  }

  async function toggleFav(id) {
    await apiPost('/api/contacts/' + id + '/favorite', {});
    load();
  }

  async function remove(id) {
    if (!confirm('Supprimer ce contact ?')) return;
    await apiDelete('/api/contacts/' + id);
    load();
  }

  document.addEventListener('DOMContentLoaded', load);
  document.getElementById('cx-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'cx-modal') closeModal();
  });

  return { onSearch, openNew, openEdit, closeModal, save, toggleFav, remove };
})();
