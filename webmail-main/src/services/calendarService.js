const crypto = require('crypto');
const { pool } = require('./db');
const meetingService = require('./meeting');

// MySQL DATETIME attend 'YYYY-MM-DD HH:MM:SS' — pas le format ISO ('...T...Z')
// que le navigateur envoie. C'est exactement ce qui causait l'erreur
// "Incorrect datetime value" à la création d'événement.
function toMysqlDatetime(value) {
  const d = new Date(value);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function toIcsDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Génère un fichier .ics standard (RFC 5545) — compatible Gmail, Outlook, Apple
// Calendar. C'est ce fichier qui sert d'invitation par email : le client mail
// du destinataire propose nativement Accepter/Refuser, sans UI custom à coder.
function buildIcs({ uid, title, description, location, startAt, endAt, allDay, organizerEmail, attendeeEmails, method }) {
  const now = toIcsDate(new Date());
  const dtStart = allDay
    ? new Date(startAt).toISOString().slice(0, 10).replace(/-/g, '')
    : toIcsDate(startAt);
  const dtEnd = allDay
    ? new Date(endAt).toISOString().slice(0, 10).replace(/-/g, '')
    : toIcsDate(endAt);
  const dateLine = allDay ? `;VALUE=DATE` : '';

  const attendeeLines = (attendeeEmails || [])
    .map(email => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`)
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TechSphere Webmail//Calendrier//FR',
    `METHOD:${method || 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART${dateLine}:${dtStart}`,
    `DTEND${dateLine}:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    location ? `LOCATION:${escapeIcsText(location)}` : '',
    `ORGANIZER:mailto:${organizerEmail}`,
    attendeeLines,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

async function listRange(ownerEmail, startRange, endRange) {
  const [rows] = await pool.execute(
    `SELECT e.*,
       (SELECT GROUP_CONCAT(email) FROM calendar_event_attendees WHERE event_id = e.id) AS attendee_emails
     FROM calendar_events e
     WHERE e.owner_email = ? AND e.start_at < ? AND e.end_at > ?
     ORDER BY e.start_at ASC`,
    [ownerEmail, toMysqlDatetime(endRange), toMysqlDatetime(startRange)]
  );
  return rows.map(r => ({ ...r, attendee_emails: r.attendee_emails ? r.attendee_emails.split(',') : [] }));
}

// Domaines réellement hébergés par ce serveur mail — n'importe quelle adresse
// sur l'un de ces domaines correspond à une vraie boîte mail potentiellement
// utilisable sur la plateforme (l'authentification se fait par IMAP direct,
// PAS via la table app_users qui est incomplète : un compte ajouté via
// "Ajouter un compte" n'y est jamais inséré, par exemple).
const PLATFORM_DOMAINS = (process.env.PLATFORM_DOMAINS || 'netiify.cloud,kweapp.com')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

function isPlatformEmail(email) {
  const domain = String(email).split('@')[1]?.toLowerCase();
  return !!domain && PLATFORM_DOMAINS.includes(domain);
}

// Si un invité a une adresse sur un domaine hébergé par la plateforme, on lui
// copie directement l'événement dans SON calendrier (pas seulement un email
// .ics) — vraie synchronisation, pas juste une invitation externe.
async function syncEventToPlatformUsers({ sourceEventId, title, description, location, startAt, endAt, allDay, meetingId, attendeeEmails, organizerEmail }) {
  if (!attendeeEmails || !attendeeEmails.length) return;

  const platformEmails = attendeeEmails.filter(isPlatformEmail);
  if (!platformEmails.length) return;

  for (const ownerEmail of platformEmails) {
    if (ownerEmail.toLowerCase() === organizerEmail.toLowerCase()) continue; // déjà son propre événement
    try {
      const [result] = await pool.execute(
        `INSERT INTO calendar_events (owner_email, title, description, location, start_at, end_at, all_day, meeting_id, reminder_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10)`,
        [ownerEmail, title, description || null, location || null, toMysqlDatetime(startAt), toMysqlDatetime(endAt), allDay ? 1 : 0, meetingId || null]
      );
      // On note l'organisateur comme "invité" sur la copie de l'invité, pour affichage
      await pool.execute(`INSERT IGNORE INTO calendar_event_attendees (event_id, email, status) VALUES (?, ?, 'accepted')`, [result.insertId, organizerEmail]);
      console.log(`[Calendrier] Événement "${title}" copié dans le calendrier de ${ownerEmail}`);
    } catch (e) {
      console.error('[Calendrier] Échec synchro vers', ownerEmail, ':', e.message);
    }
  }
}

async function getById(ownerEmail, id) {
  const [rows] = await pool.execute(`SELECT * FROM calendar_events WHERE id = ? AND owner_email = ?`, [id, ownerEmail]);
  if (!rows.length) return null;
  const [attendees] = await pool.execute(`SELECT email, status FROM calendar_event_attendees WHERE event_id = ?`, [id]);
  return { ...rows[0], attendees };
}

// isMeeting=true => crée aussi une vraie réunion programmée (table meetings, via meetingService)
// et lie meeting_id à l'événement, pour réutiliser le moteur de réunion existant tel quel.
async function createEvent(ownerEmail, { title, description, location, startAt, endAt, allDay, reminderMinutes, attendeeEmails, isMeeting, allowGuests }) {
  let meetingId = null;
  let meetingLink = null;

  if (isMeeting) {
    const { id } = await meetingService.createMeeting({
      host: ownerEmail,
      title,
      access: 'link',
      allowedEmails: attendeeEmails || [],
      guestEmails: [],
      scheduledAt: startAt,
      customCode: null,
      allowGuests: !!allowGuests,
      instant: false,
    });
    meetingId = id;
  }

  const [result] = await pool.execute(
    `INSERT INTO calendar_events (owner_email, title, description, location, start_at, end_at, all_day, meeting_id, reminder_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ownerEmail, title, description || null, location || null, toMysqlDatetime(startAt), toMysqlDatetime(endAt), allDay ? 1 : 0, meetingId, reminderMinutes ?? 10]
  );
  const eventId = result.insertId;

  for (const email of (attendeeEmails || [])) {
    await pool.execute(
      `INSERT IGNORE INTO calendar_event_attendees (event_id, email) VALUES (?, ?)`,
      [eventId, email]
    );
  }

  return { eventId, meetingId };
}

// Crée directement une entrée calendrier liée à une réunion déjà existante
// (utilisé quand une réunion est programmée depuis la sidebar "Réunion Web",
// pas depuis le calendrier lui-même — pour que les deux restent toujours en
// phase sans jamais créer une réunion en double).
async function linkMeetingToCalendar(ownerEmail, { meetingId, title, startAt, durationMinutes, attendeeEmails }) {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + (durationMinutes || 60) * 60000);

  const [result] = await pool.execute(
    `INSERT INTO calendar_events (owner_email, title, start_at, end_at, all_day, meeting_id, reminder_minutes)
     VALUES (?, ?, ?, ?, 0, ?, 10)`,
    [ownerEmail, title, toMysqlDatetime(start), toMysqlDatetime(end), meetingId]
  );
  const eventId = result.insertId;

  for (const email of (attendeeEmails || [])) {
    await pool.execute(`INSERT IGNORE INTO calendar_event_attendees (event_id, email) VALUES (?, ?)`, [eventId, email]);
  }

  return eventId;
}

async function updateEvent(ownerEmail, id, { title, description, location, startAt, endAt, allDay, reminderMinutes }) {
  const [result] = await pool.execute(
    `UPDATE calendar_events SET title=?, description=?, location=?, start_at=?, end_at=?, all_day=?, reminder_minutes=?
     WHERE id=? AND owner_email=?`,
    [title, description || null, location || null, toMysqlDatetime(startAt), toMysqlDatetime(endAt), allDay ? 1 : 0, reminderMinutes ?? 10, id, ownerEmail]
  );
  return result.affectedRows > 0;
}

async function removeEvent(ownerEmail, id) {
  const [result] = await pool.execute(`DELETE FROM calendar_events WHERE id = ? AND owner_email = ?`, [id, ownerEmail]);
  return result.affectedRows > 0;
}

// Événements dont le rappel doit partir maintenant (utilisé par le worker de rappels)
async function findDueReminders(windowStartIso, windowEndIso) {
  const [rows] = await pool.execute(
    `SELECT e.*,
       (SELECT GROUP_CONCAT(email) FROM calendar_event_attendees WHERE event_id = e.id) AS attendee_emails
     FROM calendar_events e
     WHERE e.reminder_minutes IS NOT NULL
       AND e.reminder_sent_at IS NULL
       AND DATE_SUB(e.start_at, INTERVAL e.reminder_minutes MINUTE) BETWEEN ? AND ?`,
    [toMysqlDatetime(windowStartIso), toMysqlDatetime(windowEndIso)]
  );
  return rows.map(r => ({ ...r, attendee_emails: r.attendee_emails ? r.attendee_emails.split(',') : [] }));
}

async function markReminderSent(eventId) {
  await pool.execute(`UPDATE calendar_events SET reminder_sent_at = NOW() WHERE id = ?`, [eventId]);
}

module.exports = { buildIcs, listRange, getById, createEvent, updateEvent, removeEvent, findDueReminders, markReminderSent, linkMeetingToCalendar, syncEventToPlatformUsers };
