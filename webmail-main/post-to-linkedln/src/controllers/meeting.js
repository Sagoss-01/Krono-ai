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

async function createMeeting({ host, title, access, allowedEmails, scheduledAt, instant }) {
  const id   = genId();
  const code = (access === 'code') ? genCode() : null;
  const status = instant ? 'live' : 'scheduled';
  const startedAt = instant ? new Date() : null;
  const emailsStr = (access === 'emails' && allowedEmails)
    ? allowedEmails.map(e => e.trim().toLowerCase()).filter(Boolean).join(',')
    : null;

  await pool.execute(
    `INSERT INTO meetings (id, title, host, access, code, allowed_emails, scheduled_at, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title || 'Réunion', host, access || 'link',
     code, emailsStr, scheduledAt || null, startedAt, status]
  );
  return { id, code };
}

async function getMeeting(id) {
  const [rows] = await pool.execute('SELECT * FROM meetings WHERE id = ?', [id]);
  return rows[0] || null;
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

module.exports = { createMeeting, getMeeting, getMyMeetings, startMeeting, endMeeting, joinMeeting, leaveMeeting, canJoin, genId };
