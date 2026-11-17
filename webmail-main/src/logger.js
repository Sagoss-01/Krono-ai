/**
 * Logger — un dossier de logs par utilisateur connecté
 * logs/
 *   └── user_jean@netiify.cloud/
 *         ├── imap.log
 *         ├── smtp.log
 *         ├── auth.log
 *         └── app.log
 */
const fs   = require('fs');
const path = require('path');

const LOGS_ROOT = path.join(__dirname, '..', 'logs');

// Sanitise l'email pour en faire un nom de dossier
function emailToDir(email) {
  return email.replace(/[^a-zA-Z0-9@._-]/g, '_');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

/**
 * Écrit une ligne dans logs/<email>/<channel>.log
 * @param {string} email    - adresse email de l'utilisateur
 * @param {'imap'|'smtp'|'auth'|'app'} channel
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level
 * @param {string} message
 * @param {any} [extra]     - objet/données supplémentaires (sérialisé JSON)
 */
function log(email, channel, level, message, extra) {
  const userDir = path.join(LOGS_ROOT, emailToDir(email || 'anonymous'));
  ensureDir(userDir);

  let line = `[${timestamp()}] [${level}] ${message}`;
  if (extra !== undefined) {
    try { line += '  ' + JSON.stringify(extra); } catch (_) { line += '  [non-serializable]'; }
  }
  line += '\n';

  const logFile = path.join(userDir, `${channel}.log`);
  fs.appendFileSync(logFile, line, 'utf8');

  // Aussi en console (couleurs selon level)
  const colors = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', DEBUG: '\x1b[90m' };
  const reset  = '\x1b[0m';
  const col    = colors[level] || '';
  console.log(`${col}[${level}] [${email || 'anon'}/${channel}] ${message}${reset}`, extra !== undefined ? extra : '');
}

// Raccourcis par canal
const logger = {
  imap:  (email, level, msg, extra) => log(email, 'imap',  level, msg, extra),
  smtp:  (email, level, msg, extra) => log(email, 'smtp',  level, msg, extra),
  auth:  (email, level, msg, extra) => log(email, 'auth',  level, msg, extra),
  app:   (email, level, msg, extra) => log(email, 'app',   level, msg, extra),
};

module.exports = logger;
