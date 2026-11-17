/**
 * src/services/signature.js
 * CRUD signature (header + footer) par email dans MySQL
 * Les colonnes TEXT sont NULL par défaut (pas de DEFAULT '' en strict mode)
 */
const { pool } = require('./db');

async function getSignature(email) {
  const [rows] = await pool.execute(
    'SELECT header_html, footer_html FROM user_signatures WHERE email = ?',
    [email]
  );
  if (!rows[0]) return { header_html: '', footer_html: '' };
  return {
    header_html: rows[0].header_html || '',
    footer_html: rows[0].footer_html || '',
  };
}

async function saveSignature(email, header_html, footer_html) {
  await pool.execute(`
    INSERT INTO user_signatures (email, header_html, footer_html)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      header_html = VALUES(header_html),
      footer_html = VALUES(footer_html)
  `, [email, header_html || null, footer_html || null]);
}

module.exports = { getSignature, saveSignature };
