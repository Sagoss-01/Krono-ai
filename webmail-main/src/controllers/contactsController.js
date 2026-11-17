const contactsService = require('../services/contactsService');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

async function list(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const contacts = await contactsService.list(email, req.query.q);
    res.json({ ok: true, contacts });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function create(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const { name, email: contactEmail, phone, company, notes } = req.body || {};
  if (!name || !contactEmail) return res.json({ ok: false, error: 'Nom et email requis' });

  try {
    const id = await contactsService.create(email, { name, email: contactEmail, phone, company, notes });
    res.json({ ok: true, id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.json({ ok: false, error: 'Ce contact existe déjà' });
    res.json({ ok: false, error: e.message });
  }
}

async function update(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const { name, email: contactEmail, phone, company, notes, favorite } = req.body || {};
  if (!name || !contactEmail) return res.json({ ok: false, error: 'Nom et email requis' });

  try {
    const ok = await contactsService.update(email, req.params.id, { name, email: contactEmail, phone, company, notes, favorite });
    res.json({ ok });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function toggleFavorite(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const ok = await contactsService.toggleFavorite(email, req.params.id);
    res.json({ ok });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function remove(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const ok = await contactsService.remove(email, req.params.id);
    res.json({ ok });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

module.exports = { list, create, update, toggleFavorite, remove };
