/**
 * src/services/accountStore.js
 * Persiste la liste des emails connus (sans mots de passe) sur disque.
 * Au login, on pré-remplit la page login avec les comptes déjà vus.
 */
const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'data', 'known_accounts.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (_) { return []; }
}

function save(emails) {
  try {
    ensureDir();
    // Dédoublonnage, max 50
    const unique = [...new Set(emails)].slice(0, 50);
    fs.writeFileSync(STORE_PATH, JSON.stringify(unique, null, 2), 'utf8');
  } catch (_) {}
}

function addEmail(email) {
  const list = load();
  if (!list.includes(email)) {
    list.unshift(email); // plus récent en premier
    save(list);
  }
}

function removeEmail(email) {
  const list = load().filter(e => e !== email);
  save(list);
}

module.exports = { load, addEmail, removeEmail };
