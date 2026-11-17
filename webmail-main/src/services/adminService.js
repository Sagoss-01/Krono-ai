const { promisify } = require('util');
const { execFile } = require('child_process');
const { pool } = require('./db');

const execFileAsync = promisify(execFile);

// ── Droits admin (table BDD — jamais de liste en .env) ──────────────────────
async function isAdmin(email) {
  if (!email) return false;
  const [rows] = await pool.execute('SELECT 1 FROM admins WHERE email = ? LIMIT 1', [email.toLowerCase()]);
  return rows.length > 0;
}

async function listAdmins() {
  const [rows] = await pool.execute('SELECT email, added_by, created_at FROM admins ORDER BY created_at ASC');
  return rows;
}

async function addAdmin(email, addedBy) {
  await pool.execute('INSERT IGNORE INTO admins (email, added_by) VALUES (?, ?)', [email.toLowerCase(), addedBy]);
}

async function removeAdmin(email) {
  const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM admins');
  if (cnt <= 1) {
    const err = new Error('Impossible de retirer le dernier administrateur restant');
    err.code = 'LAST_ADMIN';
    throw err;
  }
  await pool.execute('DELETE FROM admins WHERE email = ?', [email.toLowerCase()]);
}

// ── Statut de compte (suspension) ────────────────────────────────────────────
async function getAccountStatus(email) {
  const [rows] = await pool.execute('SELECT status, reason FROM account_status WHERE email = ?', [email.toLowerCase()]);
  return rows[0] || { status: 'active', reason: null };
}

async function suspendAccount(email, reason, changedBy) {
  await pool.execute(
    `INSERT INTO account_status (email, status, reason, changed_by)
     VALUES (?, 'suspended', ?, ?)
     ON DUPLICATE KEY UPDATE status='suspended', reason=VALUES(reason), changed_by=VALUES(changed_by), changed_at=NOW()`,
    [email.toLowerCase(), reason || null, changedBy]
  );
}

async function unsuspendAccount(email, changedBy) {
  await pool.execute(
    `INSERT INTO account_status (email, status, reason, changed_by)
     VALUES (?, 'active', NULL, ?)
     ON DUPLICATE KEY UPDATE status='active', reason=NULL, changed_by=VALUES(changed_by), changed_at=NOW()`,
    [email.toLowerCase(), changedBy]
  );
}

// ── Suppression réelle de la boîte mail (script serveur, comme create/set-password) ──
async function deleteMailbox(email) {
  try {
    await execFileAsync('sudo', ['/usr/local/bin/delete-mailbox', '--email', email], { timeout: 40000 });
    return true;
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    throw new Error('Échec de la suppression de la boîte mail : ' + detail);
  }
}

async function purgeAccountRecords(email) {
  const e = email.toLowerCase();
  await pool.execute('DELETE FROM admins WHERE email = ?', [e]);
  await pool.execute('DELETE FROM account_status WHERE email = ?', [e]);
  await pool.execute('DELETE FROM contacts WHERE owner_email = ?', [e]);
  await pool.execute('DELETE FROM calendar_events WHERE owner_email = ?', [e]);
  await pool.execute('DELETE FROM user_2fa WHERE email = ?', [e]);
  await pool.execute('DELETE FROM user_2fa_backup_codes WHERE email = ?', [e]);
}

module.exports = {
  isAdmin, listAdmins, addAdmin, removeAdmin,
  getAccountStatus, suspendAccount, unsuspendAccount,
  deleteMailbox, purgeAccountRecords,
};
