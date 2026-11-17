const quickConnectService = require('../services/quickConnectService');
const deviceService = require('../services/deviceService');
const { decrypt } = require('../middlewares/encrypt');
const { setAuthenticatedSession } = require('./authController');
const logger = require('../services/logger');

function getActiveAccount(req) {
  const email = req.session.activeAccount || req.session.accounts?.[0]?.email;
  const entry = req.session.accounts?.find((a) => a.email === email);
  return { email, encryptedPassword: entry?.password };
}

// ── Mode A : appareil déjà connecté génère un lien/QR ───────────────────────

async function generate(req, res) {
  try {
    const { email, encryptedPassword } = getActiveAccount(req);
    if (!email || !encryptedPassword) {
      return res.status(401).json({ ok: false, error: 'Non authentifié' });
    }

    const result = await quickConnectService.generateFromAuthenticated({
      email,
      passwordEnc: encryptedPassword, // déjà chiffré avec la même clé — pas de ré-encodage nécessaire
      originSessionId: req.sessionID
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.auth('quick-connect', 'ERROR', 'Échec génération QR', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

// Ouvert depuis l'appareil B (scan caméra native ou lien copié) — le jeton
// porte déjà l'autorité (généré par un appareil authentifié), donc connexion directe.
async function consumeFromAuthenticated(req, res) {
  const { token } = req.query;
  await finalizeConsumption(req, res, token, 'from_authenticated', 'pending', false);
}

// ── Mode B : nouvel appareil demande, un appareil connecté approuve ────────

async function request(req, res) {
  try {
    const result = await quickConnectService.requestFromNewDevice({
      ua: req.headers['user-agent'],
      ip: req.ip
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.auth('quick-connect', 'ERROR', 'Échec création demande QR', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

async function status(req, res) {
  const result = await quickConnectService.getPublicStatus(req.params.token);
  return res.json({ ok: true, ...result });
}

// Infos de l'appareil demandeur pour la modale d'approbation (appelée en
// AJAX par la modale — plus de page dédiée).
async function tokenInfo(req, res) {
  const { token } = req.params;
  const row = token ? await quickConnectService.getToken(token) : null;

  const valid = !!row && row.direction === 'from_new_device' && row.status === 'pending' && row.expires_at > new Date();
  if (!valid) return res.json({ ok: true, valid: false });

  return res.json({
    ok: true,
    valid: true,
    requesterUa: row.requester_ua,
    requesterIp: row.requester_ip
  });
}

async function decide(req, res) {
  try {
    const { token, decision } = req.body || {};
    const { email, encryptedPassword } = getActiveAccount(req);
    if (!email || !encryptedPassword) return res.status(401).json({ ok: false, error: 'Non authentifié' });

    if (decision === 'deny') {
      await quickConnectService.denyFromNewDevice(token);
      return res.json({ ok: true, decision: 'denied' });
    }

    const approved = await quickConnectService.approveFromNewDevice({
      token,
      email,
      passwordEnc: encryptedPassword,
      originSessionId: req.sessionID,
      approverUa: req.headers['user-agent']
    });

    if (!approved) {
      return res.status(400).json({ ok: false, error: 'Ce lien a expiré ou a déjà été utilisé.' });
    }

    logger.auth(email, 'INFO', 'Connexion rapide approuvée pour un nouvel appareil');
    return res.json({ ok: true, decision: 'approved' });
  } catch (err) {
    logger.auth('quick-connect', 'ERROR', 'Échec décision approbation', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

// Appelé par l'appareil B en polling une fois qu'il voit status: 'approved'
async function consumeApproved(req, res) {
  const { token } = req.body || {};
  await finalizeConsumption(req, res, token, 'from_new_device', 'approved', true);
}

// ── Finalisation commune : crée la session de B exactement comme un login normal ──

async function finalizeConsumption(req, res, token, expectedDirection, expectedStatus, jsonResponse) {
  const fail = (code, error) => jsonResponse
    ? res.status(code).json({ ok: false, error })
    : res.render('pages/recovery-status', { title: 'Connexion rapide — TechSphere Webmail', success: false, message: error });

  if (!token) return fail(400, 'Lien invalide.');

  try {
    const row = await quickConnectService.consume(token, expectedDirection, expectedStatus);
    if (!row) return fail(400, 'Ce lien a expiré, a déjà été utilisé, ou est invalide. Régénère un nouveau code.');

    const password = decrypt(row.password_enc);
    if (!password) return fail(500, 'Erreur de déchiffrement — réessaie de générer un nouveau code.');

    await setAuthenticatedSession(req, res, row.email, password, true);

    // Retrouve l'appareil "d'origine" (celui qui a généré/approuvé le lien)
    // pour proposer à B de le déconnecter juste après connexion.
    const originDeviceId = await deviceService.getDeviceIdBySessionId(row.origin_session_id);

    if (jsonResponse) {
      return res.json({ ok: true, redirect: '/mail', originDeviceId });
    }
    return res.redirect('/mail' + (originDeviceId ? `?quickConnectOrigin=${originDeviceId}` : '?quickConnected=1'));
  } catch (err) {
    if (err instanceof deviceService.DeviceBlockedError) {
      return fail(403, err.message);
    }
    logger.auth('quick-connect', 'ERROR', 'Échec finalisation connexion rapide', { message: err.message });
    return fail(500, 'Erreur serveur lors de la connexion.');
  }
}

module.exports = {
  generate,
  consumeFromAuthenticated,
  request,
  status,
  tokenInfo,
  decide,
  consumeApproved
};
