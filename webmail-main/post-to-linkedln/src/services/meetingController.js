/**
 * src/controllers/meetingController.js
 */
const meetingService = require('../services/meeting');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

// GET /meeting/:id  — page de la salle
async function showRoom(req, res) {
  const email   = activeEmail(req);
  if (!email) return res.redirect('/login');
  const meeting = await meetingService.getMeeting(req.params.id);
  if (!meeting) return res.status(404).send('Réunion introuvable');

  // Vérification accès emails
  if (meeting.access === 'emails') {
    const allowed = (meeting.allowed_emails || '').split(',').map(e => e.trim());
    if (!allowed.includes(email) && meeting.host !== email) {
      return res.status(403).render('pages/meeting-denied', { title: 'Accès refusé' });
    }
  }

  res.render('pages/meeting-room', {
    title: meeting.title + ' — TechSphere Meet',
    meeting,
    userEmail: email,
    csrfToken: req.session.csrfToken || '',
  });
}

// GET /meet/:id — rejoindre sans auth (lien public), redirect vers login si besoin
async function joinByLink(req, res) {
  if (!req.session.accounts?.length) {
    return res.redirect(`/login?redirect=/meeting/${req.params.id}`);
  }
  return res.redirect(`/meeting/${req.params.id}`);
}

// POST /api/meetings — créer une réunion
async function createMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });

  const { title, access, allowedEmails, scheduledAt, instant } = req.body;
  try {
    const { id, code } = await meetingService.createMeeting({
      host: email, title, access,
      allowedEmails: allowedEmails ? allowedEmails.split(/[,;\n]/) : [],
      scheduledAt: scheduledAt || null,
      instant: !!instant,
    });
    const link = `${req.protocol}://${req.get('host')}/meeting/${id}`;
    res.json({ ok: true, id, code, link });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// GET /api/meetings — mes réunions
async function getMyMeetings(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    const meetings = await meetingService.getMyMeetings(email);
    res.json({ ok: true, meetings });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/meetings/:id/start
async function startMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    await meetingService.startMeeting(req.params.id, email);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/meetings/:id/end
async function endMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    await meetingService.endMeeting(req.params.id, email);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/meetings/join-by-code
async function joinByCode(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });
  const { code } = req.body;
  if (!code) return res.json({ ok: false, error: 'Code manquant' });
  try {
    const [rows] = require('../services/db').pool.execute
      ? await require('../services/db').pool.execute(
          `SELECT id FROM meetings WHERE code=? AND status!='ended'`, [code.trim()])
      : [[]];
    if (!rows.length) return res.json({ ok: false, error: 'Code invalide ou réunion terminée' });
    res.json({ ok: true, id: rows[0].id });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

module.exports = { showRoom, joinByLink, createMeeting, getMyMeetings, startMeeting, endMeeting, joinByCode };
