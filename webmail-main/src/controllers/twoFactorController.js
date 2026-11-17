const totpService = require('../services/totpService');
const imapService = require('../services/imap');
const activityLog = require('../services/activityLogService');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

// GET /api/account/2fa/status
async function status(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const s = await totpService.getStatus(email);
    res.json({ ok: true, ...s });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/account/2fa/setup — génère secret + QR + codes de secours (pas encore activé)
async function setup(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const { secret, qrDataUrl, backupCodes } = await totpService.startSetup(email);
    res.json({ ok: true, secret, qrDataUrl, backupCodes });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/account/2fa/enable — confirme avec un code généré par l'appli d'authentification
async function enable(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  const { token } = req.body || {};
  if (!token) return res.json({ ok: false, error: 'Code requis' });

  try {
    const ok = await totpService.confirmEnable(email, token);
    if (!ok) return res.json({ ok: false, error: 'Code invalide' });
    activityLog.log(email, '2fa_enabled', { ip: req.ip });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/account/2fa/disable — exige le mot de passe actuel (vérifié par IMAP) par sécurité
async function disable(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  const { password } = req.body || {};
  if (!password) return res.json({ ok: false, error: 'Mot de passe requis' });

  try {
    await imapService.testConnection({ email, password });
  } catch (e) {
    return res.json({ ok: false, error: 'Mot de passe incorrect' });
  }

  try {
    await totpService.disable(email);
    activityLog.log(email, '2fa_disabled', { ip: req.ip });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

module.exports = { status, setup, enable, disable };
