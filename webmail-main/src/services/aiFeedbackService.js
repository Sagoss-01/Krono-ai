/**
 * src/services/aiFeedbackService.js
 * Bouton « réponse ratée » : l'utilisateur signale un échange (sa demande + la réponse de l'IA) que
 * l'administrateur pourra relire pour améliorer les prompts. Le contenu est chiffré au repos,
 * limité à 20 signalements par jour et par personne, conservé 60 jours, effaçable (RGPD).
 */
const messageCrypto = require('./messageCrypto');
let dbPool = null;
const pool = () => { if (!dbPool) dbPool = require('./db').pool; return dbPool; };

const FEATURES = new Set(['assistant', 'whiteboard', 'mail_tools', 'meeting', 'meeting_chat', 'meeting_summary']);
const DAILY_LIMIT = 20;
const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);

async function add(user, { feature, prompt, response, note }) {
  const owner = String(user || '').toLowerCase().slice(0, 250);
  if (!owner) throw new Error('Non authentifié');
  if (!FEATURES.has(feature)) throw new Error('Fonctionnalité inconnue.');
  const p = pool();
  const [[row]] = await p.execute(`SELECT COUNT(*) AS n FROM ai_feedback WHERE user_key = ? AND ts >= DATE_SUB(NOW(), INTERVAL 1 DAY)`, [owner]);
  if (Number(row.n) >= DAILY_LIMIT) throw new Error('Limite de signalements atteinte pour aujourd\'hui. Merci !');
  await p.execute(
    `INSERT INTO ai_feedback (user_key, feature, prompt, response, note) VALUES (?, ?, ?, ?, ?)`,
    [owner, feature, messageCrypto.encryptContent(clip(prompt, 2000)), messageCrypto.encryptContent(clip(response, 6000)), clip(note, 500)]
  );
}

async function recent(limit = 50) {
  const n = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const [rows] = await pool().query(`SELECT id, DATE_FORMAT(ts, '%Y-%m-%dT%H:%i:%sZ') AS ts, user_key, feature, prompt, response, note FROM ai_feedback ORDER BY id DESC LIMIT ${n}`);
  const dec = (v) => { try { return messageCrypto.decryptContent(v) || ''; } catch (_) { return ''; } };
  return rows.map(r => ({ id: r.id, ts: r.ts, user: r.user_key, feature: r.feature, prompt: dec(r.prompt), response: dec(r.response), note: r.note }));
}

/** Format de cas rejouables par `scripts/eval-prompts.js`. */
async function asEvalCases(limit = 100) {
  return (await recent(limit)).filter(f => f.prompt).map(f => ({
    id: `feedback-${f.id}`, feature: f.feature, prompt: f.prompt, expect: {}, note: f.note || 'signalé par un utilisateur',
  }));
}

async function deleteForUser(user) { await pool().execute(`DELETE FROM ai_feedback WHERE user_key = ?`, [String(user).toLowerCase()]); }

module.exports = { add, recent, asEvalCases, deleteForUser, FEATURES, DAILY_LIMIT };
