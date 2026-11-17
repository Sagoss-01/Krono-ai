/**
 * src/services/aiChatService.js
 * Persistance des conversations de l'assistant IA du webmail (MySQL).
 * Le texte des messages et les cartes sont chiffrés au repos (AES-256-GCM, même clé que le chat).
 */
const crypto = require('crypto');
const { pool } = require('./db');
const messageCrypto = require('./messageCrypto');

const MAX_TITLE = 60;
const HISTORY_FOR_MODEL = 16;     // nombre de derniers messages renvoyés à l'IA
const MAX_CONVERSATIONS = 100;    // par utilisateur (les plus anciennes sont supprimées)

const enc = (v) => messageCrypto.encryptContent(v);
const dec = (v) => (v == null ? null : messageCrypto.decryptContent(v));

function makeTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Nouvelle conversation';
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1) + '…' : t;
}

async function listConversations(owner) {
  const [rows] = await pool.execute(
    `SELECT id, title, updated_at FROM ai_conversations WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ${MAX_CONVERSATIONS}`,
    [owner]
  );
  return rows.map(r => ({ id: r.id, title: dec(r.title) || 'Conversation', updatedAt: r.updated_at }));
}

async function getConversation(owner, id) {
  const [rows] = await pool.execute(
    `SELECT id, title FROM ai_conversations WHERE id = ? AND owner_email = ?`, [id, owner]
  );
  return rows[0] ? { id: rows[0].id, title: dec(rows[0].title) } : null;
}

async function createConversation(owner, firstMessage) {
  const id = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO ai_conversations (id, owner_email, title) VALUES (?, ?, ?)`,
    [id, owner, enc(makeTitle(firstMessage))]
  );
  // Limite par utilisateur : on supprime les plus anciennes au-delà du plafond
  await pool.execute(
    `DELETE FROM ai_conversations WHERE owner_email = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM ai_conversations WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ${MAX_CONVERSATIONS}) t
     )`,
    [owner, owner]
  );
  return { id, title: makeTitle(firstMessage) };
}

async function renameConversation(owner, id, title) {
  const [r] = await pool.execute(
    `UPDATE ai_conversations SET title = ? WHERE id = ? AND owner_email = ?`,
    [enc(makeTitle(title)), id, owner]
  );
  return r.affectedRows > 0;
}

async function deleteConversation(owner, id) {
  const [r] = await pool.execute(`DELETE FROM ai_conversations WHERE id = ? AND owner_email = ?`, [id, owner]);
  return r.affectedRows > 0;
}

async function addMessage(conversationId, role, content, cards) {
  const [r] = await pool.execute(
    `INSERT INTO ai_messages (conversation_id, role, content, cards) VALUES (?, ?, ?, ?)`,
    [conversationId, role, enc(String(content ?? '')), cards && cards.length ? enc(JSON.stringify(cards)) : null]
  );
  await pool.execute(`UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?`, [conversationId]);
  return r.insertId;
}

function parseCards(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(dec(raw)); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

async function getMessages(owner, conversationId, limit = 200) {
  const [rows] = await pool.execute(
    `SELECT m.id, m.role, m.content, m.cards, m.created_at
       FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ? AND c.owner_email = ?
      ORDER BY m.id ASC LIMIT ${Number(limit) | 0}`,
    [conversationId, owner]
  );
  return rows.map(r => ({
    id: r.id, role: r.role, content: dec(r.content) || '', cards: parseCards(r.cards), createdAt: r.created_at,
  }));
}

/** Derniers messages au format attendu par le modèle (texte seul, sans les cartes). */
async function getHistoryForModel(owner, conversationId) {
  const all = await getMessages(owner, conversationId, 200);
  return all.slice(-HISTORY_FOR_MODEL).map(m => ({ role: m.role, content: m.content }));
}

/** Met à jour l'état d'une carte (envoyé, programmé, créé, ignoré…) pour que l'historique le reflète. */
async function setCardState(owner, messageId, cardId, patch) {
  const [rows] = await pool.execute(
    `SELECT m.id, m.cards FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND c.owner_email = ?`,
    [messageId, owner]
  );
  if (!rows[0]) return null;
  const cards = parseCards(rows[0].cards);
  const card = cards.find(c => c.id === cardId);
  if (!card) return null;
  Object.assign(card, patch);
  await pool.execute(`UPDATE ai_messages SET cards = ? WHERE id = ?`, [enc(JSON.stringify(cards)), messageId]);
  return card;
}

/**
 * Supprime les conversations plus anciennes que la durée de conservation choisie par chaque utilisateur
 * (réglage « conservation » des préférences ; AI_DEFAULT_RETENTION_DAYS pour ceux qui n'ont rien choisi).
 * @returns {Promise<number>} nombre de conversations supprimées
 */
async function purgeExpired(defaultDays = 0) {
  const [r] = await pool.execute(
    `DELETE c FROM ai_conversations c
       LEFT JOIN ai_preferences p ON p.owner_email = c.owner_email
      WHERE COALESCE(p.retention_days, ?) > 0
        AND c.updated_at < DATE_SUB(NOW(), INTERVAL COALESCE(p.retention_days, ?) DAY)`,
    [defaultDays, defaultDays]
  );
  return r.affectedRows || 0;
}

/** RGPD : tout ce qui appartient à l'utilisateur. */
async function exportAll(owner) {
  const convs = await listConversations(owner);
  const out = [];
  for (const c of convs) out.push({ ...c, messages: await getMessages(owner, c.id, 1000) });
  return out;
}

async function deleteAll(owner) {
  await pool.execute(`DELETE FROM ai_conversations WHERE owner_email = ?`, [owner]);
}

module.exports = {
  listConversations, getConversation, createConversation, renameConversation, deleteConversation,
  addMessage, getMessages, getHistoryForModel, setCardState, purgeExpired, exportAll, deleteAll,
};
