const { pool } = require('./db');

// Best-effort : le suivi d'activité ne doit jamais faire échouer l'action
// réelle (login, reset, etc.) qu'il accompagne.
async function log(email, event, { ip, detail } = {}) {
  try {
    await pool.execute(
      'INSERT INTO activity_log (email, event, ip, detail) VALUES (?, ?, ?, ?)',
      [email || 'inconnu', event, ip || null, detail || null]
    );
  } catch (e) {
    console.error('[ActivityLog] Échec écriture:', e.message);
  }
}

async function getRecent(limit = 100) {
  const [rows] = await pool.execute(
    `SELECT email, event, ip, detail, created_at FROM activity_log ORDER BY created_at DESC LIMIT ${Number(limit) || 100}`
  );
  return rows;
}

// Historique personnel, visible par l'utilisateur lui-même (pas seulement
// par l'admin) — depuis Appareils > Historique. On ne montre que les
// événements pertinents pour "qu'est-il arrivé à MON compte", pas les
// événements d'administration globale.
const USER_VISIBLE_EVENTS = [
  'login_success', 'login_failed', 'login_blocked_device',
  'login_blocked_suspended', 'password_reset', '2fa_enabled', '2fa_disabled'
];

async function getRecentForEmail(email, limit = 30) {
  const placeholders = USER_VISIBLE_EVENTS.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT event, ip, detail, created_at FROM activity_log
     WHERE email = ? AND event IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT ${Number(limit) || 30}`,
    [email, ...USER_VISIBLE_EVENTS]
  );
  return rows;
}

// Vue "comptes" : dérivée du journal d'activité (dernière connexion réussie
// par email) — plus fiable que app_users, qui est incomplète (voir note
// technique : un compte ajouté via "Ajouter un compte" n'y figure jamais).
async function getAccountsOverview() {
  const [rows] = await pool.execute(`
    SELECT email,
           MAX(CASE WHEN event = 'login_success' THEN created_at END) AS last_login,
           SUM(CASE WHEN event = 'login_success' THEN 1 ELSE 0 END) AS login_count,
           SUM(CASE WHEN event = 'login_failed'  THEN 1 ELSE 0 END) AS failed_count
    FROM activity_log
    GROUP BY email
    ORDER BY last_login DESC
  `);
  return rows;
}

async function getStats() {
  const [[activity24h]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM activity_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`
  );
  const [[uniqueUsers]] = await pool.execute(
    `SELECT COUNT(DISTINCT email) AS cnt FROM activity_log WHERE event = 'login_success'`
  );
  const [[failedLogins24h]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM activity_log WHERE event = 'login_failed' AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`
  );
  return {
    activity24h: activity24h.cnt,
    uniqueUsers: uniqueUsers.cnt,
    failedLogins24h: failedLogins24h.cnt,
  };
}

async function countRecentFailures(email, sinceMinutes = 15) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM activity_log
     WHERE email = ? AND event = 'login_failed' AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [email, sinceMinutes]
  );
  return row.cnt;
}

module.exports = { log, getRecent, getRecentForEmail, getAccountsOverview, getStats, countRecentFailures };
