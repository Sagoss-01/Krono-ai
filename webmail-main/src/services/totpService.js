const crypto = require('crypto');
const otplib = require('otplib');
const qrcode = require('qrcode');
const { pool } = require('./db');

const ISSUER = 'TechSphere Webmail';

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateBackupCodes(count = 8) {
  // Codes lisibles à la main type "XXXX-XXXX", jamais stockés en clair
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5, 10));
  }
  return codes;
}

async function getStatus(email) {
  const [rows] = await pool.execute('SELECT enabled FROM user_2fa WHERE email = ?', [email]);
  return { enabled: !!(rows[0]?.enabled) };
}

// Démarre une configuration : génère un secret (pas encore activé tant que
// l'utilisateur n'a pas confirmé avec un code valide) + le QR code + les
// codes de secours (générés maintenant, montrés une seule fois).
async function startSetup(email) {
  const secret = await otplib.generateSecret();
  const uri = otplib.generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await qrcode.toDataURL(uri);

  // On stocke le secret en attente (enabled=0) — confirmé par enableWithCode()
  await pool.execute(
    `INSERT INTO user_2fa (email, totp_secret, enabled) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE totp_secret = VALUES(totp_secret), enabled = 0`,
    [email, secret]
  );

  const backupCodes = generateBackupCodes();
  await pool.execute('DELETE FROM user_2fa_backup_codes WHERE email = ?', [email]);
  for (const code of backupCodes) {
    await pool.execute('INSERT INTO user_2fa_backup_codes (email, code_hash) VALUES (?, ?)', [email, hashCode(code)]);
  }

  return { secret, qrDataUrl, backupCodes };
}

// Confirme l'activation avec un code TOTP valide (empêche d'activer par erreur / sans avoir vraiment scanné)
async function confirmEnable(email, token) {
  const [rows] = await pool.execute('SELECT totp_secret FROM user_2fa WHERE email = ?', [email]);
  const secret = rows[0]?.totp_secret;
  if (!secret) return false;

  const result = await otplib.verify({ token: String(token).trim(), secret });
  if (!result?.valid) return false;

  await pool.execute('UPDATE user_2fa SET enabled = 1 WHERE email = ?', [email]);
  return true;
}

async function disable(email) {
  await pool.execute('UPDATE user_2fa SET enabled = 0, totp_secret = NULL WHERE email = ?', [email]);
  await pool.execute('DELETE FROM user_2fa_backup_codes WHERE email = ?', [email]);
}

// Vérifie un code lors du login (TOTP normal OU un code de secours à usage unique)
async function verifyLoginCode(email, token) {
  const [rows] = await pool.execute('SELECT totp_secret, enabled FROM user_2fa WHERE email = ?', [email]);
  const row = rows[0];
  if (!row || !row.enabled || !row.totp_secret) return false;

  const clean = String(token).trim();

  // 1. Code TOTP à 6 chiffres
  if (/^\d{6}$/.test(clean)) {
    const result = await otplib.verify({ token: clean, secret: row.totp_secret });
    if (result?.valid) return true;
  }

  // 2. Code de secours (format XXXXX-XXXXX), à usage unique
  const [codes] = await pool.execute(
    'SELECT id, code_hash FROM user_2fa_backup_codes WHERE email = ? AND used_at IS NULL',
    [email]
  );
  const match = codes.find(c => c.code_hash === hashCode(clean.toUpperCase()));
  if (match) {
    await pool.execute('UPDATE user_2fa_backup_codes SET used_at = NOW() WHERE id = ?', [match.id]);
    return true;
  }

  return false;
}

module.exports = { getStatus, startSetup, confirmEnable, disable, verifyLoginCode };
