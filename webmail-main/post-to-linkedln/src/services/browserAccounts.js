/**
 * src/services/browserAccounts.js
 * Comptes mémorisés PAR navigateur via un cookie unique (browser_id).
 * Chaque PC/navigateur a sa propre liste — aucune fuite entre utilisateurs.
 */
const crypto = require('crypto');
const { pool } = require('./db');

const COOKIE_NAME = 'ts_browser_id';
const COOKIE_OPTS = {
  maxAge:   365 * 24 * 3600 * 1000, // 1 an
  httpOnly: true,
  sameSite: 'lax',
};

/**
 * Récupère ou crée le browser_id depuis le cookie.
 * Appeler en début de requête login.
 */
function getBrowserId(req, res) {
  let id = req.cookies?.[COOKIE_NAME];
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE_NAME, id, COOKIE_OPTS);
  }
  return id;
}

async function getAccounts(browserId) {
  try {
    const [rows] = await pool.execute(
      'SELECT email FROM browser_accounts WHERE browser_id = ? ORDER BY added_at DESC LIMIT 20',
      [browserId]
    );
    return rows.map(r => r.email);
  } catch (_) { return []; }
}

async function addAccount(browserId, email) {
  try {
    await pool.execute(
      'INSERT IGNORE INTO browser_accounts (browser_id, email) VALUES (?, ?)',
      [browserId, email]
    );
  } catch (_) {}
}

async function removeAccount(browserId, email) {
  try {
    await pool.execute(
      'DELETE FROM browser_accounts WHERE browser_id = ? AND email = ?',
      [browserId, email]
    );
  } catch (_) {}
}

module.exports = { getBrowserId, getAccounts, addAccount, removeAccount, COOKIE_NAME };
