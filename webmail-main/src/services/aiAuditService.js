/**
 * src/services/aiAuditService.js
 * Journal d'audit des actions effectuées via l'assistant IA (qui a envoyé, créé ou supprimé quoi).
 * - Les actions de cartes sont signalées par le navigateur APRÈS la réussite de l'opération réelle ;
 *   les lectures de messagerie par l'IA sont journalisées côté serveur (certaines).
 * - Ne lève jamais : l'audit ne doit pas bloquer l'action. Conservé 180 jours.
 */
let dbPool = null;
const pool = () => { if (dbPool) return dbPool; try { dbPool = require('./db').pool; } catch (_) { /* tests */ } return dbPool; };

const ACTIONS = new Set([
  'email_sent', 'email_scheduled', 'email_schedule_cancelled', 'event_created', 'event_updated', 'event_deleted',
  'contact_created', 'meeting_created', 'mailbox_read', 'admin_setting', 'ai_data_deleted',
]);

const LABELS = {
  email_sent: 'E-mail envoyé', email_scheduled: 'E-mail programmé', email_schedule_cancelled: 'Envoi programmé annulé',
  event_created: 'Événement créé', event_updated: 'Événement modifié', event_deleted: 'Événement supprimé',
  contact_created: 'Contact ajouté', meeting_created: 'Réunion créée', mailbox_read: 'Messagerie consultée par l\'IA',
  admin_setting: 'Réglage administrateur', ai_data_deleted: 'Données IA supprimées',
};

/** Enregistre une action (sans attendre le résultat). */
function log(user, action, detail = '') {
  if (!ACTIONS.has(action)) return;
  const p = pool();
  if (!p) return;
  p.execute(`INSERT INTO ai_audit (user_key, action, detail) VALUES (?, ?, ?)`, [String(user || 'inconnu').toLowerCase().slice(0, 250), action, String(detail).replace(/[\u0000-\u001f]/g, ' ').slice(0, 500)])
    .catch((e) => console.warn('[AI audit]', e.message));
}

async function recent(limit = 100, user = '') {
  const p = pool();
  if (!p) return [];
  const n = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const [rows] = user
    ? await p.query(`SELECT DATE_FORMAT(ts, '%Y-%m-%dT%H:%i:%sZ') AS ts, user_key, action, detail FROM ai_audit WHERE user_key = ? ORDER BY id DESC LIMIT ${n}`, [user])
    : await p.query(`SELECT DATE_FORMAT(ts, '%Y-%m-%dT%H:%i:%sZ') AS ts, user_key, action, detail FROM ai_audit ORDER BY id DESC LIMIT ${n}`);
  return rows.map(r => ({ ts: r.ts, user: r.user_key, action: r.action, label: LABELS[r.action] || r.action, detail: r.detail }));
}

module.exports = { log, recent, ACTIONS, LABELS };
