const crypto = require('crypto');
const { pool } = require('./db');

const CODE_TTL_MINUTES = 15;
const RESEND_COOLDOWN_SECONDS = 60;

function generateCode() {
  // Code à 6 chiffres, jamais stocké en clair (voir hashCode)
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Renvoie le nombre de secondes à attendre avant de pouvoir redemander un
// code (anti-spam), ou 0 si c'est bon.
async function cooldownRemaining(email, purpose) {
  const [rows] = await pool.execute(
    `SELECT created_at FROM password_reset_codes
     WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  if (!rows.length) return 0;
  const elapsed = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
  return elapsed >= RESEND_COOLDOWN_SECONDS ? 0 : Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
}

async function createCode({ email, target, purpose }) {
  const wait = await cooldownRemaining(email, purpose);
  if (wait > 0) {
    const err = new Error(`Merci de patienter ${wait}s avant de redemander un code`);
    err.cooldown = wait;
    throw err;
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.execute(
    `INSERT INTO password_reset_codes (email, target, code_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [email, target, hashCode(code), purpose, expiresAt]
  );

  return code;
}

// Vérifie le code le plus récent (non utilisé, non expiré) pour cet email+purpose.
// Marque le code comme utilisé si valide. Retourne true/false.
async function verifyAndConsumeCode({ email, code, purpose }) {
  const [rows] = await pool.execute(
    `SELECT id, code_hash, expires_at, used_at FROM password_reset_codes
     WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  if (!rows.length) return false;

  const row = rows[0];
  if (row.used_at) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (hashCode(code) !== row.code_hash) return false;

  await pool.execute(`UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?`, [row.id]);
  return true;
}

module.exports = { createCode, verifyAndConsumeCode, cooldownRemaining, CODE_TTL_MINUTES };
