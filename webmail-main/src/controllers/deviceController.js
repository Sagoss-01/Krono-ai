const deviceService = require('../services/deviceService');
const activityLog = require('../services/activityLogService');
const logger = require('../services/logger');

function getEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

async function list(req, res) {
  try {
    const email = getEmail(req);
    const devices = await deviceService.listDevices(email, req.sessionID);
    return res.json({ ok: true, devices });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec listing appareils', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

// Émet l'événement de déconnexion instantanée si l'appareil ciblé a un
// onglet ouvert avec un socket actif (voir socket.js : chaque connexion
// rejoint la room `device:<sessionID>`). Sans ça, la révocation reste
// effective dès la prochaine requête HTTP (ligne supprimée de app_sessions),
// mais un onglet déjà ouvert ne le saurait qu'au prochain clic.
function pushForceLogout(req, sessionId) {
  req.io?.to(`device:${sessionId}`).emit('force_logout', {
    reason: 'Ce compte a été déconnecté de cet appareil depuis un autre appareil.'
  });
}

async function revoke(req, res) {
  try {
    const email = getEmail(req);
    const deviceId = Number(req.params.id);

    if (deviceId && req.sessionID) {
      const targetDevice = await deviceService.getDeviceOwned(deviceId, email);
      if (targetDevice?.session_id === req.sessionID) {
        return res.status(400).json({ ok: false, error: "Impossible de retirer l'appareil que tu utilises actuellement — déconnecte-toi normalement à la place." });
      }
    }

    const result = await deviceService.revokeDevice(deviceId, email);
    if (!result) return res.status(404).json({ ok: false, error: 'Appareil introuvable' });

    pushForceLogout(req, result.sessionId);
    logger.auth(email, 'INFO', 'Appareil retiré', { deviceId });
    return res.json({ ok: true });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec révocation appareil', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

async function block(req, res) {
  try {
    const email = getEmail(req);
    const deviceId = Number(req.params.id);

    if (deviceId && req.sessionID) {
      const targetDevice = await deviceService.getDeviceOwned(deviceId, email);
      if (targetDevice?.session_id === req.sessionID) {
        return res.status(400).json({ ok: false, error: "Impossible de bloquer l'appareil que tu utilises actuellement." });
      }
    }

    const result = await deviceService.blockDevice(deviceId, email);
    if (!result) return res.status(404).json({ ok: false, error: 'Appareil introuvable' });

    pushForceLogout(req, result.sessionId);
    logger.auth(email, 'WARN', 'Appareil bloqué (liste noire)', { deviceId });
    return res.json({ ok: true });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec blocage appareil', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

// Lien cliqué directement depuis l'email d'alerte "nouvel appareil" — ne
// nécessite pas d'être connecté (le token signé porte l'autorité).
async function blockViaEmailLink(req, res) {
  const { token } = req.query;
  const decoded = token ? deviceService.verifyBlockToken(token) : null;

  if (!decoded) {
    return res.render('pages/recovery-status', {
      title: 'Lien invalide — TechSphere Webmail',
      success: false,
      message: 'Ce lien de blocage est invalide ou a expiré.'
    });
  }

  try {
    const result = await deviceService.blockDevice(decoded.deviceId, decoded.email);
    if (result) pushForceLogout(req, result.sessionId);

    logger.auth(decoded.email, 'WARN', 'Appareil bloqué via lien email', { deviceId: decoded.deviceId });

    return res.render('pages/recovery-status', {
      title: 'Appareil bloqué — TechSphere Webmail',
      success: true,
      message: result
        ? "Cet appareil a été bloqué. Il ne pourra plus se reconnecter à ton compte, même avec le bon mot de passe."
        : "Cet appareil était déjà déconnecté ou introuvable — rien à faire de plus."
    });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec blocage via lien email', { message: err.message });
    return res.render('pages/recovery-status', {
      title: 'Erreur — TechSphere Webmail',
      success: false,
      message: 'Une erreur est survenue, réessaie plus tard.'
    });
  }
}

async function trust(req, res) {
  try {
    const email = getEmail(req);
    const deviceId = Number(req.params.id);
    const { trusted } = req.body || {};

    const ok = await deviceService.setTrusted(deviceId, email, !!trusted);
    if (!ok) return res.status(404).json({ ok: false, error: 'Appareil introuvable' });

    logger.auth(email, 'INFO', trusted ? 'Appareil marqué de confiance' : 'Confiance retirée', { deviceId });
    return res.json({ ok: true });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec changement de confiance', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

const EVENT_LABELS = {
  login_success: 'Connexion réussie',
  login_failed: 'Échec de connexion',
  login_blocked_device: 'Connexion refusée — appareil bloqué',
  login_blocked_suspended: 'Connexion refusée — compte suspendu',
  password_reset: 'Mot de passe réinitialisé',
  '2fa_enabled': 'Double authentification activée',
  '2fa_disabled': 'Double authentification désactivée',
};

async function loginHistory(req, res) {
  try {
    const email = getEmail(req);
    const rows = await activityLog.getRecentForEmail(email, 30);
    return res.json({
      ok: true,
      events: rows.map(r => ({
        label: EVENT_LABELS[r.event] || r.event,
        event: r.event,
        ip: r.ip,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    logger.auth('devices', 'ERROR', 'Échec lecture historique de connexion', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

module.exports = { list, revoke, block, blockViaEmailLink, trust, loginHistory };
