/**
 * src/services/meeting.js
 * Gestion des réunions WebRTC
 */
const { pool } = require('./db');

// Générer un ID court lisible (ex: "abc-def-ghi")
function genId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) id += '-';
    else id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id; // ex: "xk7m-pq3n-wr5t"
}

// Générer un code numérique à 6 chiffres
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// MySQL DATETIME attend 'YYYY-MM-DD HH:MM:SS' — pas le format ISO ('...T...Z')
// envoyé par le navigateur / Date.toISOString().
function toMysqlDatetime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function createMeeting({ host, title, access, allowedEmails, guestEmails, scheduledAt, instant, customCode, allowGuests }) {
  const id = genId();
  let code = null;
  if (access === 'code') {
    code = (customCode && customCode.trim()) ? customCode.trim() : genCode();
  }
  const status      = instant ? 'live' : 'scheduled';
  const startedAt   = instant ? toMysqlDatetime(new Date()) : null;
  const emailsStr   = (access === 'emails' && allowedEmails)
    ? allowedEmails.map(e => e.trim().toLowerCase()).filter(Boolean).join(',')
    : null;
  const allowGuestsVal = allowGuests ? 1 : 0;

  await pool.execute(
    `INSERT INTO meetings (id, title, host, access, code, allowed_emails, allow_guests, scheduled_at, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title || 'Réunion', host, access || 'link',
     code, emailsStr, allowGuestsVal, toMysqlDatetime(scheduledAt), startedAt, status]
  );
  return { id, code };
}

// Vérifier si un code est correct pour une réunion
async function verifyCode(meetingId, code) {
  const [rows] = await pool.execute(
    `SELECT id FROM meetings WHERE id=? AND code=? AND status!='ended'`,
    [meetingId, code.trim()]
  );
  return rows.length > 0;
}

async function getAllMeetings(email) {
  const [rows] = await pool.execute(
    `SELECT * FROM meetings WHERE host = ? ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 50`,
    [email]
  );
  return rows;
}

async function getMeeting(id) {
  const [rows] = await pool.execute('SELECT * FROM meetings WHERE id = ?', [id]);
  return rows[0] || null;
}

// Crée une salle de sous-groupe : une réunion normale (même moteur mediasoup),
// juste rattachée à une réunion parente + live immédiatement (les participants
// y sont envoyés directement, pas de salle d'attente pour un sous-groupe).
async function createBreakoutRoom({ parentMeetingId, host, label }) {
  const id = genId();
  await pool.execute(
    `INSERT INTO meetings (id, title, host, access, allow_guests, parent_meeting_id, breakout_label, started_at, status)
     VALUES (?, ?, ?, 'link', 1, ?, ?, NOW(), 'live')`,
    [id, label || 'Sous-groupe', host, parentMeetingId, label || null]
  );
  return { id };
}

async function getBreakoutRooms(parentMeetingId) {
  const [rows] = await pool.execute(
    `SELECT * FROM meetings WHERE parent_meeting_id = ? AND status != 'ended' ORDER BY created_at ASC`,
    [parentMeetingId]
  );
  return rows;
}

async function closeBreakoutRoom(id) {
  await pool.execute(`UPDATE meetings SET status='ended', ended_at=NOW() WHERE id=?`, [id]);
}

async function getMyMeetings(email) {
  const [rows] = await pool.execute(
    `SELECT * FROM meetings WHERE host = ? AND status != 'ended' ORDER BY COALESCE(scheduled_at, created_at) ASC`,
    [email]
  );
  return rows;
}

async function startMeeting(id, host) {
  await pool.execute(
    `UPDATE meetings SET status='live', started_at=NOW() WHERE id=? AND host=?`,
    [id, host]
  );
}

async function endMeeting(id, host) {
  await pool.execute(
    `UPDATE meetings SET status='ended', ended_at=NOW() WHERE id=? AND host=?`,
    [id, host]
  );
}

async function joinMeeting(id, email) {
  await pool.execute(
    `INSERT INTO meeting_participants (meeting_id, email) VALUES (?,?)
     ON DUPLICATE KEY UPDATE joined_at=NOW(), left_at=NULL`,
    [id, email]
  );
}

async function leaveMeeting(id, email) {
  await pool.execute(
    `UPDATE meeting_participants SET left_at=NOW() WHERE meeting_id=? AND email=?`,
    [id, email]
  );
}

// ── Rapport de présence ──────────────────────────────────────────────────
async function getAttendance(id) {
  const [rows] = await pool.execute(
    `SELECT email, joined_at, left_at,
            TIMESTAMPDIFF(SECOND, joined_at, COALESCE(left_at, NOW())) AS duration_seconds
     FROM meeting_participants
     WHERE meeting_id = ?
     ORDER BY joined_at ASC`,
    [id]
  );
  return rows;
}

async function canJoin(meeting, email) {
  if (!meeting) return false;
  if (meeting.status === 'ended') return false;
  if (meeting.host === email) return true;
  if (meeting.access === 'link') return true;
  if (meeting.access === 'code') return true; // code vérifié côté route
  if (meeting.access === 'emails') {
    const allowed = (meeting.allowed_emails || '').split(',').map(e => e.trim());
    return allowed.includes(email.toLowerCase());
  }
  return false;
}

// Sauvegarder un avis sur une réunion
async function saveReview(meetingId, email, rating, comment) {
  await pool.execute(
    `INSERT INTO meeting_reviews (meeting_id, email, rating, comment)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating=VALUES(rating), comment=VALUES(comment), created_at=NOW()`,
    [meetingId, email, rating, comment || null]
  );
}

// Récupérer les avis d'une réunion (pour l'hôte)
async function getReviews(meetingId) {
  const [rows] = await pool.execute(
    'SELECT * FROM meeting_reviews WHERE meeting_id=? ORDER BY created_at DESC',
    [meetingId]
  );
  return rows;
}

module.exports = { createMeeting, getMeeting, getMyMeetings, getAllMeetings, startMeeting, endMeeting, joinMeeting, leaveMeeting, canJoin, verifyCode, saveReview, getReviews, genId, startPurgeScheduler, createBreakoutRoom, getBreakoutRooms, closeBreakoutRoom, getAttendance };

// ─── Purge automatique des réunions expirées ──────────────────────────────────
// - Réunion programmée dont la date dépasse d'1 jour → annulée (ended)
// - Réunion live depuis plus de 24h → terminée automatiquement
function startPurgeScheduler() {
  async function purge() {
    try {
      // Annuler les réunions programmées dont scheduled_at est dépassé de plus d'1 jour
      const [r1] = await pool.execute(
        `UPDATE meetings
         SET status='ended', ended_at=NOW()
         WHERE status='scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`
      );
      if (r1.affectedRows > 0) console.log(`Purge: ${r1.affectedRows} réunion(s) programmée(s) expirée(s) annulée(s)`);

      // Terminer les réunions live depuis plus de 24h (hôte a oublié)
      const [r2] = await pool.execute(
        `UPDATE meetings
         SET status='ended', ended_at=NOW()
         WHERE status='live'
           AND started_at IS NOT NULL
           AND started_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      );
      if (r2.affectedRows > 0) console.log(`Purge: ${r2.affectedRows} réunion(s) live trop longues terminées`);
    } catch(e) {
      console.error('Purge réunions:', e.message);
    }
  }

  // Lancer immédiatement puis toutes les heures
  purge();
  setInterval(purge, 60 * 60 * 1000);
}
