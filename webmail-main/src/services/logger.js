/**
 * src/services/logger.js
 * - Logs par utilisateur dans logs/<email>/
 * - Fichier global logs/errors/errors.log pour toutes les erreurs
 */
const fs   = require('fs');
const path = require('path');

const LOGS_ROOT   = path.join(__dirname, '..', '..', 'logs');
const ERRORS_DIR  = path.join(LOGS_ROOT, 'errors');
const ERRORS_FILE = path.join(ERRORS_DIR, 'errors.log');

function sanitizeEmail(email) {
  return (email || 'anonymous').replace(/[^a-zA-Z0-9@._-]/g, '_');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function write(email, channel, level, message, extra) {
  const dir = path.join(LOGS_ROOT, sanitizeEmail(email));
  ensureDir(dir);

  const ts   = new Date().toISOString();
  let   line = `[${ts}] [${level}] ${message}`;
  if (extra !== undefined) {
    try { line += '  ' + JSON.stringify(extra); } catch (_) { line += '  [non-serializable]'; }
  }
  line += '\n';

  fs.appendFileSync(path.join(dir, `${channel}.log`), line, 'utf8');

  // Fichier global des erreurs
  if (level === 'ERROR') {
    ensureDir(ERRORS_DIR);
    const errLine = `[${ts}] [${email}/${channel}] ${message}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}\n`;
    fs.appendFileSync(ERRORS_FILE, errLine, 'utf8');
  }

  const colors = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', DEBUG: '\x1b[90m' };
  const col    = colors[level] || '';
  console.log(`${col}[${level}] [${email}/${channel}] ${message}\x1b[0m`, extra !== undefined ? extra : '');
}

const logger = {
  auth:  (email, level, msg, extra) => write(email, 'auth', level, msg, extra),
  imap:  (email, level, msg, extra) => write(email, 'imap', level, msg, extra),
  smtp:  (email, level, msg, extra) => write(email, 'smtp', level, msg, extra),
  app:   (email, level, msg, extra) => write(email, 'app',  level, msg, extra),
  error: (email, msg, extra)        => write(email, 'app',  'ERROR', msg, extra),
};

module.exports = logger;
