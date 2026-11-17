const sigService = require('../services/signature');

function getActiveEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email || null;
}

async function getSignature(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });
  try {
    const sig = await sigService.getSignature(email);
    res.json({ ok: true, ...sig });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

async function saveSignature(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });
  const { header_html, footer_html } = req.body;
  try {
    await sigService.saveSignature(email, header_html, footer_html);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

module.exports = { getSignature, saveSignature };
