const { pool }  = require('./db');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');

// Dossier racine des uploads chat : public/uploads/chat/
const CHAT_UPLOADS = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function roomId(a, b) { return [a, b].sort().join('::'); }

// Sanitize nom de fichier (sécurité)
function safeFilename(name) {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._\-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 200);
}

// Sauvegarde d'un fichier sur disque, retourne le chemin relatif public
function saveFileToDisk(room, originalName, buffer) {
  // Nom de dossier = room hashé pour éviter les :: dans les chemins
  const roomDir = crypto.createHash('md5').update(room).digest('hex');
  const dir = path.join(CHAT_UPLOADS, roomDir);
  ensureDir(dir);

  // Nom unique : timestamp + aléatoire + nom original sanitisé
  const unique   = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const safeName = safeFilename(originalName);
  const filename = `${unique}_${safeName}`;
  const fullPath = path.join(dir, filename);

  fs.writeFileSync(fullPath, buffer);

  // Chemin relatif servi en statique : /uploads/chat/<roomDir>/<filename>
  return `/uploads/chat/${roomDir}/${filename}`;
}

// Suppression d'un fichier disque (pour purge ou suppression de message)
function deleteFileFromDisk(mediaPath) {
  if (!mediaPath) return;
  try {
    const abs = path.join(__dirname, '..', '..', 'public', mediaPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch(e) { /* ignore */ }
}

// ── Conversations ───────────────────────────────────

async function touchConversation(room, senderEmail, peerEmail, lastMsg) {
  const snippet = (lastMsg || '').slice(0, 100);
  await pool.execute(`
    INSERT INTO chat_conversations (email, peer_email, room, last_msg, last_at, unread_count)
    VALUES (?, ?, ?, ?, NOW(), 0)
    ON DUPLICATE KEY UPDATE last_msg=VALUES(last_msg), last_at=NOW()
  `, [senderEmail, peerEmail, room, snippet]);
  await pool.execute(`
    INSERT INTO chat_conversations (email, peer_email, room, last_msg, last_at, unread_count)
    VALUES (?, ?, ?, ?, NOW(), 1)
    ON DUPLICATE KEY UPDATE last_msg=VALUES(last_msg), last_at=NOW(), unread_count=unread_count+1
  `, [peerEmail, senderEmail, room, snippet]);
}

async function markRead(email, peerEmail) {
  await pool.execute(
    'UPDATE chat_conversations SET unread_count=0 WHERE email=? AND peer_email=?',
    [email, peerEmail]
  );
}

async function getConversations(email) {
  const [rows] = await pool.execute(`
    SELECT peer_email, room, last_msg, last_at, unread_count
    FROM chat_conversations
    WHERE email = ?
    ORDER BY last_at DESC
    LIMIT 50
  `, [email]);
  return rows;
}

// ── Messages ────────────────────────────────────────

async function saveMessage({ room, sender, peer, content, mediaType, mediaName, mediaMime, mediaSize, mediaBuffer }) {
  let mediaPath = null;

  // Sauvegarder le fichier sur disque si présent
  if (mediaBuffer && mediaType !== 'text') {
    mediaPath = saveFileToDisk(room, mediaName, mediaBuffer);
  }

  const [result] = await pool.execute(`
    INSERT INTO chat_messages (room, sender, content, media_type, media_name, media_mime, media_size, media_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    room,
    sender,
    content   || null,
    mediaType || 'text',
    mediaName || null,
    mediaMime || null,
    mediaSize ? parseInt(mediaSize) : null,
    mediaPath,
  ]);

  const displayText = mediaType === 'text' ? content : (mediaName || 'Fichier');
  await touchConversation(room, sender, peer, displayText);

  return { id: result.insertId, mediaPath };
}

async function getHistory(room, limit) {
  const safeLimit = parseInt(limit || 80);
  // mysql2 prepared statements ont un bug avec LIMIT ? — on l'injecte directement (entier validé)
  const [rows] = await pool.execute(`
    SELECT id, sender, content, media_type, media_name, media_mime, media_size,
           media_path,
           CASE WHEN media_path IS NOT NULL AND deleted_at IS NULL THEN 1 ELSE 0 END AS has_media,
           deleted_at,
           created_at
    FROM chat_messages
    WHERE room = ?
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `, [room]);

  const msgs = rows.reverse();

  // Charger les réactions pour ces messages
  if (msgs.length > 0) {
    const ids = msgs.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const [reacts] = await pool.execute(
      `SELECT msg_id, emoji, sender FROM chat_reactions WHERE msg_id IN (${placeholders})`,
      ids
    );
    const reactMap = {};
    reacts.forEach(r => {
      if (!reactMap[r.msg_id]) reactMap[r.msg_id] = {};
      if (!reactMap[r.msg_id][r.emoji]) reactMap[r.msg_id][r.emoji] = [];
      reactMap[r.msg_id][r.emoji].push(r.sender);
    });
    msgs.forEach(m => {
      m.reactions = reactMap[m.id] || {};
      if (m.deleted_at) { m.content = null; m.media_path = null; m.has_media = 0; }
    });
  }

  return msgs;
}

// Purge des fichiers disque des messages expirés (appelé depuis db.js)
async function purgeOldFiles() {
  const [rows] = await pool.execute(
    `SELECT media_path FROM chat_messages
     WHERE created_at < DATE_SUB(NOW(), INTERVAL 6 MONTH)
     AND media_path IS NOT NULL`
  );
  rows.forEach(r => deleteFileFromDisk(r.media_path));
}

// ── Réactions ────────────────────────────────────────
async function addReaction(msgId, sender, emoji) {
  await pool.execute(
    'INSERT IGNORE INTO chat_reactions (msg_id, sender, emoji) VALUES (?, ?, ?)',
    [parseInt(msgId), sender, emoji]
  );
  return getReactions(parseInt(msgId));
}

async function removeReaction(msgId, sender, emoji) {
  await pool.execute(
    'DELETE FROM chat_reactions WHERE msg_id=? AND sender=? AND emoji=?',
    [parseInt(msgId), sender, emoji]
  );
  return getReactions(parseInt(msgId));
}

async function getReactions(msgId) {
  const [rows] = await pool.execute(
    'SELECT emoji, sender FROM chat_reactions WHERE msg_id=?',
    [parseInt(msgId)]
  );
  // Grouper par emoji : { "👍": ["a@b.com", "c@d.com"], ... }
  const grouped = {};
  rows.forEach(r => {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r.sender);
  });
  return grouped;
}

// ── Suppression (soft delete) ─────────────────────────────────────────────
async function deleteMessage(msgId, senderEmail) {
  const [rows] = await pool.execute(
    'SELECT sender, media_path FROM chat_messages WHERE id=? AND deleted_at IS NULL',
    [parseInt(msgId)]
  );
  if (!rows[0] || rows[0].sender !== senderEmail) {
    throw new Error('Message introuvable ou non autorisé');
  }
  if (rows[0].media_path) deleteFileFromDisk(rows[0].media_path);
  await pool.execute(
    'UPDATE chat_messages SET deleted_at=NOW(), content=NULL, media_path=NULL WHERE id=?',
    [parseInt(msgId)]
  );
}

// ── Statut lu ─────────────────────────────────────────────────────────────
async function markMessageRead(msgId, readerEmail) {
  await pool.execute(
    'INSERT IGNORE INTO chat_msg_status (msg_id, reader) VALUES (?, ?)',
    [parseInt(msgId), readerEmail]
  );
}

module.exports = {
  roomId, saveMessage, getHistory,
  getConversations, markRead,
  addReaction, removeReaction, getReactions,
  deleteMessage, markMessageRead,
  purgeOldFiles, deleteFileFromDisk,
};
