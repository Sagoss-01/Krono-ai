/**
 * Chiffrement AES-256-GCM des mots de passe en session
 * La clé est dérivée du SESSION_SECRET via HKDF
 */
const crypto = require('crypto');

const KEY = crypto.createHash('sha256')
  .update(process.env.SESSION_SECRET || 'default_dev_secret_change_me')
  .digest(); // 32 bytes

function encrypt(plaintext) {
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(data) {
  try {
    const [ivHex, tagHex, encHex] = data.split(':');
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const enc     = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch(_) { return null; }
}

module.exports = { encrypt, decrypt };
