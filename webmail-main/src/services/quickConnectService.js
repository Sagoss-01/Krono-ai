/**
 * src/services/quickConnectService.js
 *
 * Connexion rapide sans mot de passe, dans les deux sens :
 *
 *  - "from_authenticated" : un appareil déjà connecté (A) génère un lien/QR
 *    à usage unique et courte durée. Le mot de passe (déjà en session, chiffré
 *    exactement comme pour une session normale) voyage brièvement et chiffré
 *    dans ce jeton, le temps que l'appareil B l'ouvre et finalise sa propre
 *    session — puis il est immédiatement effacé.
 *
 *  - "from_new_device" : un appareil pas encore connecté (B) affiche un QR
 *    "en attente". Un appareil déjà connecté (A) ouvre ce lien, voit à quoi
 *    ressemble l'appareil demandeur, et choisit d'approuver ou refuser.
 *    Une fois approuvé, B récupère une session de la même façon.
 *
 * Toutes les transitions de statut utilisent des UPDATE conditionnels
 * (WHERE status = '...') pour rester atomiques même en cas de double-clic
 * ou de scan multiple — un seul appareil peut consommer un jeton donné.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const { pool } = require('./db');

const TTL_MS = 2 * 60 * 1000; // 2 minutes — assez court pour limiter le risque si le lien fuite

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function baseUrl() {
  return process.env.APP_URL || 'https://webmail.netiify.cloud';
}

async function generateFromAuthenticated({ email, passwordEnc, originSessionId }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await pool.execute(
    `INSERT INTO quick_connect_tokens (token, direction, email, status, password_enc, origin_session_id, expires_at)
     VALUES (?, 'from_authenticated', ?, 'pending', ?, ?, ?)`,
    [token, email, passwordEnc, originSessionId, expiresAt]
  );

  const url = `${baseUrl()}/quick-connect/consume?token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });

  return { token, url, qrDataUrl, expiresAt };
}

async function requestFromNewDevice({ ua, ip }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await pool.execute(
    `INSERT INTO quick_connect_tokens (token, direction, status, requester_ua, requester_ip, expires_at)
     VALUES (?, 'from_new_device', 'pending', ?, ?, ?)`,
    [token, ua || null, ip || null, expiresAt]
  );

  const url = `${baseUrl()}/quick-connect/approve?token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });

  return { token, url, qrDataUrl, expiresAt };
}

async function getToken(token) {
  const [rows] = await pool.execute(
    `SELECT token, direction, email, status, requester_ua, requester_ip, created_at, expires_at
     FROM quick_connect_tokens WHERE token = ? LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

/** Statut public pour le polling côté appareil demandeur (jamais le mot de passe chiffré). */
async function getPublicStatus(token) {
  const row = await getToken(token);
  if (!row) return { status: 'not_found' };
  if (row.status === 'pending' && row.expires_at < new Date()) return { status: 'expired' };
  return { status: row.status };
}

async function approveFromNewDevice({ token, email, passwordEnc, originSessionId, approverUa }) {
  const [result] = await pool.execute(
    `UPDATE quick_connect_tokens
     SET status = 'approved', email = ?, password_enc = ?, origin_session_id = ?, approver_ua = ?
     WHERE token = ? AND direction = 'from_new_device' AND status = 'pending' AND expires_at > NOW()`,
    [email, passwordEnc, originSessionId, approverUa || null, token]
  );
  return result.affectedRows > 0;
}

async function denyFromNewDevice(token) {
  await pool.execute(
    `UPDATE quick_connect_tokens SET status = 'denied'
     WHERE token = ? AND direction = 'from_new_device' AND status = 'pending'`,
    [token]
  );
}

/**
 * Finalise la connexion sur l'appareil qui consomme le jeton (B).
 * `expectedStatus` diffère selon le sens : 'pending' pour from_authenticated
 * (déjà autorisé dès la génération), 'approved' pour from_new_device (il a
 * fallu l'accord explicite de A). Transition atomique vers 'used'.
 */
async function consume(token, expectedDirection, expectedStatus) {
  const [result] = await pool.execute(
    `UPDATE quick_connect_tokens SET status = 'used'
     WHERE token = ? AND direction = ? AND status = ? AND expires_at > NOW()`,
    [token, expectedDirection, expectedStatus]
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await pool.execute(
    `SELECT email, password_enc, origin_session_id FROM quick_connect_tokens WHERE token = ? LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (!row) return null;

  // Le mot de passe chiffré ne doit survivre que le temps strictement
  // nécessaire à cette requête — effacé immédiatement après lecture.
  await pool.execute(`UPDATE quick_connect_tokens SET password_enc = NULL WHERE token = ?`, [token]);

  return row;
}

async function cleanupExpired() {
  await pool.execute(
    `DELETE FROM quick_connect_tokens WHERE expires_at < (NOW() - INTERVAL 1 HOUR)`
  );
}

function startCleanupScheduler() {
  setInterval(() => {
    cleanupExpired().catch((err) => console.error('[quick-connect] cleanup:', err.message));
  }, 15 * 60 * 1000);
}

module.exports = {
  generateFromAuthenticated,
  requestFromNewDevice,
  getToken,
  getPublicStatus,
  approveFromNewDevice,
  denyFromNewDevice,
  consume,
  cleanupExpired,
  startCleanupScheduler
};
