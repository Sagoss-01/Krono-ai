const imapService = require('../services/imap');
const smtpService = require('../services/smtp');
const logger      = require('../services/logger');
const adminService = require('../services/adminService');
const { decrypt } = require('../middlewares/encrypt');

function getActiveCredentials(req) {
  const activeEmail = req.session.activeAccount || req.session.accounts?.[0]?.email;
  const account     = req.session.accounts?.find(a => a.email === activeEmail);
  if (!account) return null;
  const pwd = account.password;
  // Supporte les sessions existantes (mot de passe en clair) et nouvelles (chiffrées)
  const password = pwd && pwd.includes(':') ? (decrypt(pwd) || pwd) : pwd;
  return { email: account.email, password };
}

// GET /mail
async function showMail(req, res) {
  const accounts      = req.session.accounts || [];
  const activeAccount = req.session.activeAccount || accounts[0]?.email;
  const isAdmin        = await adminService.isAdmin(activeAccount);
  res.render('pages/mail', {
    title: 'TechSphere Webmail',
    accounts: accounts.map(a => a.email),
    activeAccount,
    isAdmin,
    csrfToken: req.session.csrfToken || '',
  });
}

// GET /api/folders
async function getFolders(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });
  try {
    const folders = await imapService.getFolders(creds);
    res.json({ ok: true, folders });
  } catch (err) { res.json({ ok: false, error: err.message }); }
}

// GET /api/emails
async function getEmails(req, res) {
  const creds  = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });
  const folder = req.query.folder || 'INBOX';
  const limit  = parseInt(req.query.limit) || 80;
  try {
    const emails = await imapService.fetchEmails(creds, folder, limit);
    res.json({ ok: true, emails });
  } catch (err) {
    logger.imap(creds.email, 'ERROR', `getEmails: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
}

// GET /api/email/:uid
async function getEmailBody(req, res) {
  const creds  = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });
  const folder = req.query.folder || 'INBOX';
  const uid    = parseInt(req.params.uid);
  try {
    const email = await imapService.fetchEmailBody(creds, uid, folder);
    res.json({ ok: true, email });
  } catch (err) { res.json({ ok: false, error: err.message }); }
}

// DELETE /api/email/:uid
async function deleteEmail(req, res) {
  const creds  = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });
  const folder = req.query.folder || 'INBOX';
  const uid    = parseInt(req.params.uid);
  try {
    await imapService.deleteEmail(creds, uid, folder);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
}

// POST /api/send — multipart/form-data via multer
async function sendEmail(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });

  const { to, cc, bcc, subject, body, dsr, inReplyTo, references } = req.body;
  if (!to || !subject || !body) return res.json({ ok: false, error: 'Champs obligatoires manquants' });

  try {
    await smtpService.sendEmail(creds, { to, cc, bcc, subject, body, attachments: req.files || [], dsr: dsr === '1', inReplyTo, references });
    res.json({ ok: true });
  } catch (err) {
    logger.smtp(creds.email, 'ERROR', `sendEmail: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
}

// GET /api/attachment/:uid/:idx
async function downloadAttachment(req, res) {
  const creds  = getActiveCredentials(req);
  if (!creds) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  const folder = req.query.folder || 'INBOX';
  const uid    = parseInt(req.params.uid);
  const idx    = parseInt(req.params.idx);
  try {
    const email = await imapService.fetchEmailBody(creds, uid, folder);
    const att   = email.attachments && email.attachments[idx];
    if (!att) return res.status(404).json({ ok: false, error: 'Pièce jointe introuvable' });
    const filename = att.filename || `attachment_${idx}`;
    const ct       = att.contentType || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', att.content.length);
    res.send(att.content);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}

// GET /api/quota
async function getQuota(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Aucun compte actif' });
  try {
    const quota = await imapService.getQuota(creds);
    res.json({ ok: true, quota });
  } catch (err) {
    res.json({ ok: false, quota: null, error: err.message });
  }
}



// POST /api/email/:uid/mark
async function markEmail(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const uid    = parseInt(req.params.uid);
  const folder = req.query.folder || 'INBOX';
  const { read } = req.body; // true = marquer lu, false = non lu
  try {
    await imapService.setFlag(creds, uid, folder, '\\Seen', read !== false);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/email/:uid/star
async function starEmail(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const uid    = parseInt(req.params.uid);
  const folder = req.query.folder || 'INBOX';
  const { starred } = req.body;
  try {
    await imapService.setFlag(creds, uid, folder, '\\Flagged', starred !== false);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// exports moved to end

// POST /api/email/:uid/move
async function moveEmail(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const uid        = parseInt(req.params.uid);
  const fromFolder = req.query.folder || 'INBOX';
  const { toFolder } = req.body;
  if (!toFolder) return res.json({ ok: false, error: 'Dossier cible manquant' });
  try {
    await imapService.moveEmail(creds, uid, fromFolder, toFolder);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/draft
async function saveDraft(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const { to, cc, bcc, subject, body, messageId } = req.body;
  try {
    const result = await imapService.saveDraft(creds, { to, cc, bcc, subject, body, messageId });
    res.json(result);
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// GET /api/search
async function searchEmails(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const { folder, from, subject, since, before, unread, starred, hasAttachment } = req.query;
  try {
    const emails = await imapService.searchEmails(creds, folder || 'INBOX', {
      from, subject, since, before,
      unread: unread === '1',
      starred: starred === '1',
      hasAttachment: hasAttachment === '1',
    });
    res.json({ ok: true, emails });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/email/:uid/spam
async function markSpam(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const uid    = parseInt(req.params.uid);
  const folder = req.query.folder || 'INBOX';
  try {
    // Essayer Junk puis INBOX.Junk
    const junkFolder = 'Junk';
    await imapService.moveEmail(creds, uid, folder, junkFolder).catch(() =>
      imapService.moveEmail(creds, uid, folder, 'INBOX.Junk')
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/schedule  — programmation d'envoi
async function scheduleEmail(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.json({ ok: false, error: 'Non authentifié' });
  const { to, cc, bcc, subject, body, sendAt, inReplyTo, references } = req.body;
  if (!to || !subject || !body) return res.json({ ok: false, error: 'Champs obligatoires manquants' });
  if (!sendAt) return res.json({ ok: false, error: 'Date d\'envoi manquante' });
  const delay = new Date(sendAt) - Date.now();
  if (isNaN(delay) || delay < 0) return res.json({ ok: false, error: 'Date dans le passé' });
  if (delay > 30 * 24 * 3600 * 1000) return res.json({ ok: false, error: 'Max 30 jours' });

  // Copie dans « Brouillons » (facultatif : l'envoi programmé ne doit pas échouer si la messagerie répond mal)
  let messageId = null;
  try { messageId = (await imapService.saveDraft(creds, { to, cc, bcc, subject, body })).messageId; }
  catch (e) { logger.smtp(creds.email, 'WARN', `Brouillon non enregistré pour l'envoi programmé : ${e.message}`); }

  const scheduled = require('../services/scheduledEmailService');
  const messageCrypto = require('../services/messageCrypto');

  // Mode persistant : survit aux redémarrages (nécessite la clé de chiffrement du serveur)
  if (messageCrypto.isConfigured) {
    try {
      const id = await scheduled.create({ owner: creds.email, creds, mail: { to, cc, bcc, subject, body, inReplyTo, references }, files: req.files || [], sendAt });
      logger.smtp(creds.email, 'INFO', `Envoi programmé #${id} pour ${sendAt}`);
      return res.json({ ok: true, sendAt, messageId, scheduleId: id, persistent: true });
    } catch (e) {
      if (e instanceof scheduled.ScheduleError) return res.json({ ok: false, error: e.message });
      logger.smtp(creds.email, 'ERROR', `Programmation impossible : ${e.message}`);
      return res.json({ ok: false, error: "La programmation a échoué. Réessayez." });
    }
  }

  // Repli (clé de chiffrement absente) : ancien mode en mémoire, perdu au redémarrage du serveur
  const smtpService = require('../services/smtp');
  const attachments = req.files || [];
  setTimeout(async () => {
    try {
      await smtpService.sendEmail(creds, { to, cc, bcc, subject, body, attachments, inReplyTo, references });
      logger.smtp(creds.email, 'INFO', `Email programmé envoyé à ${sendAt}`);
    } catch (e) {
      logger.smtp(creds.email, 'ERROR', `Échec envoi programmé: ${e.message}`);
    }
  }, delay);
  res.json({ ok: true, sendAt, messageId, persistent: false });
}

// GET /api/schedule — envois programmés en attente du compte actif
async function listScheduled(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.status(401).json({ ok: false });
  try { res.json({ ok: true, scheduled: await require('../services/scheduledEmailService').listPending(creds.email) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
}

// DELETE /api/schedule/:id — annule un envoi programmé (et efface son contenu du serveur)
async function cancelScheduled(req, res) {
  const creds = getActiveCredentials(req);
  if (!creds) return res.status(401).json({ ok: false });
  try {
    const ok = await require('../services/scheduledEmailService').cancel(creds.email, Number(req.params.id));
    if (ok) require('../services/aiAuditService').log(creds.email, 'email_schedule_cancelled', `#${Number(req.params.id)}`);
    res.json(ok ? { ok: true } : { ok: false, error: 'Envoi introuvable ou déjà parti.' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// ── Retourner tous les exports ────────────────────────────────────────────────
module.exports = { showMail, getFolders, getEmails, getEmailBody, deleteEmail, sendEmail, downloadAttachment, getQuota, markEmail, starEmail, moveEmail, saveDraft, searchEmails, markSpam, scheduleEmail, listScheduled, cancelScheduled, downloadEml, getActiveCredentials };

// GET /api/email/:uid/eml — telecharger l'email brut
async function downloadEml(req, res) {
  const creds  = getActiveCredentials(req);
  if (!creds) return res.status(401).json({ ok: false });
  const uid    = parseInt(req.params.uid);
  const folder = req.query.folder || 'INBOX';
  try {
    const email = await imapService.fetchEmailBody(creds, uid, folder);
    const subj  = (email.subject || 'email').replace(/[^a-z0-9]/gi, '_').slice(0, 60);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', 'attachment; filename="' + subj + '.eml"');
    const CRLF = '\r\n';
    const lines = [
      'From: ' + (email.from || ''),
      'To: '   + (email.to   || ''),
      email.cc ? 'Cc: ' + email.cc : null,
      'Subject: ' + (email.subject || ''),
      'Date: ' + (email.date ? new Date(email.date).toUTCString() : ''),
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      email.html || email.text || '',
    ].filter(function(l) { return l !== null; });
    res.send(lines.join(CRLF));
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
}


