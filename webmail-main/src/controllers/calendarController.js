const crypto = require('crypto');
const calendarService = require('../services/calendarService');
const calendarMailService = require('../services/calendarMailService');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

// GET /api/calendar/events?start=ISO&end=ISO
async function list(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const start = req.query.start || new Date(Date.now() - 30 * 86400000).toISOString();
  const end = req.query.end || new Date(Date.now() + 60 * 86400000).toISOString();

  try {
    const events = await calendarService.listRange(email, start, end);
    res.json({ ok: true, events });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/calendar/events
async function create(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const { title, description, location, startAt, endAt, allDay, reminderMinutes, attendees, isMeeting, allowGuests } = req.body || {};
  if (!title || !startAt || !endAt) return res.json({ ok: false, error: 'Titre, date de début et de fin requis' });
  if (new Date(endAt) < new Date(startAt)) return res.json({ ok: false, error: 'La date de fin doit être après le début' });

  const attendeeEmails = [...new Set(
    (attendees || '').split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean)
  )];

  try {
    const { eventId, meetingId } = await calendarService.createEvent(email, {
      title, description, location, startAt, endAt, allDay,
      reminderMinutes, attendeeEmails, isMeeting: !!isMeeting, allowGuests,
    });

    const meetingLink = meetingId ? `${req.protocol}://${req.get('host')}/meeting/${meetingId}` : null;

    // Invitations par email (best-effort — un échec d'envoi ne doit pas annuler la création)
    let sent = [], failed = [];
    if (attendeeEmails.length) {
      const ics = calendarService.buildIcs({
        uid: `event-${eventId}@techsphere-webmail`,
        title, description, location, startAt, endAt, allDay,
        organizerEmail: email, attendeeEmails, method: 'REQUEST',
      });
      for (const to of attendeeEmails) {
        try {
          await calendarMailService.sendEventInvite({ to, organizerEmail: email, title, startAt, location, icsContent: ics, isMeeting: !!isMeeting, meetingLink });
          sent.push(to);
        } catch (e) {
          failed.push(to);
          console.error('[Calendrier] Échec envoi invitation à', to, ':', e.message);
        }
      }
      console.log(`[Calendrier] Événement #${eventId} "${title}" : invitations envoyées à [${sent.join(', ')}]${failed.length ? ' — ÉCHEC pour [' + failed.join(', ') + ']' : ''}`);

      // Copie directe dans le calendrier des invités dont l'adresse est sur un domaine hébergé par la plateforme
      try {
        await calendarService.syncEventToPlatformUsers({
          sourceEventId: eventId, title, description, location, startAt, endAt, allDay,
          meetingId, attendeeEmails, organizerEmail: email,
        });
      } catch (e) {
        console.error('[Calendrier] Échec synchro multi-comptes :', e.message);
      }
    }

    res.json({ ok: true, eventId, meetingId, meetingLink, invitesSent: sent, invitesFailed: failed });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// PUT /api/calendar/events/:id
async function update(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

  const { title, description, location, startAt, endAt, allDay, reminderMinutes } = req.body || {};
  if (!title || !startAt || !endAt) return res.json({ ok: false, error: 'Titre, date de début et de fin requis' });

  try {
    const ok = await calendarService.updateEvent(email, req.params.id, { title, description, location, startAt, endAt, allDay, reminderMinutes });
    res.json({ ok });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// DELETE /api/calendar/events/:id
async function remove(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  try {
    const ok = await calendarService.removeEvent(email, req.params.id);
    res.json({ ok });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// GET /api/calendar/events/:id/ics — téléchargement direct du fichier .ics
async function exportIcs(req, res) {
  const email = activeEmail(req);
  if (!email) return res.status(401).send('Non authentifié');

  try {
    const event = await calendarService.getById(email, req.params.id);
    if (!event) return res.status(404).send('Événement introuvable');

    const ics = calendarService.buildIcs({
      uid: `event-${event.id}@techsphere-webmail`,
      title: event.title, description: event.description, location: event.location,
      startAt: event.start_at, endAt: event.end_at, allDay: !!event.all_day,
      organizerEmail: email, attendeeEmails: event.attendees.map(a => a.email), method: 'PUBLISH',
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evenement-${event.id}.ics"`);
    res.send(ics);
  } catch (e) { res.status(500).send('Erreur export : ' + e.message); }
}

module.exports = { list, create, update, remove, exportIcs };
