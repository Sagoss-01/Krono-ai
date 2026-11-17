const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');


const authCtrl = require('./controllers/authController');
const mailCtrl = require('./controllers/mailController');
const sigCtrl = require('./controllers/signatureController');
const chatCtrl = require('./controllers/chatController');
const meetCtrl = require('./controllers/meetingController');
const recoveryCtrl = require('./controllers/recoveryController');
const contactsCtrl = require('./controllers/contactsController');
const calendarCtrl = require('./controllers/calendarController');
const twoFactorCtrl = require('./controllers/twoFactorController');
const adminCtrl = require('./controllers/adminController');
const deviceCtrl = require('./controllers/deviceController');
const quickConnectCtrl = require('./controllers/quickConnectController');
const gdprCtrl = require('./controllers/gdprController');
const aiCtrl = require('./controllers/aiController');
const aiAdminCtrl = require('./controllers/aiAdminController');
const { requireAdmin } = require('./middlewares/admin');
const { codeVerifyLimiter, requestCodeLimiter, uploadLimiter, aiLimiter } = require('./middlewares/apiRateLimiter');
const meetingService = require('./services/meeting');

const { requireAuth } = require('./middlewares/auth');
const { loginLimiter } = require('./middlewares/rateLimiter');
const { csrfMiddleware } = require('./middlewares/csrf');

const uploadMail = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});

const meetUpload = multer({
  storage: meetCtrl.chatUploadStorage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});

function handleMeetingChatUpload(req, res, next) {
  meetUpload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          ok: false,
          error: 'Fichier trop volumineux (max 15 Mo)',
          code: err.code
        });
      }

      return res.status(400).json({
        ok: false,
        error: `Upload refusé: ${err.message}`,
        code: err.code
      });
    }

    return res.status(400).json({
      ok: false,
      error: err.message || "Erreur lors de l'upload du fichier"
    });
  });
}

router.use(csrfMiddleware);

router.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'TechSphere Webmail'
  });
});

router.get('/login', authCtrl.showLogin);
router.post('/login', loginLimiter, authCtrl.doLogin);
router.post('/login/2fa', loginLimiter, codeVerifyLimiter, authCtrl.verifyLogin2FA);

router.get('/register', authCtrl.showRegister);
router.post('/api/register/suggest-email', authCtrl.suggestRegisterEmail);
router.post('/api/register', authCtrl.doRegister);

router.post('/logout', authCtrl.doLogout);

// ── Appareils connectés ──────────────────────────────────────────────────
router.get('/devices', requireAuth, (req, res) => res.redirect('/mail?openDevices=1'));
router.get('/api/devices', requireAuth, deviceCtrl.list);
router.post('/api/devices/:id/revoke', requireAuth, deviceCtrl.revoke);
router.post('/api/devices/:id/block', requireAuth, deviceCtrl.block);
router.post('/api/devices/:id/trust', requireAuth, deviceCtrl.trust);
router.get('/api/account/login-history', requireAuth, deviceCtrl.loginHistory);

// ── RGPD ─────────────────────────────────────────────────────────────────
router.get('/api/account/export', requireAuth, gdprCtrl.exportData);
router.post('/api/account/delete', requireAuth, gdprCtrl.deleteAccount);
router.get('/account/devices/block-via-email', deviceCtrl.blockViaEmailLink);

// ── Connexion rapide (QR) ─────────────────────────────────────────────────
// Mode A : un appareil déjà connecté génère le code (modale dans /mail)
router.get('/quick-connect', requireAuth, (req, res) => res.redirect('/mail?openQuickConnect=1'));
router.post('/api/quick-connect/generate', requireAuth, quickConnectCtrl.generate);
router.get('/quick-connect/consume', quickConnectCtrl.consumeFromAuthenticated);

// Mode B : un nouvel appareil (pas connecté) demande — page à part obligatoire
// (l'appareil n'est pas encore authentifié, donc pas de modale possible ici)
router.get('/quick-connect/new-device', (req, res) => {
  res.render('pages/quick-connect-new-device', { title: 'Connexion rapide — TechSphere Webmail' });
});
router.post('/api/quick-connect/request', quickConnectCtrl.request);
router.get('/api/quick-connect/status/:token', quickConnectCtrl.status);

// Approbation (un appareil déjà connecté ouvre le lien scanné) → renvoie
// vers /mail avec la modale d'approbation qui s'auto-ouvre côté client
router.get('/quick-connect/approve', requireAuth, (req, res) => {
  res.redirect('/mail?quickApprove=' + encodeURIComponent(req.query.token || ''));
});
router.get('/api/quick-connect/token-info/:token', requireAuth, quickConnectCtrl.tokenInfo);
router.post('/api/quick-connect/decide', requireAuth, quickConnectCtrl.decide);
router.post('/api/quick-connect/consume-approved', quickConnectCtrl.consumeApproved);

router.get('/mail', requireAuth, mailCtrl.showMail);
router.get('/help', requireAuth, (req, res) => {
  res.render('pages/help', {
    title: 'Aide — TechSphere Webmail'
  });
});

// ── Contacts ─────────────────────────────────────────────────────────────
router.get   ('/api/contacts',           requireAuth, contactsCtrl.list);
router.post  ('/api/contacts',           requireAuth, contactsCtrl.create);
router.put   ('/api/contacts/:id',       requireAuth, contactsCtrl.update);
router.post  ('/api/contacts/:id/favorite', requireAuth, contactsCtrl.toggleFavorite);
router.delete('/api/contacts/:id',       requireAuth, contactsCtrl.remove);

// ── Calendrier ───────────────────────────────────────────────────────────
router.get   ('/api/calendar/events',         requireAuth, calendarCtrl.list);
router.post  ('/api/calendar/events',         requireAuth, calendarCtrl.create);
router.put   ('/api/calendar/events/:id',     requireAuth, calendarCtrl.update);
router.delete('/api/calendar/events/:id',     requireAuth, calendarCtrl.remove);
router.get   ('/api/calendar/events/:id/ics', requireAuth, calendarCtrl.exportIcs);

router.get('/api/me', requireAuth, authCtrl.getMe);
router.post('/api/add-account', requireAuth, authCtrl.addAccount);
router.post('/api/remove-account', requireAuth, authCtrl.removeAccount);
router.post('/api/switch-account', requireAuth, authCtrl.switchAccount);
router.post('/api/remove-known-account', authCtrl.removeKnownAccount);

router.get('/api/folders', requireAuth, mailCtrl.getFolders);
router.get('/api/emails', requireAuth, mailCtrl.getEmails);
router.get('/api/email/:uid', requireAuth, mailCtrl.getEmailBody);
router.delete('/api/email/:uid', requireAuth, mailCtrl.deleteEmail);
router.post('/api/email/:uid/mark', requireAuth, mailCtrl.markEmail);
router.post('/api/email/:uid/star', requireAuth, mailCtrl.starEmail);
router.post('/api/email/:uid/move', requireAuth, mailCtrl.moveEmail);
router.post('/api/email/:uid/spam', requireAuth, mailCtrl.markSpam);
router.post('/api/send', requireAuth, uploadMail.array('attachments', 10), mailCtrl.sendEmail);
router.get('/api/attachment/:uid/:idx', requireAuth, mailCtrl.downloadAttachment);
router.get('/api/email/:uid/eml', requireAuth, mailCtrl.downloadEml);
router.get('/api/quota', requireAuth, mailCtrl.getQuota);
router.post('/api/draft', requireAuth, mailCtrl.saveDraft);
router.post('/api/schedule', requireAuth, uploadMail.array('attachments', 10), mailCtrl.scheduleEmail);
router.get   ('/api/schedule', requireAuth, mailCtrl.listScheduled);
router.delete('/api/schedule/:id', requireAuth, mailCtrl.cancelScheduled);
router.get('/api/search', requireAuth, mailCtrl.searchEmails);

// ── Assistant IA du webmail ──────────────────────────────────────────────
router.get   ('/api/ai/conversations',            requireAuth, aiCtrl.listConversations);
router.get   ('/api/ai/conversations/:id',        requireAuth, aiCtrl.getMessages);
router.post  ('/api/ai/conversations/:id/rename', requireAuth, aiCtrl.renameConversation);
router.delete('/api/ai/conversations/:id',        requireAuth, aiCtrl.removeConversation);
router.post  ('/api/ai/chat',                     requireAuth, aiLimiter, aiCtrl.chat);
router.post  ('/api/ai/chat/stream',              requireAuth, aiLimiter, aiCtrl.chatStream);
router.get   ('/api/ai/preferences',              requireAuth, aiCtrl.getPreferences);
router.post  ('/api/ai/preferences',              requireAuth, aiCtrl.savePreferences);
router.post  ('/api/ai/agenda/check',             requireAuth, aiCtrl.agendaCheck);
router.post  ('/api/ai/feedback',                 requireAuth, aiLimiter, aiCtrl.sendFeedback);

// ── Administration de l'IA (rôle administrateur) ─────────────────────────
router.get   ('/api/admin/ai/overview',           requireAuth, requireAdmin, aiAdminCtrl.overview);
router.post  ('/api/admin/ai/settings',           requireAuth, requireAdmin, aiAdminCtrl.saveSettings);
router.post  ('/api/admin/ai/test',               requireAuth, requireAdmin, aiAdminCtrl.test);
router.get   ('/api/admin/ai/audit',              requireAuth, requireAdmin, aiAdminCtrl.auditLog);
router.get   ('/api/admin/ai/feedback',           requireAuth, requireAdmin, aiAdminCtrl.feedbackList);
router.get   ('/api/admin/ai/feedback/cases',     requireAuth, requireAdmin, aiAdminCtrl.feedbackCases);
router.post  ('/api/ai/messages/:messageId/cards/:cardId/state', requireAuth, aiCtrl.setCardState);
router.post  ('/api/ai/tools',                    requireAuth, aiLimiter, aiCtrl.tools);
router.post  ('/api/ai/meetings/:id/actions',     requireAuth, aiLimiter, aiCtrl.meetingActions);
router.post  ('/api/ai/meetings/:id/minutes',     requireAuth, aiLimiter, aiCtrl.meetingMinutes);
router.post  ('/api/ai/meetings/:id/quiz',        requireAuth, aiLimiter, aiCtrl.meetingQuiz);

// ── Images du tableau blanc (validées à l'enregistrement ; URL = 128 bits aléatoires, donc non devinable) ──
const wbImages = require('./services/wbImageService');
router.get('/wb-media/:file', (req, res) => {
  const file = wbImages.filePath(req.params.file);
  if (!file) return res.status(404).end();
  res.set({
    'Content-Type': wbImages.mimeFor(req.params.file),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'public, max-age=86400, immutable',
  });
  res.sendFile(file, { dotfiles: 'deny' });
});

// ── Banque de quiz (contrôleur et page existants, routes absentes de la version reçue) ──
const quizSetCtrl = require('./controllers/quizSetController');
router.get   ('/quiz-sets', requireAuth, (req, res) => res.render('pages/quiz-sets', { title: 'Banque de quiz', csrfToken: res.locals.csrfToken || '' }));
router.get   ('/api/quiz-sets/template.txt', requireAuth, quizSetCtrl.downloadTxtTemplate);
router.get   ('/api/quiz-sets/template.qzx', requireAuth, quizSetCtrl.downloadQzxTemplate);
router.post  ('/api/quiz-sets/import',       requireAuth, quizSetCtrl.importQuizFile);
router.get   ('/api/quiz-sets',              requireAuth, quizSetCtrl.listQuizSets);
router.get   ('/api/quiz-sets/:id',          requireAuth, quizSetCtrl.getQuizSet);
router.post  ('/api/quiz-sets',              requireAuth, quizSetCtrl.saveQuizSet);
router.delete('/api/quiz-sets/:id',          requireAuth, quizSetCtrl.deleteQuizSet);

router.get('/api/signature', requireAuth, sigCtrl.getSignature);
router.post('/api/signature', requireAuth, sigCtrl.saveSignature);

router.get('/api/chat/conversations', requireAuth, chatCtrl.getConversations);
router.get('/api/chat/history/:peerEmail', requireAuth, chatCtrl.getHistory);

router.get('/meeting/:id', meetCtrl.showRoom);
router.post('/api/meetings', requireAuth, meetCtrl.createMeeting);
router.get('/api/meetings', requireAuth, meetCtrl.getMyMeetings);
router.get('/api/meetings/history', requireAuth, meetCtrl.getMeetingHistory);
router.get('/api/meetings/:id/attendance', requireAuth, meetCtrl.getAttendance);
router.get('/api/meetings/:id/attendance.csv', requireAuth, meetCtrl.exportAttendanceCsv);
router.post('/api/meetings/:id/start', requireAuth, meetCtrl.startMeeting);
router.post('/api/meetings/:id/end', requireAuth, meetCtrl.endMeeting);
router.post('/api/meetings/join-by-code', requireAuth, meetCtrl.joinByCode);
router.post('/api/meetings/verify-code', codeVerifyLimiter, meetCtrl.verifyCode);
router.get('/api/meetings/ice-servers', meetCtrl.getIceServers);

// ── Récupération de compte (email de secours) ──────────────────────────────
router.get ('/api/account/recovery-email',        requireAuth, recoveryCtrl.getRecoveryStatus);
router.post('/api/account/recovery-email/link',    requireAuth, recoveryCtrl.linkRecoveryEmail);
router.post('/api/account/recovery-email/confirm', requireAuth, codeVerifyLimiter, recoveryCtrl.confirmRecoveryEmail);
router.post('/api/account/change-password',         requireAuth, recoveryCtrl.changePassword);

// ── 2FA ──────────────────────────────────────────────────────────────────
router.get ('/api/account/2fa/status',  requireAuth, twoFactorCtrl.status);
router.post('/api/account/2fa/setup',   requireAuth, twoFactorCtrl.setup);
router.post('/api/account/2fa/enable',  requireAuth, codeVerifyLimiter, twoFactorCtrl.enable);
router.post('/api/account/2fa/disable', requireAuth, twoFactorCtrl.disable);

// ── Administration ───────────────────────────────────────────────────────
// ── Administration (panneau intégré, pas de page séparée) ──────────────────
router.get   ('/api/admin/status',   requireAuth, adminCtrl.status); // check léger, pas besoin d'être admin pour demander SI on l'est
router.get   ('/api/admin/overview', requireAuth, requireAdmin, adminCtrl.overview);
router.get   ('/api/admin/activity', requireAuth, requireAdmin, adminCtrl.activity);
router.get   ('/api/admin/accounts', requireAuth, requireAdmin, adminCtrl.accounts);
router.get   ('/api/admin/meetings', requireAuth, requireAdmin, adminCtrl.meetings);

router.get   ('/api/admin/admins',            requireAuth, requireAdmin, adminCtrl.listAdmins);
router.post  ('/api/admin/admins',            requireAuth, requireAdmin, adminCtrl.addAdmin);
router.delete('/api/admin/admins/:email',     requireAuth, requireAdmin, adminCtrl.removeAdminRoute);

router.post  ('/api/admin/accounts/:email/suspend',   requireAuth, requireAdmin, adminCtrl.suspendAccount);
router.post  ('/api/admin/accounts/:email/unsuspend', requireAuth, requireAdmin, adminCtrl.unsuspendAccount);
router.delete('/api/admin/accounts/:email',           requireAuth, requireAdmin, adminCtrl.deleteAccount);
router.post('/api/auth/forgot-password', requestCodeLimiter, recoveryCtrl.forgotPassword);
router.post('/api/auth/reset-password',  codeVerifyLimiter, recoveryCtrl.resetPassword);
router.delete('/api/meetings/:id', requireAuth, meetCtrl.deleteMeeting);
router.post('/api/meetings/:id/review', requestCodeLimiter, meetCtrl.submitReview);
router.post('/api/meetings/:id/ai-chat', requireAuth, aiLimiter, meetCtrl.aiChat);
router.post('/api/meetings/:id/summary', requireAuth, aiLimiter, meetCtrl.generateSummary);
router.get ('/api/meetings/:id/ai-summary', requireAuth, meetCtrl.getAiSummary);
// Un upload dans le chat réunion n'était protégé par RIEN — ni authentification
// (les invités doivent pouvoir envoyer des fichiers, donc pas de requireAuth
// possible), ni vérification que la réunion existe seulement. On ajoute donc
// le minimum : la réunion ciblée doit exister et être en direct, + limite de
// débit pour empêcher le spam. Une vérification "participant vérifié" complète
// nécessiterait un jeton par participant émis à la connexion (à prévoir).
async function requireLiveMeeting(req, res, next) {
  try {
    const meeting = await meetingService.getMeeting(req.params.id);
    if (!meeting || meeting.status !== 'live') {
      return res.status(404).json({ ok: false, error: 'Réunion introuvable ou terminée' });
    }
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

router.post('/api/meetings/:id/chat-upload', uploadLimiter, requireLiveMeeting, handleMeetingChatUpload, meetCtrl.uploadChatFile);

router.post('/api/push/subscribe', (req, res) => {
  res.json({
    ok: true,
    subscribed: false,
    message: 'Push non configuré sur ce serveur'
  });
});

router.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(
    '// Service Worker TechSphere\n' +
    'self.addEventListener("install", () => self.skipWaiting());\n' +
    'self.addEventListener("activate", e => e.waitUntil(clients.claim()));\n'
  );
});

router.get('/uploads/chat/*', uploadLimiter, (req, res) => {
  const relPath = req.params[0];
  const safePath = path.normalize(relPath).replace(/^(\.\.\/|\.\.\\)+/, '');
  const basePath = path.join(__dirname, '..', 'public', 'uploads', 'chat');
  const abs = path.join(basePath, safePath);

  if (!abs.startsWith(basePath)) return res.status(403).end();

  // Le fichier est stocké sous uploads/chat/<meetingId>/<fichier> — le referer
  // doit correspondre à CETTE réunion précise, pas juste contenir "/meeting/"
  // n'importe où (ça laissait passer n'importe quel referer venant de
  // n'importe quelle autre réunion, sans lien avec le fichier demandé).
  const meetingIdFromPath = safePath.split('/')[0];
  const referer = req.get('referer') || '';
  const refererMatchesMeeting = meetingIdFromPath && referer.includes(`/meeting/${meetingIdFromPath}`);

  const canAccess = !!(
    req.session?.activeAccount ||
    req.session?.accounts?.length ||
    refererMatchesMeeting
  );
  if (!canAccess) return res.status(403).end();

  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile(abs);
});

router.use('/uploads/thesis', requireAuth, express.static(path.join(__dirname, '..', 'public', 'uploads', 'thesis')));

module.exports = router;