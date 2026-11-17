require('dotenv').config();
const express          = require('express');
const session          = require('express-session');
const cookieParser     = require('cookie-parser');
const { createServer } = require('http');
const { Server }       = require('socket.io');
const path             = require('path');
const routes           = require('./src/routes');
const { initSocket }   = require('./src/services/socket');
const { initDB }       = require('./src/services/db');

// ── Mediasoup SFU — initialiser avant le démarrage du serveur ────────────────
const { initMediasoup } = require('./src/services/mediasoupService');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  // Forcer WebSocket — le polling HTTP cause des timeouts sous Nginx
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout:  60000,
  maxHttpBufferSize: 10 * 1024 * 1024,
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// IMPORTANT derrière Nginx / reverse proxy
app.set('trust proxy', 1);

app.use(cookieParser());

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax'
  },
});

app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((req, _res, next) => { req.io = io; next(); });
app.use('/', routes);

initSocket(io, sessionMiddleware);

// Capturer les erreurs non gérées pour éviter les crashes silencieux
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection:', reason);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`TechSphere Webmail -> http://localhost:${PORT}`);
  console.log(`IMAP : mail.netiify.cloud:993 (SSL)`);
  console.log(`SMTP : mail.netiify.cloud:587 (STARTTLS)`);

  // ── Initialiser mediasoup (SFU) ──────────────────────────────────────────
  try {
    await initMediasoup();
    console.log('[SFU] mediasoup prêt');
  } catch (e) {
    console.error('[SFU] Impossible d\'initialiser mediasoup :', e.message);
    // On ne stoppe pas le serveur — les fonctionnalités non-SFU restent disponibles
  }

  try {
    await initDB();
    // Purge automatique des réunions expirées (toutes les heures)
    const { startPurgeScheduler } = require('./src/services/meeting');
    startPurgeScheduler();
  } catch (e) {
    console.error('DB non disponible :', e.message);
  }
});
