const { promisify } = require('util');
const { execFile } = require('child_process');
const crypto = require('crypto');

const { pool } = require('../services/db');
const logger = require('../services/logger');
const userService = require('../services/userService');
const imapService = require('../services/imap');
const recoveryService = require('../services/recoveryService');
const recoveryMailService = require('../services/recoveryMailService');
const activityLog = require('../services/activityLogService');

const execFileAsync = promisify(execFile);

function getActiveEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email || null;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// Applique le nouveau mot de passe sur la vraie boîte mail (Dovecot/Postfix),
// via le script fourni par l'admin serveur. L'authentification de l'app se
// fait par IMAP direct (voir authController.doLogin) — donc c'est CE mot de
// passe-là qui compte réellement, pas app_users.password_hash.
async function runSetMailboxPassword({ email, password }) {
  try {
    await execFileAsync('sudo', [
      '/usr/local/bin/set-mailbox-password',
      '--email', email,
      '--password', password,
    ], { timeout: 40000 });
    return true;
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    logger.auth(email, 'ERROR', 'Échec set-mailbox-password', { message: detail });
    throw new Error('Impossible de changer le mot de passe de la boîte mail : ' + detail);
  }
}

// ─── GET /api/account/recovery-email ─────────────────────────────────────────
async function getRecoveryStatus(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  try {
    const [rows] = await pool.execute(
      'SELECT recovery_email, recovery_verified FROM app_users WHERE email = ? LIMIT 1',
      [email]
    );
    const row = rows[0] || {};
    res.json({
      ok: true,
      recoveryEmail: row.recovery_email || null,
      verified: !!row.recovery_verified,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

// ─── POST /api/account/recovery-email/link ───────────────────────────────────
async function linkRecoveryEmail(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const recoveryEmail = String(req.body?.recoveryEmail || '').trim().toLowerCase();

  if (!isValidEmail(recoveryEmail)) {
    return res.json({ ok: false, error: 'Adresse email de secours invalide' });
  }
  if (recoveryEmail === email.toLowerCase()) {
    return res.json({ ok: false, error: 'L\'email de secours doit être différent de votre adresse principale' });
  }

  try {
    const code = await recoveryService.createCode({ email, target: recoveryEmail, purpose: 'link_recovery' });

    await pool.execute(
      'UPDATE app_users SET recovery_email = ?, recovery_verified = 0 WHERE email = ?',
      [recoveryEmail, email]
    );

    await recoveryMailService.sendRecoveryLinkCode({ to: recoveryEmail, code, accountEmail: email });

    logger.auth(email, 'INFO', 'Email de secours: code envoyé', { recoveryEmail });
    res.json({ ok: true, message: 'Code envoyé à ' + recoveryEmail });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

// ─── POST /api/account/recovery-email/confirm ────────────────────────────────
async function confirmRecoveryEmail(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const code = String(req.body?.code || '').trim();
  if (!code) return res.json({ ok: false, error: 'Code requis' });

  try {
    const valid = await recoveryService.verifyAndConsumeCode({ email, code, purpose: 'link_recovery' });
    if (!valid) return res.json({ ok: false, error: 'Code invalide ou expiré' });

    await pool.execute('UPDATE app_users SET recovery_verified = 1 WHERE email = ?', [email]);
    logger.auth(email, 'INFO', 'Email de secours confirmé');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

// ─── POST /api/auth/forgot-password (public) ─────────────────────────────────
async function forgotPassword(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.json({ ok: false, error: 'Adresse email invalide' });
  }

  // Message générique dans tous les cas pour ne pas révéler si le compte existe.
  const genericOk = { ok: true, message: 'Si ce compte a un email de secours confirmé, un code vient de lui être envoyé.' };

  try {
    const [rows] = await pool.execute(
      'SELECT recovery_email, recovery_verified FROM app_users WHERE email = ? LIMIT 1',
      [email]
    );
    const row = rows[0];
    if (!row || !row.recovery_verified || !row.recovery_email) {
      return res.json(genericOk);
    }

    const code = await recoveryService.createCode({ email, target: row.recovery_email, purpose: 'reset_password' });
    await recoveryMailService.sendPasswordResetCode({ to: row.recovery_email, code, accountEmail: email });
    logger.auth(email, 'INFO', 'Code de reset envoyé à l\'email de secours');
    res.json(genericOk);
  } catch (e) {
    // Le cooldown anti-spam doit remonter clairement (sinon message générique)
    if (e.cooldown) return res.json({ ok: false, error: e.message });
    logger.auth(email, 'ERROR', 'Échec forgot-password', { message: e.message });
    res.json(genericOk);
  }
}

// ─── POST /api/auth/reset-password (public) ──────────────────────────────────
async function resetPassword(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const { newPassword, confirmPassword } = req.body || {};

  if (!isValidEmail(email) || !code) {
    return res.json({ ok: false, error: 'Requête invalide' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.json({ ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }
  if (newPassword !== confirmPassword) {
    return res.json({ ok: false, error: 'Les mots de passe ne correspondent pas' });
  }

  try {
    const valid = await recoveryService.verifyAndConsumeCode({ email, code, purpose: 'reset_password' });
    if (!valid) return res.json({ ok: false, error: 'Code invalide ou expiré' });

    // 1. Vraie boîte mail (Dovecot/Postfix) — c'est elle qui sert au login (IMAP direct)
    await runSetMailboxPassword({ email, password: newPassword });

    // 2. app_users.password_hash — tenu à jour par cohérence (non utilisé pour le login actuel)
    try {
      const passwordHash = userService.hashPassword(newPassword);
      await pool.execute('UPDATE app_users SET password_hash = ? WHERE email = ?', [passwordHash, email]);
    } catch (e) {
      logger.auth(email, 'WARN', 'password_hash non mis à jour', { message: e.message });
    }

    logger.auth(email, 'INFO', 'Mot de passe réinitialisé via email de secours');
    activityLog.log(email, 'password_reset', { ip: req.ip });
    res.json({ ok: true, message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
  } catch (e) {
    logger.auth(email, 'ERROR', 'Échec reset-password', { message: e.message });
    res.json({ ok: false, error: e.message });
  }
}

// ─── POST /api/account/change-password (utilisateur connecté) ───────────────
async function changePassword(req, res) {
  const email = getActiveEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  if (!currentPassword) {
    return res.json({ ok: false, error: 'Mot de passe actuel requis' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.json({ ok: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
  }
  if (newPassword !== confirmPassword) {
    return res.json({ ok: false, error: 'Les mots de passe ne correspondent pas' });
  }
  if (newPassword === currentPassword) {
    return res.json({ ok: false, error: 'Le nouveau mot de passe doit être différent de l\'actuel' });
  }

  try {
    // On vérifie le mot de passe actuel par une vraie connexion IMAP (comme au login) —
    // pas par app_users.password_hash, qui n'est pas la source de vérité de l'auth.
    await imapService.testConnection({ email, password: currentPassword });
  } catch (e) {
    logger.auth(email, 'WARN', 'Changement mot de passe refusé : mot de passe actuel incorrect');
    return res.json({ ok: false, error: 'Mot de passe actuel incorrect' });
  }

  try {
    await runSetMailboxPassword({ email, password: newPassword });

    try {
      const passwordHash = userService.hashPassword(newPassword);
      await pool.execute('UPDATE app_users SET password_hash = ? WHERE email = ?', [passwordHash, email]);
    } catch (e) {
      logger.auth(email, 'WARN', 'password_hash non mis à jour', { message: e.message });
    }

    logger.auth(email, 'INFO', 'Mot de passe changé depuis les Paramètres');
    res.json({ ok: true, message: 'Mot de passe modifié avec succès' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}

module.exports = {
  getRecoveryStatus,
  linkRecoveryEmail,
  confirmRecoveryEmail,
  forgotPassword,
  resetPassword,
  changePassword,
};
