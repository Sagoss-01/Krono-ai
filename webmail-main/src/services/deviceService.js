/**
 * src/services/deviceService.js
 *
 * Gère :
 *  - le suivi des appareils/sessions actives par compte (table user_devices)
 *  - le blocage/liste noire par appareil (table blocked_devices), identifié
 *    par le cookie persistant ts_browser_id (voir browserAccounts.js)
 *  - la révocation "à effet immédiat" : suppression directe de la ligne de
 *    session dans app_sessions (donc invalide dès la prochaine requête HTTP,
 *    même sans redémarrage) + notification temps réel via socket.io pour les
 *    onglets déjà ouverts.
 */
const crypto = require('crypto');
const { pool } = require('./db');

const BLOCK_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Jeton signé et sans état (pas de table dédiée) pour le lien "bloquer cet
// appareil" envoyé par email : bloquer un appareil est une action idempotente
// et sans danger à rejouer, donc on accepte de ne pas le rendre "usage unique"
// strict — seule l'expiration compte ici.
function signBlockToken(deviceId, email) {
  const expiresAt = Date.now() + BLOCK_TOKEN_TTL_MS;
  const payload = `${deviceId}.${email}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyBlockToken(token) {
  try {
    const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [deviceId, email, expiresAt, sig] = parts;

    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(`${deviceId}.${email}.${expiresAt}`)
      .digest('hex');

    if (sig !== expected) return null;
    if (Date.now() > Number(expiresAt)) return null;

    return { deviceId: Number(deviceId), email };
  } catch (_) {
    return null;
  }
}

class DeviceBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeviceBlockedError';
  }
}

function labelFromUserAgent(ua = '') {
  let os = 'Appareil inconnu';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os|macintosh/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Navigateur inconnu';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

  return `${browser} sur ${os}`;
}

async function isBlocked(email, browserId) {
  if (!browserId) return false;
  const [rows] = await pool.execute(
    'SELECT 1 FROM blocked_devices WHERE email = ? AND browser_id = ? LIMIT 1',
    [email, browserId]
  );
  return rows.length > 0;
}

/**
 * À appeler juste après une authentification réussie (mot de passe/2FA OK),
 * AVANT de finaliser la session. Lève DeviceBlockedError si cet appareil a
 * été blacklisté pour ce compte — dans ce cas, la session ne doit jamais être créée.
 */
async function assertNotBlocked(email, browserId) {
  if (await isBlocked(email, browserId)) {
    throw new DeviceBlockedError(
      "Cet appareil a été bloqué pour ce compte. Reconnecte-toi depuis un appareil autorisé pour le débloquer."
    );
  }
}

/**
 * Enregistre/rafraîchit un appareil pour un compte donné.
 *
 * La confiance ("trusted") se construit automatiquement : un appareil tout
 * juste vu pour la première fois est "trusted = 0" (c'est justement ce qui
 * déclenche l'alerte) ; dès sa 2e connexion réussie, il passe "trusted = 1"
 * et ne redéclenchera plus d'alerte tout seul — sauf si la connexion est
 * jugée suspecte (voir isSuspiciousLogin), auquel cas on alerte quand même
 * même sur un appareil de confiance (ex : vol de cookie/session).
 *
 * Retourne { deviceId, isNewDevice, trusted, label }.
 */
async function touchDevice({ email, browserId, sessionId, userAgent, ip }) {
  const label = labelFromUserAgent(userAgent);

  const [existingForBrowser] = await pool.execute(
    'SELECT id, trusted FROM user_devices WHERE email = ? AND browser_id = ? AND revoked_at IS NULL LIMIT 1',
    [email, browserId]
  );
  const isNewDevice = existingForBrowser.length === 0;
  // Déjà vu au moins une fois avant CETTE connexion → confiance automatique,
  // sauf si un humain a explicitement retiré la confiance depuis la page
  // "Appareils" (auquel cas on respecte ce choix plutôt que de l'écraser).
  const trusted = isNewDevice ? 0 : (existingForBrowser[0].trusted ?? 1);

  await pool.execute(
    `INSERT INTO user_devices (email, browser_id, session_id, user_agent, device_label, ip, trusted, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       session_id = VALUES(session_id),
       user_agent = VALUES(user_agent),
       device_label = VALUES(device_label),
       ip = VALUES(ip),
       trusted = ?,
       last_seen = NOW(),
       revoked_at = NULL`,
    [email, browserId, sessionId, userAgent || null, label, ip || null, trusted, trusted]
  );

  const [rows] = await pool.execute(
    'SELECT id FROM user_devices WHERE email = ? AND browser_id = ? LIMIT 1',
    [email, browserId]
  );

  return { deviceId: rows[0]?.id || null, isNewDevice, trusted: !!trusted, label };
}

async function listDevices(email, currentSessionId) {
  const [rows] = await pool.execute(
    `SELECT id, browser_id, session_id, device_label, user_agent, ip, trusted, first_seen, last_seen
     FROM user_devices
     WHERE email = ? AND revoked_at IS NULL
     ORDER BY last_seen DESC`,
    [email]
  );
  return rows.map(r => ({
    id: r.id,
    label: r.device_label || labelFromUserAgent(r.user_agent),
    ip: r.ip,
    trusted: !!r.trusted,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    current: r.session_id === currentSessionId
  }));
}

async function setTrusted(deviceId, email, trusted) {
  const [result] = await pool.execute(
    'UPDATE user_devices SET trusted = ? WHERE id = ? AND email = ?',
    [trusted ? 1 : 0, deviceId, email]
  );
  return result.affectedRows > 0;
}

async function getDeviceOwned(deviceId, email) {
  const [rows] = await pool.execute(
    'SELECT id, email, browser_id, session_id FROM user_devices WHERE id = ? AND email = ? LIMIT 1',
    [deviceId, email]
  );
  return rows[0] || null;
}

async function getDeviceIdBySessionId(sessionId) {
  if (!sessionId) return null;
  const [rows] = await pool.execute(
    'SELECT id FROM user_devices WHERE session_id = ? AND revoked_at IS NULL LIMIT 1',
    [sessionId]
  );
  return rows[0]?.id || null;
}

/**
 * Retire l'accès de cet appareil : supprime sa session en base (effet immédiat
 * à la prochaine requête HTTP) et marque la ligne comme révoquée.
 * Retourne { sessionId } pour permettre au contrôleur d'émettre l'événement
 * socket.io de déconnexion instantanée sur un onglet déjà ouvert.
 */
async function revokeDevice(deviceId, email) {
  const device = await getDeviceOwned(deviceId, email);
  if (!device) return null;

  await pool.execute('DELETE FROM app_sessions WHERE session_id = ?', [device.session_id]);
  await pool.execute('UPDATE user_devices SET revoked_at = NOW() WHERE id = ?', [deviceId]);

  return { sessionId: device.session_id, browserId: device.browser_id };
}

async function blockDevice(deviceId, email, reason = 'Bloqué manuellement par le propriétaire du compte') {
  const revoked = await revokeDevice(deviceId, email);
  if (!revoked) return null;

  await pool.execute(
    `INSERT INTO blocked_devices (email, browser_id, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_at = NOW()`,
    [email, revoked.browserId, reason]
  );

  return revoked;
}

async function unblockDevice(email, browserId) {
  await pool.execute('DELETE FROM blocked_devices WHERE email = ? AND browser_id = ?', [email, browserId]);
}

module.exports = {
  DeviceBlockedError,
  labelFromUserAgent,
  isBlocked,
  assertNotBlocked,
  touchDevice,
  listDevices,
  setTrusted,
  getDeviceOwned,
  getDeviceIdBySessionId,
  revokeDevice,
  blockDevice,
  unblockDevice,
  signBlockToken,
  verifyBlockToken
};
