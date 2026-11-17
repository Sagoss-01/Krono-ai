const crypto = require('crypto');
const { pool } = require('./db');

const DOMAIN = 'netiify.cloud';

const RESERVED_LOCALPARTS = new Set([
  'admin', 'administrator', 'root', 'support', 'tech', 'contact', 'info',
  'postmaster', 'abuse', 'hostmaster', 'webmaster', 'mailer-daemon',
  'security', 'noreply', 'no-reply', 'smtp', 'imap', 'pop', 'pop3',
  'dmarc', 'dkim', 'spf', 'bounce', 'daemon'
]);

function cleanHumanName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function slugifyPart(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sanitizeLocalpart(value = '') {
  return slugifyPart(value).slice(0, 40);
}

function buildBaseLocalpart(firstName, lastName) {
  const first = slugifyPart(firstName);
  const last = slugifyPart(lastName);

  let base = `${first}${last}`.slice(0, 40);

  if (!base) {
    base = `user${Date.now().toString().slice(-6)}`;
  }

  if (RESERVED_LOCALPARTS.has(base)) {
    base = `${base}${Math.floor(100 + Math.random() * 900)}`;
  }

  return base.slice(0, 40);
}

function buildEmail(localpart) {
  return `${localpart}@${DOMAIN}`;
}

function assertProfile({ firstName, lastName, gender, birthDate, password }) {
  if (!cleanHumanName(lastName)) {
    throw new Error('Le nom est requis');
  }
  if (!cleanHumanName(firstName)) {
    throw new Error('Le prénom est requis');
  }
  if (!cleanHumanName(gender)) {
    throw new Error('Le genre est requis');
  }
  if (!birthDate) {
    throw new Error('La date de naissance est requise');
  }
  if (!password || String(password).length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères');
  }
}

async function localpartExists(localpart, conn = pool) {
  const email = buildEmail(localpart);
  const [rows] = await conn.execute(
    'SELECT 1 FROM app_users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows.length > 0;
}

async function emailExists(email, conn = pool) {
  const [rows] = await conn.execute(
    'SELECT 1 FROM app_users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows.length > 0;
}

async function findAvailableLocalpart({ firstName, lastName, preferredLocalpart }, conn = pool) {
  let requested = sanitizeLocalpart(preferredLocalpart || '');

  if (requested && RESERVED_LOCALPARTS.has(requested)) {
    requested = `${requested}${Math.floor(100 + Math.random() * 900)}`;
  }

  let base = requested || buildBaseLocalpart(firstName, lastName);

  if (!base) {
    base = buildBaseLocalpart(firstName, lastName);
  }

  if (!(await localpartExists(base, conn))) {
    return {
      localpart: base,
      email: buildEmail(base),
      generated: base !== requested
    };
  }

  for (let i = 0; i < 30; i += 1) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const candidate = `${base}${suffix}`.slice(0, 40);

    if (!RESERVED_LOCALPARTS.has(candidate) && !(await localpartExists(candidate, conn))) {
      return {
        localpart: candidate,
        email: buildEmail(candidate),
        generated: true
      };
    }
  }

  const fallback = `${base}${Date.now().toString().slice(-6)}`.slice(0, 40);

  return {
    localpart: fallback,
    email: buildEmail(fallback),
    generated: true
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

async function insertUser(conn, payload) {
  const {
    email,
    firstName,
    lastName,
    gender,
    birthDate,
    passwordHash
  } = payload;

  await conn.execute(
    `INSERT INTO app_users (
      email, first_name, last_name, gender, birth_date, password_hash
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      email,
      cleanHumanName(firstName),
      cleanHumanName(lastName),
      cleanHumanName(gender),
      birthDate,
      passwordHash
    ]
  );
}

async function getVerifiedRecoveryEmail(email, conn = pool) {
  const [rows] = await conn.execute(
    `SELECT recovery_email FROM app_users WHERE email = ? AND recovery_verified = 1 LIMIT 1`,
    [email]
  );
  return rows[0]?.recovery_email || null;
}

module.exports = {
  DOMAIN,
  cleanHumanName,
  sanitizeLocalpart,
  buildBaseLocalpart,
  buildEmail,
  assertProfile,
  localpartExists,
  emailExists,
  findAvailableLocalpart,
  hashPassword,
  insertUser,
  getVerifiedRecoveryEmail
};