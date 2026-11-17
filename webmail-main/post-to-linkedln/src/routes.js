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

router.get('/register', authCtrl.showRegister);
router.post('/api/register/suggest-email', authCtrl.suggestRegisterEmail);
router.post('/api/register', authCtrl.doRegister);

router.post('/logout', authCtrl.doLogout);

router.get('/mail', requireAuth, mailCtrl.showMail);
router.get('/help', requireAuth, (req, res) => {
  res.render('pages/help', {
    title: 'Aide — TechSphere Webmail'
  });
});

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
router.post('/api/schedule', requireAuth, mailCtrl.scheduleEmail);
router.get('/api/search', requireAuth, mailCtrl.searchEmails);

router.get('/api/signature', requireAuth, sigCtrl.getSignature);
router.post('/api/signature', requireAuth, sigCtrl.saveSignature);

router.get('/api/chat/conversations', requireAuth, chatCtrl.getConversations);
router.get('/api/chat/history/:peerEmail', requireAuth, chatCtrl.getHistory);

router.get('/meeting/:id', meetCtrl.showRoom);
router.post('/api/meetings', requireAuth, meetCtrl.createMeeting);
router.get('/api/meetings', requireAuth, meetCtrl.getMyMeetings);
router.get('/api/meetings/history', requireAuth, meetCtrl.getMeetingHistory);
router.post('/api/meetings/:id/start', requireAuth, meetCtrl.startMeeting);
router.post('/api/meetings/:id/end', requireAuth, meetCtrl.endMeeting);
router.post('/api/meetings/join-by-code', requireAuth, meetCtrl.joinByCode);
router.post('/api/meetings/verify-code', meetCtrl.verifyCode);
router.get('/api/meetings/ice-servers', meetCtrl.getIceServers);
router.delete('/api/meetings/:id', requireAuth, meetCtrl.deleteMeeting);
router.post('/api/meetings/:id/review', meetCtrl.submitReview);
router.post('/api/meetings/:id/ai-chat', requireAuth, meetCtrl.aiChat);
router.post('/api/meetings/:id/summary', requireAuth, meetCtrl.generateSummary);
router.post('/api/meetings/:id/chat-upload', handleMeetingChatUpload, meetCtrl.uploadChatFile);

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

router.get('/uploads/chat/*', (req, res) => {
  const referer = req.get('referer') || '';
  const canAccess = !!(
    req.session?.activeAccount ||
    req.session?.accounts?.length ||
    referer.includes('/meeting/')
  );

  if (!canAccess) return res.status(403).end();

  const relPath = req.params[0];
  const safePath = path.normalize(relPath).replace(/^(\.\.\/|\.\.\\)+/, '');
  const basePath = path.join(__dirname, '..', 'public', 'uploads', 'chat');
  const abs = path.join(basePath, safePath);

  if (!abs.startsWith(basePath)) return res.status(403).end();
  if (!fs.existsSync(abs)) return res.status(404).end();

  res.sendFile(abs);
});

router.use('/uploads/thesis', express.static(path.join(__dirname, '..', 'public', 'uploads', 'thesis')));

module.exports = router;