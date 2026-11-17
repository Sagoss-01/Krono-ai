const { getMailboxStatus, fetchEmails } = require('./imap');
const { saveMessage, getHistory, roomId, markRead, addReaction, removeReaction, deleteMessage } = require('./chat');
const logger = require('./logger');
const { pool } = require('./db');
const meetingService = require('./meeting');
const { decrypt } = require('../middlewares/encrypt');
const messageCrypto = require('./messageCrypto');
const aiWhiteboardService = require('./aiWhiteboardService');
const aiContext = require('./aiContext');
const wbImageService = require('./wbImageService');
const aiMeetingService = require('./aiMeetingService');
const meetingAiSummary = require('./meetingAiSummaryService');

// ── Import mediasoupService ───────────────────────────────────────────────────
const {
  ensureRoom,
  getRoom,
  listProducers,
  createWebRtcTransport,
  connectTransport,
  createProducer,
  createConsumer,
  resumeConsumer,
  setConsumerPreferredLayers,
  pauseProducer,
  resumeProducer,
  closeProducer,
  closePeer,
} = require('./mediasoupService');

// Historique des chats de réunion (en mémoire, vidé quand la réunion se termine)
const meetingChatHistory = new Map();

// Notes collaboratives par réunion (en mémoire)
const meetingNotes = new Map(); // meetingId → { content, revision, updatedAt }

// Tableau blanc : état persistant par réunion pour les late joiners
const wbStates  = new Map(); // meetingId → { objects } | { dataUrl }
const quizVotes       = new Map(); // quizId → { votes, voters, voterNames, options, correctIdx, question, scores, meetingId }
const quizLeaderboard = new Map(); // meetingId → { displayName → totalScore }
const activeBreakouts = new Map(); // meetingId (parent) → { rooms: [{id,label}], timer, durationMinutes, openedAt }

    // Salle d'attente : meetingId → Map(socketId → { email, displayName, socket })
const waitingRooms = new Map();

// Approbations mémorisées : meetingId → Set(email) — évite re-approbation après rechargement
const approvedParticipants = new Map();
const meetingPolls = new Map(); // meetingId -> active poll state
const meetingUploadChunks = new Map(); // uploadId -> chunk accumulator
const meetingCatalysts = new Map(); // meetingId -> Set(email)
const meetingSessions = new Map(); // meetingId -> { startedAt, expiresAt, promptForExpiresAt, ticker }
const meetingParticipation = new Map(); // meetingId -> Map(email -> stats)
const meetingBans = new Map(); // meetingId -> Array<{email,browserId,ip}>
const meetingAdminLogs = new Map(); // meetingId -> Array<{at, actor, action, target, detail}>
const meetingLocks = new Map(); // meetingId -> {locked:boolean, mode:'waiting'|'refuse'}
const meetingParticipantPermissions = new Map(); // meetingId -> Map(email -> permissions)
const meetingTempExpulsions = new Map(); // meetingId -> Array<{email,browserId,ip,until,mode,manual}>
const meetingRejoinState = new Map(); // meetingId -> Map(email -> 'active'|'waiting'|'removed'|'banned'|'expelled'>



function getMeetingAdminLog(meetingId) {
  if (!meetingAdminLogs.has(meetingId)) meetingAdminLogs.set(meetingId, []);
  return meetingAdminLogs.get(meetingId);
}
function getMeetingLock(meetingId) {
  return meetingLocks.get(meetingId) || { locked: false, mode: 'waiting' };
}
function setMeetingLock(meetingId, locked, mode = 'waiting') {
  const next = { locked: !!locked, mode: mode === 'refuse' ? 'refuse' : 'waiting' };
  meetingLocks.set(meetingId, next);
  return next;
}
function getMeetingPermissionsStore(meetingId) {
  if (!meetingParticipantPermissions.has(meetingId)) meetingParticipantPermissions.set(meetingId, new Map());
  return meetingParticipantPermissions.get(meetingId);
}
function defaultParticipantPermissions() {
  return { canUnmute: true, canUseCamera: true, canShareScreen: true, canChat: true, readOnly: false, forceMuted: false, canSpeak: true };
}
function getParticipantPermissions(meetingId, email = '') {
  const key = String(email || '').trim().toLowerCase();
  const store = getMeetingPermissionsStore(meetingId);
  if (!store.has(key)) store.set(key, defaultParticipantPermissions());
  return store.get(key);
}
function setParticipantPermissions(meetingId, email = '', patch = {}) {
  const key = String(email || '').trim().toLowerCase();
  const current = { ...getParticipantPermissions(meetingId, key), ...(patch || {}) };
  if (current.readOnly) {
    current.canUnmute = false; current.canUseCamera = false; current.canShareScreen = false; current.canChat = false; current.canSpeak = false;
  }
  if (current.forceMuted) current.canUnmute = false;
  getMeetingPermissionsStore(meetingId).set(key, current);
  return current;
}
function getMeetingExpulsions(meetingId) {
  if (!meetingTempExpulsions.has(meetingId)) meetingTempExpulsions.set(meetingId, []);
  return meetingTempExpulsions.get(meetingId);
}
function getMeetingRejoinStore(meetingId) {
  if (!meetingRejoinState.has(meetingId)) meetingRejoinState.set(meetingId, new Map());
  return meetingRejoinState.get(meetingId);
}
function setRejoinState(meetingId, email, state) {
  if (!email) return;
  getMeetingRejoinStore(meetingId).set(String(email).trim().toLowerCase(), state);
}
function getRejoinState(meetingId, email) {
  return getMeetingRejoinStore(meetingId).get(String(email || '').trim().toLowerCase()) || null;
}
function isTempExpelled(meetingId, identity = {}) {
  const list = getMeetingExpulsions(meetingId);
  const now = Date.now();
  let matched = null;
  const kept = [];
  for (const entry of list) {
    const active = entry.manual || entry.until === 'end' || (Number(entry.until) > now);
    if (!active) continue;
    kept.push(entry);
    const hit = (identity.email && entry.email && entry.email === identity.email) || (identity.browserId && entry.browserId && entry.browserId === identity.browserId) || (identity.ip && entry.ip && entry.ip === identity.ip);
    if (hit) matched = entry;
  }
  meetingTempExpulsions.set(meetingId, kept);
  return matched;
}
function addTempExpulsion(meetingId, identity = {}, opts = {}) {
  const list = getMeetingExpulsions(meetingId);
  const entry = { email: String(identity.email || '').trim().toLowerCase(), browserId: String(identity.browserId || '').trim(), ip: String(identity.ip || '').trim(), until: opts.manual ? null : (opts.until === 'end' ? 'end' : Number(opts.until || 0)), mode: opts.mode || 'temporary', manual: !!opts.manual };
  list.push(entry);
  return entry;
}
function addAdminLog(io, meetingId, actorSocket, action, target = '', detail = '') {
  const actorName = actorSocket?.data?.displayName || actorSocket?.data?.meetingEmail || (actorSocket?.data?.isHost ? 'Host' : 'Admin');
  const row = { at: new Date().toISOString(), actor: actorName, action, target, detail };
  const log = getMeetingAdminLog(meetingId);
  log.push(row);
  while (log.length > 200) log.shift();
  io.to(`meeting:${meetingId}`).emit('meeting_admin_log_sync', { logs: log });
}
function emitAdminSnapshot(io, meetingId, targetSocket = null) {
  const payload = { logs: getMeetingAdminLog(meetingId), lock: getMeetingLock(meetingId) };
  if (targetSocket) targetSocket.emit('meeting_admin_state', payload);
  else io.to(`meeting:${meetingId}`).emit('meeting_admin_state', payload);
}
function cleanWaitingEntry(entry = {}) {
  return { socketId: entry.socketId, email: entry.email || '', displayName: entry.displayName || 'Participant', joinedAt: entry.joinedAt || new Date().toISOString(), attempts: Number(entry.attempts || 1), message: entry.message || '' };
}
function upsertWaitingParticipant(meetingId, entry = {}) {
  const waiting = waitingRooms.get(meetingId) || new Map();
  waitingRooms.set(meetingId, waiting);
  waiting.set(entry.socketId, cleanWaitingEntry(entry));
  return waiting;
}
function emitWaitingRoomList(io, meetingId) {
  const waiting = waitingRooms.get(meetingId);
  const waitList = waiting ? Array.from(waiting.values()).map(cleanWaitingEntry) : [];
  io.to(`meeting:${meetingId}`).emit('waiting_room_list', { waitList });
}
function findSocketByEmail(io, meetingId, email = '') {
  const room = io.sockets.adapter.rooms.get(`meeting:${meetingId}`) || [];
  const normalized = String(email || '').trim().toLowerCase();
  for (const sid of room) {
    const sock = io.sockets.sockets.get(sid);
    if (!sock || sock.data?.waiting) continue;
    if (String(sock.data?.meetingEmail || '').trim().toLowerCase() === normalized) return sock;
  }
  return null;
}
function forceCleanupParticipant(io, meetingId, targetSocket, reason = 'cleanup') {
  if (!targetSocket) return;
  removeSocketFromMeeting(io, targetSocket, meetingId, 'meeting_peer_left');
  targetSocket.emit('meeting_force_cleanup', { reason });
}

function parseCookieHeader(cookieHeader = '') {
  return String(cookieHeader || '').split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function getSocketIdentity(socket, fallbackEmail = '') {
  const cookies = parseCookieHeader(socket?.handshake?.headers?.cookie || '');
  const xfwd = String(socket?.handshake?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    email: String(fallbackEmail || socket?.data?.meetingEmail || '').trim().toLowerCase(),
    browserId: String(cookies.browser_id || cookies.browserId || '').trim(),
    ip: xfwd || socket?.handshake?.address || '',
  };
}

function getMeetingBanList(meetingId) {
  if (!meetingBans.has(meetingId)) meetingBans.set(meetingId, []);
  return meetingBans.get(meetingId);
}

function isMeetingBanned(meetingId, identity = {}) {
  const bans = getMeetingBanList(meetingId);
  return bans.some(entry =>
    (identity.email && entry.email && entry.email === identity.email) ||
    (identity.browserId && entry.browserId && entry.browserId === identity.browserId) ||
    (identity.ip && entry.ip && entry.ip === identity.ip)
  );
}

function addMeetingBan(meetingId, identity = {}) {
  const bans = getMeetingBanList(meetingId);
  if (isMeetingBanned(meetingId, identity)) return;
  bans.push({
    email: String(identity.email || '').trim().toLowerCase(),
    browserId: String(identity.browserId || '').trim(),
    ip: String(identity.ip || '').trim(),
  });
}

function removeSocketFromMeeting(io, socket, meetingId, eventName = 'meeting_peer_left') {
  const room = `meeting:${meetingId}`;
  try { socket.leave(room); } catch (_) {}
  socket.data.waiting = false;
  socket.to(room).emit(eventName, { socketId: socket.id });
}

async function getMeetingMeta(meetingId) {
  try {
    const [rows] = await pool.execute('SELECT id, host, access, code, status FROM meetings WHERE id=? LIMIT 1', [meetingId]);
    return rows[0] || null;
  } catch (_) {
    return null;
  }
}

function socketWhiteboardIdentity(socket) {
  const displayName = socket?.data?.displayName || socket?.data?.meetingEmail || 'Participant';
  const email = String(socket?.data?.meetingEmail || '').trim().toLowerCase();
  const seed = email || socket?.id || displayName;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return {
    authorName: displayName,
    authorEmail: email,
    authorSocketId: socket?.id,
    authorColor: `hsl(${hue} 78% 62%)`,
  };
}
async function persistMeetingChatMessage(meetingId, msg) {
  const [result] = await pool.execute(`
    INSERT INTO meeting_chat_messages
      (meeting_id, sender, display_name, anonymous, content, file_id, file_name, file_type, file_size, file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    meetingId,
    msg.email || '',
    msg.anonymous ? null : (msg.displayName || null),
    msg.anonymous ? 1 : 0,
    msg.text ? messageCrypto.encryptContent(msg.text) : null,
    msg.fileId || null,
    msg.fileName || null,
    msg.fileType || null,
    msg.fileSize || null,
    msg.fileUrl || null,
  ]);
  return Number(result.insertId);
}

async function loadMeetingChatHistory(meetingId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
  const [rows] = await pool.execute(`
    SELECT id, sender, display_name, anonymous, content, file_id, file_name, file_type, file_size, file_url, created_at
    FROM meeting_chat_messages
    WHERE meeting_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ${safeLimit}
  `, [meetingId]);
  return rows.map(r => ({
    id: r.id,
    socketId: null,
    email: r.sender,
    displayName: r.anonymous ? 'Un participant' : (r.display_name || r.sender || 'Un participant'),
    anonymous: !!r.anonymous,
    text: r.content ? messageCrypto.decryptContent(r.content) : null,
    fileName: r.file_name || null,
    fileSize: r.file_size || null,
    fileType: r.file_type || null,
    fileUrl: r.file_url || null,
    fileId: r.file_id || null,
    at: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  }));
}

async function getOrLoadMeetingChatHistory(meetingId) {
  let history = meetingChatHistory.get(meetingId);
  if (!history) {
    history = await loadMeetingChatHistory(meetingId);
    meetingChatHistory.set(meetingId, history);
  }
  return history;
}

function getActivePollSnapshot(poll) {
  if (!poll) return null;
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    votes: poll.votes,
    expectedVotes: poll.expectedVotes || 0,
    receivedVotes: poll.voters?.size || 0,
    allAnswered: !!poll.allAnswered,
    closed: !!poll.closed,
  };
}

function getMeetingUploadQuotaBytes() {
  const quotaMb = Math.max(1, parseInt(process.env.MEETING_CHAT_UPLOAD_QUOTA_MB || '100', 10));
  return quotaMb * 1024 * 1024;
}

function getDirSizeBytes(dir) {
  const fs = require('fs');
  const path = require('path');
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sum + getDirSizeBytes(full);
      if (entry.isFile()) return sum + (fs.statSync(full).size || 0);
      return sum;
    }, 0);
  } catch (_) {
    return 0;
  }
}

function finalizeMeetingChunkUpload(upload) {
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');

  const baseDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat', upload.meetingId);
  fs.mkdirSync(baseDir, { recursive: true });

  const totalSize = upload.chunks.reduce((sum, b) => sum + (b?.length || 0), 0);
  const quotaBytes = getMeetingUploadQuotaBytes();
  const currentUsage = getDirSizeBytes(baseDir);
  if ((currentUsage + totalSize) > quotaBytes) {
    const err = new Error(`Quota d'upload dépassé pour cette réunion (max ${Math.round(quotaBytes / 1048576)} Mo).`);
    err.code = 'UPLOAD_QUOTA_EXCEEDED';
    throw err;
  }

  const safeOriginal = (upload.originalname || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${fileId}_${safeOriginal}`;
  const absPath = path.join(baseDir, filename);

  fs.writeFileSync(absPath, Buffer.concat(upload.chunks));
  return {
    fileId,
    fileName: upload.originalname || safeOriginal,
    fileSize: totalSize,
    fileType: upload.mimetype || 'application/octet-stream',
    fileUrl: `/uploads/chat/${upload.meetingId}/${filename}`,
  };
}



function getMeetingSession(meetingId) {
  return meetingSessions.get(meetingId) || null;
}

/** Lance le compte-rendu IA automatique (si l'hôte l'a activé). À appeler AVANT d'effacer l'historique du chat. */
function triggerAiSummary(io, meetingId) {
  if (!meetingAiSummary.isEnabled(meetingId)) return;
  const room = io.sockets.adapter.rooms.get(`meeting:${meetingId}`);
  const participants = [...(room || [])]
    .map(id => io.sockets.sockets.get(id)?.data?.displayName).filter(Boolean);
  const startedAt = meetingSessions.get(meetingId)?.startedAt;
  const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : 0;
  const chat = (meetingChatHistory.get(meetingId) || []).filter(m => m.text && !m.anonymous);
  meetingAiSummary.finalize({
    meetingId, chat, participants: [...new Set(participants)],
    duration: minutes ? (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`) : '',
  });
}

function ensureMeetingSession(io, meetingId) {
  let session = meetingSessions.get(meetingId);
  if (!session) {
    const startedAt = Date.now();
    session = { startedAt, expiresAt: startedAt + (65 * 60 * 1000), promptForExpiresAt: null, ticker: null };
    meetingSessions.set(meetingId, session);
  }
  if (!session.ticker) {
    session.ticker = setInterval(() => {
      const current = meetingSessions.get(meetingId);
      if (!current) return;
      const room = `meeting:${meetingId}`;
      const roomSockets = io.sockets.adapter.rooms.get(room);
      const now = Date.now();
      if (current.expiresAt && now >= current.expiresAt) {
        triggerAiSummary(io, meetingId);
        io.to(room).emit('meeting_ended');
        if (current.ticker) clearInterval(current.ticker);
        meetingSessions.delete(meetingId);
        return;
      }
      if (current.expiresAt && now >= (current.expiresAt - 5 * 60 * 1000) && current.promptForExpiresAt !== current.expiresAt) {
        current.promptForExpiresAt = current.expiresAt;
        (roomSockets ? Array.from(roomSockets) : []).forEach(sid => {
          const sock = io.sockets.sockets.get(sid);
          if (sock && socketHasControlPower(meetingId, sock)) sock.emit('meeting_extension_prompt', { expiresAt: new Date(current.expiresAt).toISOString() });
        });
      }
    }, 5000);
  }
  return session;
}

function emitMeetingTimerSync(io, meetingId, targetSocket = null) {
  const session = getMeetingSession(meetingId);
  if (!session) return;
  const payload = { startedAt: new Date(session.startedAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString() };
  if (targetSocket) targetSocket.emit('meeting_timer_sync', payload);
  else io.to(`meeting:${meetingId}`).emit('meeting_timer_sync', payload);
}

function getMeetingParticipationStore(meetingId) {
  if (!meetingParticipation.has(meetingId)) meetingParticipation.set(meetingId, new Map());
  return meetingParticipation.get(meetingId);
}

function touchParticipantStat(meetingId, sock) {
  const email = sock?.data?.meetingEmail || `guest:${sock?.id || 'unknown'}`;
  const store = getMeetingParticipationStore(meetingId);
  if (!store.has(email)) store.set(email, { email, displayName: sock?.data?.displayName || email, handRaises: 0, speechTurns: 0, speakingMs: 0, speakingSince: null, isHost: !!sock?.data?.isHost, isCatalyst: !!sock?.data?.isCatalyst });
  const row = store.get(email);
  row.displayName = sock?.data?.displayName || row.displayName;
  row.isHost = !!sock?.data?.isHost;
  row.isCatalyst = !!sock?.data?.isCatalyst;
  return row;
}

function buildParticipationStats(meetingId) {
  return Array.from(getMeetingParticipationStore(meetingId).values())
    .filter(row => !row.isHost && !row.isCatalyst)
    .map(row => ({ ...row, speakingMs: row.speakingMs + (row.speakingSince ? (Date.now() - row.speakingSince) : 0) }))
    .sort((a, b) => (b.speakingMs - a.speakingMs) || (b.speechTurns - a.speechTurns) || (b.handRaises - a.handRaises));
}

function emitParticipationStats(io, meetingId, targetSocket = null) {
  const payload = { stats: buildParticipationStats(meetingId) };
  const room = `meeting:${meetingId}`;
  if (targetSocket) return targetSocket.emit('participation_stats', payload);
  io.to(room).emit('participation_stats', payload);
}
function getMeetingCatalystSet(meetingId) {
  if (!meetingCatalysts.has(meetingId)) meetingCatalysts.set(meetingId, new Set());
  return meetingCatalysts.get(meetingId);
}

function socketHasControlPower(meetingId, sock) {
  return !!(sock?.data?.isHost || (sock?.data?.meetingEmail && getMeetingCatalystSet(meetingId).has(sock.data.meetingEmail)));
}

function syncCatalystRole(io, meetingId, sock, enabled) {
  if (!sock) return;
  sock.data.isCatalyst = !!enabled;
  sock.emit('meeting_role_sync', {
    socketId: sock.id,
    email: sock.data.meetingEmail || '',
    displayName: sock.data.displayName || '',
    role: 'catalyst',
    enabled: !!enabled,
    mine: true,
  });
  sock.to(`meeting:${meetingId}`).emit('meeting_role_sync', {
    socketId: sock.id,
    email: sock.data.meetingEmail || '',
    displayName: sock.data.displayName || '',
    role: 'catalyst',
    enabled: !!enabled,
    mine: false,
  });
}

function initSocket(io, sessionMiddleware) {
  if (sessionMiddleware) {
    io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
  }

  io.on('connection', (socket) => {
    const session      = socket.request.session;
    const sessionEmail = session?.activeAccount || session?.accounts?.[0]?.email;

    // Rejoindre la room inbox personnelle (pour notifs hors conversation)
    if (sessionEmail) socket.join(`inbox:${sessionEmail}`);

    // Room dédiée à CETTE session précise (un par onglet/navigateur connecté)
    // — utilisée par la fonctionnalité "Appareils" pour forcer une déconnexion
    // instantanée quand on retire/bloque cet appareil depuis un autre appareil.
    const sessionId = socket.request.sessionID;
    if (sessionId) socket.join(`device:${sessionId}`);

    // ── IMAP POLL ──────────────────────────────────────
    let timer = null, lastUidNext = -1;

    socket.on('start_poll', ({ email, folder, knownMaxUid }) => {
      const account = session?.accounts?.find(a => a.email === email);
      if (!account) return;
      const rawPwd = account.password || '';
      const password = rawPwd.includes(':') ? (decrypt(rawPwd) || rawPwd) : rawPwd;
      const creds = { email: account.email, password };
      const watchFolder = folder || 'INBOX';
      let lastMaxUid = knownMaxUid > 0 ? knownMaxUid : -1;

      const poll = async () => {
        try {
          const status = await getMailboxStatus(creds, watchFolder);
          if (lastUidNext === -1) {
            lastUidNext = status.uidnext;
            socket.emit('unread_update', { count: status.unseen, folder: watchFolder });
            return;
          }
          if (status.uidnext > lastUidNext) {
            const limit   = Math.min(Math.max(5, status.uidnext - lastUidNext), 20);
            const fetched = await fetchEmails(creds, watchFolder, limit);
            const thresh  = lastMaxUid > 0 ? lastMaxUid : lastUidNext - 1;
            const fresh   = fetched.filter(e => e.uid > thresh);
            if (fresh.length > 0) {
              lastMaxUid = Math.max(...fresh.map(e => e.uid));
              socket.emit('new_mail', { count: fresh.length, total: status.unseen, emails: fresh, folder: watchFolder });
            }
            lastUidNext = status.uidnext;
          }
          socket.emit('unread_update', { count: status.unseen, folder: watchFolder });
        } catch(e) {
          logger.app(email, 'WARN', `Poll: ${e.message}`);
        }
      };

      poll();
      if (timer) clearInterval(timer);
      timer = setInterval(poll, 8000);
    });

    socket.on('stop_poll', () => {
      if (timer) { clearInterval(timer); timer = null; }
      lastUidNext = -1;
    });

    // ── CHAT ───────────────────────────────────────────
    const joinedRooms = new Set();

    socket.on('chat_join', ({ myEmail, peerEmail }) => {
      if (!session?.accounts?.find(a => a.email === myEmail)) return;
      const room = roomId(myEmail, peerEmail);
      socket.join(room);
      joinedRooms.add(room);
    });

    socket.on('chat_send', async ({ myEmail, peerEmail, content, mediaType, mediaName, mediaMime, mediaSize, mediaData }) => {
  if (!session?.accounts?.find(a => a.email === myEmail)) return;

  const room = roomId(myEmail, peerEmail);

  try {
    const mediaBuffer = mediaData ? Buffer.from(mediaData, 'base64') : null;

    const saved = await saveMessage({
      room,
      sender: myEmail,
      peer: peerEmail,
      content: content || '',
      mediaType: mediaType || 'text',
      mediaName: mediaName || null,
      mediaMime: mediaMime || null,
      mediaSize: mediaSize || null,
      mediaBuffer,
    });

    const msg = {
      id: saved.id,
      sender: myEmail,
      content: content || null,
      media_type: mediaType || 'text',
      media_name: mediaName || null,
      media_mime: mediaMime || null,
      media_size: mediaSize || null,
      media_path: saved.mediaPath || null,
      has_media: !!saved.mediaPath,
      deleted_at: null,
      created_at: new Date().toISOString(),
      reactions: {},
    };

    const roomSockets = io.sockets.adapter.rooms.get(room);
    const peerInRoom = roomSockets && Array.from(roomSockets).some(sid => {
      const s = io.sockets.sockets.get(sid);
      const sEmail = s?.request?.session?.activeAccount || s?.request?.session?.accounts?.[0]?.email;
      return sEmail === peerEmail;
    });

    //io.to(room).emit('chat_message', { room, message: msg });
    io.to(room).emit('chat_message', { room, message: msg, peer: peerEmail });

    if (!peerInRoom) {
      io.to(`inbox:${peerEmail}`).emit('chat_message', { room, message: msg, peer: myEmail });
    }

    logger.app(myEmail, 'INFO', `Chat -> ${peerEmail} [${mediaType || 'text'}]`);
  } catch (e) {
    socket.emit('chat_error', { error: e.message || 'Erreur envoi' });
    logger.app(myEmail, 'ERROR', `Chat save: ${e.message}`);
  }
});

    socket.on('chat_leave', ({ myEmail, peerEmail }) => {
      const room = roomId(myEmail, peerEmail);
      socket.leave(room);
      joinedRooms.delete(room);
    });

    socket.on('chat_typing', ({ myEmail, peerEmail, typing }) => {
      if (!session?.accounts?.find(a => a.email === myEmail)) return;
      const room = roomId(myEmail, peerEmail);
      const roomSockets = io.sockets.adapter.rooms.get(room);
      if (roomSockets) {
        roomSockets.forEach(sid => {
          const s = io.sockets.sockets.get(sid);
          if (!s || s.id === socket.id) return;
          s.emit('chat_typing', { from: myEmail, typing });
        });
      }
      socket.to(`inbox:${peerEmail}`).emit('chat_typing', { from: myEmail, typing });
    });

    socket.on('chat_react', async ({ myEmail, peerEmail, msgId, emoji }) => {
      if (!session?.accounts?.find(a => a.email === myEmail)) return;
      const room = roomId(myEmail, peerEmail);
      try {
        const reactions = await addReaction(msgId, myEmail, emoji);
        io.to(room).emit('chat_reaction', { msgId, reactions });
        socket.to(`inbox:${peerEmail}`).emit('chat_reaction', { msgId, reactions });
      } catch(e) { logger.app(myEmail, 'ERROR', `React: ${e.message}`); }
    });

    socket.on('chat_unreact', async ({ myEmail, peerEmail, msgId, emoji }) => {
      if (!session?.accounts?.find(a => a.email === myEmail)) return;
      const room = roomId(myEmail, peerEmail);
      try {
        const reactions = await removeReaction(msgId, myEmail, emoji);
        io.to(room).emit('chat_reaction', { msgId, reactions });
        socket.to(`inbox:${peerEmail}`).emit('chat_reaction', { msgId, reactions });
      } catch(e) {}
    });

    socket.on('chat_delete', async ({ myEmail, peerEmail, msgId }) => {
      if (!session?.accounts?.find(a => a.email === myEmail)) return;
      const room = roomId(myEmail, peerEmail);
      try {
        await deleteMessage(msgId, myEmail);
        io.to(room).emit('chat_deleted', { msgId });
        socket.to(`inbox:${peerEmail}`).emit('chat_deleted', { msgId });
      } catch(e) { socket.emit('chat_error', { error: 'Impossible de supprimer' }); }
    });

    socket.on('disconnect', () => {
      if (timer) { clearInterval(timer); timer = null; }
      joinedRooms.forEach(r => socket.leave(r));
      for (const [mid, waiting] of waitingRooms) {
        if (waiting?.has(socket.id)) {
          waiting.delete(socket.id);
          emitWaitingRoomList(io, mid);
        }
      }
      if (socket.data.meetingId) {
        const meetingId = socket.data.meetingId;
        const room = `meeting:${meetingId}`;
        const stat = touchParticipantStat(meetingId, socket);
        if (stat.speakingSince) { stat.speakingMs = (stat.speakingMs || 0) + (Date.now() - stat.speakingSince); stat.speakingSince = null; }
        emitParticipationStats(io, meetingId);
        socket.to(room).emit('meeting_peer_left', { socketId: socket.id });

        // ── Nettoyage SFU : fermer le peer et notifier les consumers ──────────
        try {
          const closedProducerIds = closePeer(meetingId, socket.id);
          for (const producerId of closedProducerIds) {
            io.to(room).emit('sfu:producerClosed', { producerId });
          }
        } catch (e) {
          console.error('[SFU] closePeer error on disconnect:', e.message);
        }
      }
    });

    // ── WEBRTC SIGNALING (réunions) ───────────────────

    function admitParticipant(meetingId, participantEmail, participantName, isHost = false) {
      const room = `meeting:${meetingId}`;
      const normalizedEmail = String(participantEmail || '').trim().toLowerCase();
      const existingSock = findSocketByEmail(io, meetingId, normalizedEmail);
      if (existingSock && existingSock.id !== socket.id) forceCleanupParticipant(io, meetingId, existingSock, 'rejoin');
      socket.join(room);
      socket.data.meetingId    = meetingId;
      socket.data.meetingEmail = normalizedEmail;
      socket.data.displayName  = participantName;
      socket.data.isHost       = !!isHost;
      socket.data.isCatalyst   = !isHost && getMeetingCatalystSet(meetingId).has(normalizedEmail);
      socket.data.waiting      = false;
      touchParticipantStat(meetingId, socket);
      if (isHost) ensureMeetingSession(io, meetingId);

      if (!approvedParticipants.has(meetingId)) approvedParticipants.set(meetingId, new Set());
      approvedParticipants.get(meetingId).add(normalizedEmail);
      const permissions = setParticipantPermissions(meetingId, normalizedEmail, getParticipantPermissions(meetingId, normalizedEmail));
      setRejoinState(meetingId, normalizedEmail, 'active');

      socket.to(room).emit('meeting_peer_joined', {
        socketId: socket.id, email: normalizedEmail, displayName: participantName,
      });

      const roomSockets = io.sockets.adapter.rooms.get(room);
      const peers = [];
      if (roomSockets) {
        roomSockets.forEach(sid => {
          if (sid === socket.id) return;
          const s = io.sockets.sockets.get(sid);
          if (s) peers.push({ socketId: sid, email: s.data.meetingEmail || '', displayName: s.data.displayName || '', isSharing: s.data.isSharing || false, isCatalyst: !!s.data.isCatalyst });
        });
      }
      socket.emit('meeting_peers_list', { peers, permissions, rejoinState: getRejoinState(meetingId, normalizedEmail) });
      socket.emit('meeting_permissions_sync', { permissions, targetEmail: normalizedEmail, socketId: socket.id, mine: true });

      const notes = meetingNotes.get(meetingId);
      if (notes?.content) socket.emit('notes_state', { content: notes.content, revision: notes.revision });
      getOrLoadMeetingChatHistory(meetingId).then(history => { if (history.length) socket.emit('meeting_chat_history', { messages: history }); }).catch(() => {});

      const wbState = wbStates.get(meetingId);
      if (wbState) setTimeout(() => socket.emit('wb_state', wbState), 800);
      if (isHost) emitMeetingTimerSync(io, meetingId);
      else emitMeetingTimerSync(io, meetingId, socket);
      emitParticipationStats(io, meetingId);
      if (socket.data.isCatalyst) setTimeout(() => syncCatalystRole(io, meetingId, socket, true), 250);
      emitAdminSnapshot(io, meetingId, socket);
    }

    socket.on('meeting_join', async ({ meetingId, email, displayName, isHost, bypassWaiting, accessCode, message }) => {
      const participantEmail = String(email || sessionEmail || `guest-${socket.id.slice(0,6)}`).trim().toLowerCase();
      const participantName  = displayName || participantEmail;
      const identity = getSocketIdentity(socket, participantEmail);
      const waiting = waitingRooms.get(meetingId);
      const waitAttempts = Array.from(waiting?.values?.() || []).filter(w => String(w.email || '').trim().toLowerCase() === participantEmail).length + 1;
      const lock = getMeetingLock(meetingId);
      const tempExpelled = isTempExpelled(meetingId, identity);
      const rejoinState = getRejoinState(meetingId, participantEmail);
      const meetingMeta = await getMeetingMeta(meetingId);

      if (!meetingMeta || meetingMeta.status === 'ended') {
        return socket.emit('waiting_room_rejected', { reason: "Cette réunion n'est plus disponible." });
      }

      if (!isHost && meetingMeta.access === 'code') {
        const providedCode = String(accessCode || '').trim();
        const validCode = providedCode && String(meetingMeta.code || '').trim() === providedCode;
        const alreadyApproved = approvedParticipants.get(meetingId)?.has(participantEmail);
        if (!validCode && !alreadyApproved) {
          return socket.emit('waiting_room_rejected', { reason: "Code d'accès incorrect." });
        }
      }

      if (isMeetingBanned(meetingId, identity)) {
        setRejoinState(meetingId, participantEmail, 'banned');
        return socket.emit('meeting_banned', { reason: "Vous n'êtes pas autorisé à rejoindre cette réunion." });
      }
      if (tempExpelled) {
        setRejoinState(meetingId, participantEmail, 'expelled');
        return socket.emit('meeting_temp_expelled', { until: tempExpelled.until, mode: tempExpelled.mode || 'temporary', manual: !!tempExpelled.manual });
      }

      if (isHost) {
        admitParticipant(meetingId, participantEmail, participantName, true);
        emitWaitingRoomList(io, meetingId);
        emitAdminSnapshot(io, meetingId, socket);
        return;
      }

      const approved = approvedParticipants.get(meetingId);
      if (bypassWaiting && approved?.has(participantEmail) && !['waiting','removed','banned','expelled'].includes(rejoinState || '') && meetingMeta?.access !== 'code') {
        admitParticipant(meetingId, participantEmail, participantName, false);
        return;
      }

      const room = `meeting:${meetingId}`;
      const roomSockets = io.sockets.adapter.rooms.get(room);
      const noActiveRoom = !roomSockets || roomSockets.size === 0;
      const mustRefuse = !noActiveRoom && lock.locked && lock.mode === 'refuse';
      const mustWait = !noActiveRoom && (lock.locked || rejoinState === 'waiting' || !approved?.has(participantEmail) || meetingMeta?.access === 'code');

      if (!mustWait && !mustRefuse) {
        admitParticipant(meetingId, participantEmail, participantName, false);
        return;
      }
      if (mustRefuse) {
        return socket.emit('waiting_room_rejected', { reason: 'La réunion est verrouillée.' });
      }

      upsertWaitingParticipant(meetingId, {
        socketId: socket.id,
        email: participantEmail,
        displayName: participantName,
        joinedAt: new Date().toISOString(),
        attempts: waitAttempts,
        message: String(message || '').trim().slice(0, 160),
      });
      socket.data.meetingId    = meetingId;
      socket.data.meetingEmail = participantEmail;
      socket.data.displayName  = participantName;
      socket.data.waiting      = true;
      setRejoinState(meetingId, participantEmail, 'waiting');
      socket.emit('waiting_room_entered', cleanWaitingEntry(waitingRooms.get(meetingId).get(socket.id)));
      const waitEntry = cleanWaitingEntry(waitingRooms.get(meetingId).get(socket.id));
      socket.to(room).emit('waiting_room_knock', waitEntry);
      emitWaitingRoomList(io, meetingId);
    });

    socket.on('waiting_room_admit', ({ meetingId, targetSocketId }) => {
      const room    = `meeting:${meetingId}`;
      const waiting = waitingRooms.get(meetingId);
      if (!socketHasControlPower(meetingId, socket)) return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent gérer la salle d'attente." });
      if (!waiting?.has(targetSocketId)) return;

      const participant = cleanWaitingEntry(waiting.get(targetSocketId));
      waiting.delete(targetSocketId);

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return;

      targetSocket.data.waiting = false;
      forceCleanupParticipant(io, meetingId, targetSocket, 'readmit');

      const pEmail = String(participant.email || '').trim().toLowerCase();
      const pName  = participant.displayName;

      targetSocket.join(room);
      targetSocket.data.meetingId    = meetingId;
      targetSocket.data.meetingEmail = pEmail;
      targetSocket.data.displayName  = pName;
      targetSocket.data.isCatalyst   = getMeetingCatalystSet(meetingId).has(pEmail);
      touchParticipantStat(meetingId, targetSocket);

      if (!approvedParticipants.has(meetingId)) approvedParticipants.set(meetingId, new Set());
      approvedParticipants.get(meetingId).add(pEmail);

      targetSocket.to(room).emit('meeting_peer_joined', { socketId: targetSocketId, email: pEmail, displayName: pName });

      const roomSockets = io.sockets.adapter.rooms.get(room);
      const peers = [];
      if (roomSockets) {
        roomSockets.forEach(sid => {
          if (sid === targetSocketId) return;
          const s = io.sockets.sockets.get(sid);
          if (s && !s.data.waiting) peers.push({ socketId: sid, email: s.data.meetingEmail || '', displayName: s.data.displayName || '', isSharing: s.data.isSharing || false, isCatalyst: !!s.data.isCatalyst });
        });
      }
      const permissions = getParticipantPermissions(meetingId, pEmail);
      targetSocket.emit('meeting_peers_list', { peers, permissions, rejoinState: 'active' });
      targetSocket.emit('meeting_permissions_sync', { permissions, targetEmail: pEmail, socketId: targetSocket.id, mine: true });
      const notes = meetingNotes.get(meetingId);
      if (notes?.content) targetSocket.emit('notes_state', { content: notes.content, revision: notes.revision });
      getOrLoadMeetingChatHistory(meetingId).then(history => { if (history.length) targetSocket.emit('meeting_chat_history', { messages: history }); }).catch(() => {});

      const wbStateAdmit = wbStates.get(meetingId);
      if (wbStateAdmit) setTimeout(() => targetSocket.emit('wb_state', wbStateAdmit), 800);
      emitMeetingTimerSync(io, meetingId, targetSocket);
      emitParticipationStats(io, meetingId);
      if (targetSocket.data.isCatalyst) setTimeout(() => syncCatalystRole(io, meetingId, targetSocket, true), 250);

      setRejoinState(meetingId, pEmail, 'active');
      addAdminLog(io, meetingId, socket, 'admitted', pName, participant.message ? `Message: ${participant.message}` : '');
      socket.emit('waiting_room_admitted', { socketId: targetSocketId, displayName: pName });
      emitWaitingRoomList(io, meetingId);
    });

    socket.on('waiting_room_reject', ({ meetingId, targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent gérer la salle d'attente." });
      const waiting = waitingRooms.get(meetingId);
      if (waiting) waiting.delete(targetSocketId);
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      const targetEmail = targetSocket?.data?.meetingEmail || '';
      if (targetEmail) setRejoinState(meetingId, targetEmail, 'removed');
      if (targetSocket) targetSocket.emit('waiting_room_rejected');
      addAdminLog(io, meetingId, socket, 'rejected_waiting', targetSocket?.data?.displayName || targetSocketId, '');
      emitWaitingRoomList(io, meetingId);
    });

    socket.on('meeting_admin_waiting', ({ meetingId, targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId || targetSocket.data.isHost) return;
      const waiting = waitingRooms.get(meetingId) || new Map();
      waitingRooms.set(meetingId, waiting);
      const entry = cleanWaitingEntry({ socketId: targetSocket.id, email: targetSocket.data.meetingEmail || '', displayName: targetSocket.data.displayName || 'Participant', joinedAt: new Date().toISOString(), attempts: 1, message: '' });
      waiting.set(targetSocket.id, entry);
      if (approvedParticipants.has(meetingId)) approvedParticipants.get(meetingId).delete(entry.email);
      removeSocketFromMeeting(io, targetSocket, meetingId);
      targetSocket.data.waiting = true;
      setRejoinState(meetingId, entry.email, 'waiting');
      targetSocket.emit('meeting_waiting_moved', { reason: "L'administrateur vous a déplacé en salle d'attente." });
      addAdminLog(io, meetingId, socket, 'moved_to_waiting', entry.displayName, '');
      emitWaitingRoomList(io, meetingId);
    });

    socket.on('meeting_admin_remove', ({ meetingId, targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId || targetSocket.data.isHost) return;
      const email = targetSocket.data.meetingEmail || '';
      if (approvedParticipants.has(meetingId)) approvedParticipants.get(meetingId).delete(email);
      setRejoinState(meetingId, email, 'removed');
      removeSocketFromMeeting(io, targetSocket, meetingId);
      targetSocket.emit('meeting_removed', { reason: "L'administrateur vous a retiré de la réunion." });
      addAdminLog(io, meetingId, socket, 'removed', targetSocket.data.displayName || email, '');
    });

    socket.on('meeting_admin_ban', ({ meetingId, targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId || targetSocket.data.isHost) return;
      const identity = getSocketIdentity(targetSocket, targetSocket.data.meetingEmail || '');
      addMeetingBan(meetingId, identity);
      if (approvedParticipants.has(meetingId)) approvedParticipants.get(meetingId).delete(identity.email);
      setRejoinState(meetingId, identity.email, 'banned');
      removeSocketFromMeeting(io, targetSocket, meetingId);
      targetSocket.emit('meeting_banned', { reason: "L'administrateur vous a banni de la réunion." });
      addAdminLog(io, meetingId, socket, 'banned', targetSocket.data.displayName || identity.email, '');
    });

    socket.on('meeting_admin_lock', ({ meetingId, locked, mode }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const state = setMeetingLock(meetingId, locked, mode);
      io.to(`meeting:${meetingId}`).emit('meeting_lock_state', state);
      addAdminLog(io, meetingId, socket, state.locked ? 'meeting_locked' : 'meeting_unlocked', '', state.mode);
    });

    socket.on('meeting_admin_permissions', ({ meetingId, targetSocketId, patch }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId || targetSocket.data.isHost) return;
      const email = String(targetSocket.data.meetingEmail || '').trim().toLowerCase();
      const permissions = setParticipantPermissions(meetingId, email, patch || {});
      targetSocket.emit('meeting_permissions_sync', { permissions, targetEmail: email, socketId: targetSocket.id, mine: true });
      targetSocket.to(`meeting:${meetingId}`).emit('meeting_permissions_sync', { permissions, targetEmail: email, socketId: targetSocket.id, mine: false });
      if (permissions.forceMuted) io.to(targetSocket.id).emit('host_mute', { forced: true });
      if (!permissions.canUseCamera) io.to(targetSocket.id).emit('meeting_disable_camera');
      if (!permissions.canShareScreen) io.to(targetSocket.id).emit('meeting_disable_screen_share');
      addAdminLog(io, meetingId, socket, 'permissions_updated', targetSocket.data.displayName || email, Object.keys(patch || {}).join(', '));
    });

    socket.on('meeting_admin_mute_all', ({ meetingId, locked }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const roomSockets = io.sockets.adapter.rooms.get(`meeting:${meetingId}`) || [];
      Array.from(roomSockets).forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (!s || s.id === socket.id || s.data?.isHost) return;
        const email = String(s.data?.meetingEmail || '').trim().toLowerCase();
        const permissions = setParticipantPermissions(meetingId, email, { forceMuted: true, canUnmute: !locked });
        s.emit('meeting_permissions_sync', { permissions, targetEmail: email, socketId: s.id, mine: true });
        s.emit('host_mute', { forced: true });
      });
      io.to(`meeting:${meetingId}`).emit('meeting_admin_mute_all_done', { locked: !!locked });
      addAdminLog(io, meetingId, socket, 'mute_all', '', locked ? 'locked' : 'simple');
    });

    socket.on('meeting_admin_allow_speak', ({ meetingId, targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return;
      targetSocket.emit('meeting_allow_to_speak', { by: socket.data.displayName || socket.data.meetingEmail || 'Admin' });
      addAdminLog(io, meetingId, socket, 'allowed_to_speak', targetSocket.data.displayName || targetSocket.data.meetingEmail, '');
    });

    socket.on('meeting_admin_temp_expel', ({ meetingId, targetSocketId, durationMinutes, untilEnd, manualApproval }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId || targetSocket.data.isHost) return;
      const identity = getSocketIdentity(targetSocket, targetSocket.data.meetingEmail || '');
      const entry = addTempExpulsion(meetingId, identity, { until: untilEnd ? 'end' : (Date.now() + Math.max(1, parseInt(durationMinutes || 10, 10)) * 60000), mode: untilEnd ? 'until_end' : 'temporary', manual: !!manualApproval });
      if (approvedParticipants.has(meetingId)) approvedParticipants.get(meetingId).delete(identity.email);
      setRejoinState(meetingId, identity.email, 'expelled');
      removeSocketFromMeeting(io, targetSocket, meetingId);
      targetSocket.emit('meeting_temp_expelled', { until: entry.until, mode: entry.mode, manual: entry.manual });
      addAdminLog(io, meetingId, socket, 'temp_expelled', targetSocket.data.displayName || identity.email, entry.manual ? 'manual approval' : String(entry.until));
    });

    socket.on('meeting_admin_log_get', ({ meetingId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      socket.emit('meeting_admin_log_sync', { logs: getMeetingAdminLog(meetingId) });
      socket.emit('meeting_lock_state', getMeetingLock(meetingId));
    });

    socket.on('meeting_role_set', ({ meetingId, targetSocketId, enabled }) => {
      if (!socket.data.isHost) return socket.emit('meeting_role_error', { error: "Seul l'hôte peut attribuer les clés Catalyst." });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.meetingId !== meetingId) return socket.emit('meeting_role_error', { error: 'Participant introuvable.' });
      if (targetSocket.data.isHost) return socket.emit('meeting_role_error', { error: "L'hôte possède déjà tous les droits." });
      const set = getMeetingCatalystSet(meetingId);
      if (enabled) set.add(targetSocket.data.meetingEmail);
      else set.delete(targetSocket.data.meetingEmail);
      syncCatalystRole(io, meetingId, targetSocket, !!enabled);
      emitParticipationStats(io, meetingId);
      socket.emit('meeting_role_sync', {
        socketId: targetSocket.id,
        email: targetSocket.data.meetingEmail || '',
        displayName: targetSocket.data.displayName || '',
        role: 'catalyst',
        enabled: !!enabled,
        mine: false,
      });
      addAdminLog(io, meetingId, socket, enabled ? 'catalyst_granted' : 'catalyst_removed', targetSocket.data.displayName || targetSocket.data.meetingEmail, '');
    });

    socket.on('meeting_leave', ({ meetingId }) => {
      const room = `meeting:${meetingId}`;
      // Nettoyage SFU propre
      try {
        const closedProducerIds = closePeer(meetingId, socket.id);
        for (const producerId of closedProducerIds) {
          io.to(room).emit('sfu:producerClosed', { producerId });
        }
      } catch (e) {}
      socket.leave(room);
      socket.to(room).emit('meeting_peer_left', { socketId: socket.id });
    });

    // ── Signaling P2P supprimé : meeting_offer / meeting_answer / meeting_ice ──
    // Ces événements sont remplacés par les événements SFU ci-dessous.

    // ── Signaling SFU mediasoup ───────────────────────────────────────────────

    /**
     * Récupérer les routerRtpCapabilities de la room.
     * Le client en a besoin pour charger son Device.
     */
    socket.on('sfu:getRouterRtpCapabilities', async ({ meetingId }, callback) => {
      try {
        const room = await ensureRoom(meetingId);
        callback({ routerRtpCapabilities: room.router.rtpCapabilities });
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Le client rejoint la room SFU et reçoit la liste des producers existants.
     */
    socket.on('sfu:join', async ({ meetingId }, callback) => {
      try {
        await ensureRoom(meetingId);
        // Lister tous les producers actifs sauf ceux du client lui-même
        const producers = listProducers(meetingId, socket.id);
        callback({ producers });
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Créer un transport WebRTC (send ou recv).
     */
    socket.on('sfu:createTransport', async ({ meetingId, direction }, callback) => {
      try {
        const meta = {
          email:       socket.data.meetingEmail || '',
          displayName: socket.data.displayName  || socket.data.meetingEmail || socket.id,
          isHost:      !!socket.data.isHost,
          isCatalyst:  !!socket.data.isCatalyst,
        };
        const params = await createWebRtcTransport(meetingId, socket.id, direction, meta);
        callback(params);
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Connecter un transport (phase DTLS).
     */
    socket.on('sfu:connectTransport', async ({ meetingId, transportId, dtlsParameters }, callback) => {
      try {
        await connectTransport(meetingId, socket.id, transportId, dtlsParameters);
        callback({});
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Créer un producer (audio / caméra / écran).
     * Après création, notifier tous les autres membres de la room.
     */
    socket.on('sfu:produce', async ({ meetingId, transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const summary = await createProducer(meetingId, socket.id, transportId, kind, rtpParameters, appData || {});
        // Retourner l'ID du producer au client
        callback({ producerId: summary.producerId });

        // Notifier les autres participants
        const room = `meeting:${meetingId}`;
        socket.to(room).emit('sfu:newProducer', {
          producerId:  summary.producerId,
          peerId:      socket.id,
          source:      summary.source,
          kind:        summary.kind,
          email:       summary.email,
          displayName: summary.displayName,
        });
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Créer un consumer (côté receveur).
     */
    socket.on('sfu:consume', async ({ meetingId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        const params = await createConsumer(meetingId, socket.id, transportId, producerId, rtpCapabilities);
        callback(params);
      } catch (e) {
        callback({ error: e.message });
      }
    });

    /**
     * Résumer un consumer (appelé après que le client a reçu le consumer).
     */
    socket.on('sfu:resumeConsumer', async ({ meetingId, consumerId }, callback) => {
      try {
        await resumeConsumer(meetingId, socket.id, consumerId);
        if (callback) callback({});
      } catch (e) {
        if (callback) callback({ error: e.message });
      }
    });

    /**
     * Simulcast : demander une couche de qualité précise pour un consumer
     * donné (ex: haute qualité pour le participant épinglé, basse qualité
     * pour les autres). Échoue silencieusement si le producer sous-jacent
     * n'est pas en simulcast (rien à faire dans ce cas).
     */
    socket.on('sfu:setPreferredLayers', async ({ meetingId, consumerId, spatialLayer }, callback) => {
      try {
        await setConsumerPreferredLayers(meetingId, socket.id, consumerId, spatialLayer);
        if (callback) callback({});
      } catch (e) {
        if (callback) callback({ error: e.message });
      }
    });

    /**
     * Pause d'un producer local (ex: mute micro).
     */
    socket.on('sfu:pauseProducer', async ({ meetingId, producerId }, callback) => {
      try {
        await pauseProducer(meetingId, socket.id, producerId);
        if (callback) callback({});
      } catch (e) {
        if (callback) callback({ error: e.message });
      }
    });

    /**
     * Reprise d'un producer local (ex: unmute micro).
     */
    socket.on('sfu:resumeProducer', async ({ meetingId, producerId }, callback) => {
      try {
        await resumeProducer(meetingId, socket.id, producerId);
        if (callback) callback({});
      } catch (e) {
        if (callback) callback({ error: e.message });
      }
    });

    /**
     * Fermeture explicite d'un producer (ex: arrêt partage d'écran).
     */
    socket.on('sfu:closeProducer', async ({ meetingId, producerId }, callback) => {
      try {
        await closeProducer(meetingId, socket.id, producerId);
        const room = `meeting:${meetingId}`;
        io.to(room).emit('sfu:producerClosed', { producerId });
        if (callback) callback({});
      } catch (e) {
        if (callback) callback({ error: e.message });
      }
    });

    // ── Lever la main ─────────────────────────────────────────────────────────
    socket.on('meeting_hand_raise', ({ meetingId, raised }) => {
      const room = `meeting:${meetingId}`;
      const stat = touchParticipantStat(meetingId, socket);
      if (raised) stat.handRaises = (stat.handRaises || 0) + 1;
      emitParticipationStats(io, meetingId);
      socket.to(room).emit('meeting_hand_raise', {
        socketId: socket.id,
        email: socket.data.meetingEmail,
        displayName: socket.data.displayName,
        raised,
      });
    });

    // ── Statut micro / caméra ─────────────────────────────────────────────────
    socket.on('meeting_media_state', ({ meetingId, mic, camera }) => {
      const perms   = getParticipantPermissions(meetingId, socket.data.meetingEmail || '');
      const safeMic = perms.forceMuted ? false : !!mic;
      const safeCam = perms.canUseCamera && !perms.readOnly ? !!camera : false;
      const room    = `meeting:${meetingId}`;
      socket.to(room).emit('meeting_media_state', { socketId: socket.id, mic: safeMic, camera: safeCam });
    });

    // ── Chat / upload ─────────────────────────────────────────────────────────
    socket.on('meeting_chat_upload_init', ({ meetingId, uploadId, fileName, fileType, totalChunks, fileSize }, ack) => {
      try {
        if (!meetingId || !uploadId || !fileName || !totalChunks) throw new Error('Paramètres upload manquants');
        if ((fileSize || 0) > 15 * 1024 * 1024) throw new Error('Fichier trop volumineux (max 15 Mo)');
        meetingUploadChunks.set(uploadId, {
          meetingId,
          originalname: fileName,
          mimetype: fileType,
          totalChunks,
          fileSize: fileSize || 0,
          socketId: socket.id,
          received: 0,
          chunks: new Array(totalChunks),
        });
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message || "Impossible de préparer l'upload" });
      }
    });

    socket.on('meeting_chat_upload_chunk', ({ uploadId, index, data }, ack) => {
      try {
        const upload = meetingUploadChunks.get(uploadId);
        if (!upload) throw new Error('Session upload introuvable');
        if (index < 0 || index >= upload.totalChunks) throw new Error('Chunk invalide');
        if (!data) throw new Error('Chunk vide');
        if (!upload.chunks[index]) upload.received++;
        upload.chunks[index] = Buffer.from(data, 'base64');
        if (typeof ack === 'function') ack({ ok: true, received: upload.received, totalChunks: upload.totalChunks });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message || 'Chunk refusé' });
      }
    });

    socket.on('meeting_chat_upload_complete', ({ uploadId }, ack) => {
      try {
        const upload = meetingUploadChunks.get(uploadId);
        if (!upload) throw new Error('Session upload introuvable');
        const missing = upload.chunks.some(chunk => !chunk);
        if (missing) throw new Error('Upload incomplet');
        const file = finalizeMeetingChunkUpload(upload);
        meetingUploadChunks.delete(uploadId);
        if (typeof ack === 'function') ack({ ok: true, ...file });
      } catch (e) {
        meetingUploadChunks.delete(uploadId);
        if (typeof ack === 'function') ack({ ok: false, error: e.message || 'Finalisation échouée' });
      }
    });

    /**
     * Sous-titres en direct : relaie le texte transcrit localement par UN
     * participant (Web Speech API, voir meeting-captions.js côté client) à
     * tout le monde dans la réunion, avec son nom d'affichage.
     */
    socket.on('caption_text', ({ meetingId, text, isFinal }) => {
      if (!meetingId || typeof text !== 'string' || !text.trim()) return;
      io.to(`meeting:${meetingId}`).emit('caption_text', {
        name: socket.data.displayName || 'Un participant',
        text: text.trim().slice(0, 500),
        isFinal: !!isFinal,
      });
      if (isFinal && socket.data?.meetingId === meetingId && !socket.data?.waiting) {
        meetingAiSummary.addCaption(meetingId, socket.data.displayName, text);
      }
    });

    // ── Compte-rendu IA : l'hôte active la transcription, tout le monde en est informé ──
    socket.on('ai_summary_toggle', ({ meetingId, on } = {}) => {
      if (!socket.data?.isHost || socket.data.meetingId !== meetingId) return;
      if (on) meetingAiSummary.enable(meetingId, socket.data.meetingEmail); else meetingAiSummary.disable(meetingId);
      io.to(`meeting:${meetingId}`).emit('ai_summary_state', { on: !!on, by: socket.data.displayName || 'L\'hôte' });
    });
    socket.on('ai_summary_get', ({ meetingId } = {}) => {
      if (!meetingId || socket.data?.meetingId !== meetingId) return;
      socket.emit('ai_summary_state', { on: meetingAiSummary.isEnabled(meetingId), silent: true });
    });

    socket.on('meeting_chat', async ({ meetingId, text, anonymous, fileUrl, fileName, fileSize, fileType, fileId }) => {
      const room = `meeting:${meetingId}`;
      const perms = getParticipantPermissions(meetingId, socket.data.meetingEmail || '');
      if (!perms.canChat || perms.readOnly) return socket.emit('meeting_permission_denied', { feature: 'chat' });
      const msg = {
        email: socket.data.meetingEmail || '',
        displayName: socket.data.displayName || '',
        text: typeof text === 'string' ? text.trim().slice(0, 2000) : null,
        anonymous: !!anonymous,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        fileSize: fileSize || null,
        fileType: fileType || null,
        fileId: fileId || null,
        at: new Date().toISOString(),
      };
      if (!msg.text && !msg.fileUrl) return;
      let id = null;
      try { id = await persistMeetingChatMessage(meetingId, msg); } catch (_) {}
      const history = meetingChatHistory.get(meetingId) || [];
      history.push({ ...msg, id });
      meetingChatHistory.set(meetingId, history);
      io.to(room).emit('meeting_chat', { id, ...msg });
    });

    // ── Partage d'écran (état UI uniquement — le flux est géré par SFU) ───────
    socket.on('meeting_screen_share', ({ meetingId, sharing }) => {
      socket.data.isSharing = !!sharing;
      socket.to(`meeting:${meetingId}`).emit('meeting_screen_share', { socketId: socket.id, sharing });
    });

    // ── Notes collaboratives ──────────────────────────────────────────────────
    socket.on('notes_update', ({ meetingId, content: noteContent, revision, author, cursor }) => {
      meetingNotes.set(meetingId, { content: noteContent, revision, updatedAt: Date.now() });
      socket.to(`meeting:${meetingId}`).emit('notes_update', {
        content: noteContent,
        revision,
        author,
        cursor,
      });
      socket.emit('notes_ack');
    });

    // ── Minuteur de parole ───────────────────────────────────────────────────
    socket.on('speech_start', ({ meetingId }) => {
      const stat = touchParticipantStat(meetingId, socket);
      if (!stat.speakingSince) {
        stat.speakingSince = Date.now();
        stat.speechTurns = (stat.speechTurns || 0) + 1;
      }
      emitParticipationStats(io, meetingId);
      socket.to(`meeting:${meetingId}`).emit('speech_start', { socketId: socket.id });
    });

    socket.on('speech_stop', ({ meetingId }) => {
      const stat = touchParticipantStat(meetingId, socket);
      if (stat.speakingSince) {
        stat.speakingMs = (stat.speakingMs || 0) + (Date.now() - stat.speakingSince);
        stat.speakingSince = null;
      }
      emitParticipationStats(io, meetingId);
      socket.to(`meeting:${meetingId}`).emit('speech_stop', { socketId: socket.id });
    });

    socket.on('speech_limit', ({ meetingId, limit }) => {
      socket.to(`meeting:${meetingId}`).emit('speech_limit', { limit });
    });

    // ── Sondage ─────────────────────────────────────────────────────────────
    socket.on('poll_launch', ({ meetingId, question, options }) => {
      if (!socketHasControlPower(meetingId, socket)) {
        return socket.emit('poll_error', { error: "Seuls l'hôte et les Catalyst peuvent lancer un sondage." });
      }

      const room = `meeting:${meetingId}`;
      if (!socket.data?.isHost) {
        socket.emit('poll_error', { action: 'launch', error: "Seul l'hôte peut lancer un sondage." });
        return;
      }

      const activePoll = meetingPolls.get(meetingId);
      if (activePoll && !activePoll.closed) {
        socket.emit('poll_error', { action: 'launch', error: 'Un sondage est déjà en cours.' });
        socket.emit('poll_sync', getActivePollSnapshot(activePoll));
        return;
      }

      const roomSockets = Array.from(io.sockets.adapter.rooms.get(room) || [])
        .map(sid => io.sockets.sockets.get(sid))
        .filter(Boolean);
      const participantIds = roomSockets
        .filter(s => !s.data?.isHost)
        .map(s => s.id);

      const poll = {
        id: Date.now().toString(),
        question,
        options,
        votes: new Array(options.length).fill(0),
        voters: new Set(),
        participantIds,
        expectedVotes: participantIds.length,
        allAnswered: false,
        closed: false,
        hostSocketId: socket.id,
      };

      meetingPolls.set(meetingId, poll);
      roomSockets.forEach(s => { s.data.activePollId = poll.id; });
      io.to(room).emit('poll_launched', getActivePollSnapshot(poll));
    });

    socket.on('poll_vote', ({ meetingId, pollId, optionIndex }) => {
      const room = `meeting:${meetingId}`;
      const poll = meetingPolls.get(meetingId);
      if (!poll || poll.id !== pollId || poll.closed) return;
      if (!Array.isArray(poll.options) || optionIndex < 0 || optionIndex >= poll.options.length) return;
      if (socket.data?.isHost) return;
      if (poll.voters.has(socket.id)) return;

      poll.voters.add(socket.id);
      poll.votes[optionIndex] = (poll.votes[optionIndex] || 0) + 1;

      const receivedVotes = poll.voters.size;
      const expectedVotes = poll.expectedVotes || 0;
      const allAnswered = expectedVotes > 0 && receivedVotes >= expectedVotes;
      poll.allAnswered = allAnswered;

      io.to(room).emit('poll_update', getActivePollSnapshot(poll));

      if (allAnswered) {
        const hostSocket = io.sockets.sockets.get(poll.hostSocketId) ||
          Array.from(io.sockets.adapter.rooms.get(room) || [])
            .map(sid => io.sockets.sockets.get(sid))
            .find(sock => sock?.data?.isHost);
        if (hostSocket) hostSocket.emit('poll_all_answered', getActivePollSnapshot(poll));
      }
    });

    socket.on('poll_end', ({ meetingId, pollId }) => {
      if (!socketHasControlPower(meetingId, socket)) {
        return socket.emit('poll_error', { error: "Seuls l'hôte et les Catalyst peuvent terminer un sondage." });
      }

      const room = `meeting:${meetingId}`;
      const poll = meetingPolls.get(meetingId);
      if (!socket.data?.isHost) {
        socket.emit('poll_error', { action: 'end', error: "Seul l'hôte peut terminer le sondage." });
        return;
      }
      if (!poll || poll.closed) {
        socket.emit('poll_error', { action: 'end', error: 'Aucun sondage actif à terminer.' });
        return;
      }
      if (pollId && poll.id !== pollId) {
        socket.emit('poll_error', { action: 'end', error: "Ce sondage n'est plus actif." });
        socket.emit('poll_sync', getActivePollSnapshot(poll));
        return;
      }

      poll.closed = true;
      io.to(room).emit('poll_results', getActivePollSnapshot(poll));
      meetingPolls.delete(meetingId);
      io.sockets.adapter.rooms.get(room)?.forEach(sid => {
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.data.activePollId = null;
      });
    });

    // ── Statut enregistrement ───────────────────────────────────────────────
    socket.on('recording_status', ({ meetingId, active }) => {
      const room = `meeting:${meetingId}`;
      const payload = {
        socketId: socket.id,
        displayName: socket.data?.displayName || socket.data?.email || 'Un participant',
        active: !!active,
      };
      io.to(room).emit('recording_status', payload);
    });

    // ── Tableau blanc ────────────────────────────────────────────────────────
    socket.on('wb_draw', ({ meetingId, ...data }) => {
      const meta = socketWhiteboardIdentity(socket);
      socket.to(`meeting:${meetingId}`).emit('wb_draw', { ...data, ...meta });
    });

    socket.on('wb_shape', ({ meetingId, ...data }) => {
      const meta = socketWhiteboardIdentity(socket);
      socket.to(`meeting:${meetingId}`).emit('wb_shape', { ...data, ...meta });
    });

    socket.on('wb_text', ({ meetingId, ...data }) => {
      const meta = socketWhiteboardIdentity(socket);
      socket.to(`meeting:${meetingId}`).emit('wb_text', { ...data, ...meta });
    });

    socket.on('wb_sticker', ({ meetingId, ...data }) => {
      const meta = socketWhiteboardIdentity(socket);
      socket.to(`meeting:${meetingId}`).emit('wb_sticker', { ...data, ...meta });
    });

    socket.on('wb_clear', ({ meetingId }) => {
      if (!meetingId) return;
      socket.to(`meeting:${meetingId}`).emit('wb_clear');
      const prev = wbStates.get(meetingId) || {};
      wbStates.set(meetingId, { ...prev, objects: [], dataUrl: null });
    });

    socket.on('wb_clear_request', ({ meetingId, requester }) => {
      if (!meetingId) return;
      const room = meetings.get(meetingId);
      if (!room) return;
      for (const sid of room.participants || []) {
        const target = io.sockets.sockets.get(sid);
        if (target?.data?.isHost) target.emit('wb_clear_request', { requester: requester || socket.data?.displayName || socket.data?.meetingEmail || 'Participant', requesterSocketId: socket.id });
      }
    });

    socket.on('wb_clear_approve', ({ meetingId, requesterSocketId }) => {
      if (!meetingId || !socket.data?.isHost) return;
      io.to(`meeting:${meetingId}`).emit('wb_clear');
      const prev = wbStates.get(meetingId) || {};
      wbStates.set(meetingId, { ...prev, objects: [], dataUrl: null });
      if (requesterSocketId) io.sockets.sockets.get(requesterSocketId)?.emit('wb_clear_approved', { ok: true });
    });

    socket.on('wb_lock', ({ meetingId, locked, mode }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const nextMode = ['shared', 'host_only', 'readonly'].includes(mode) ? mode : (!!locked ? 'readonly' : 'shared');
      const prev = wbStates.get(meetingId) || {};
      const payload = { locked: nextMode !== 'shared', lockMode: nextMode, lockOwner: socket.data?.displayName || socket.data?.meetingEmail || 'Hôte/Catalyst' };
      wbStates.set(meetingId, { ...prev, ...payload });
      io.to(`meeting:${meetingId}`).emit('wb_lock', payload);
    });

    socket.on('wb_cursor', ({ meetingId, x, y, visible }) => {
      const now = Date.now();
      if (visible !== false) {
        const prevAt = socket.data?.wbCursorAt || 0;
        if (now - prevAt < 45) return;
      }
      socket.data.wbCursorAt = now;
      const meta = socketWhiteboardIdentity(socket);
      socket.to(`meeting:${meetingId}`).emit('wb_cursor', { x, y, visible: visible !== false, ...meta });
    });

    socket.on('wb_sync', ({ meetingId, objects, dataUrl, bgColor, locked, lockMode, historyTimeline }) => {
      const prev = wbStates.get(meetingId) || {};
      const payload = { ...prev };
      if (Array.isArray(objects)) payload.objects = objects;
      if (dataUrl) payload.dataUrl = dataUrl;
      if (bgColor) payload.bgColor = bgColor;
      if (typeof locked === 'boolean') payload.locked = locked;
      if (lockMode && ['shared','host_only','readonly'].includes(lockMode)) payload.lockMode = lockMode;
      if (Array.isArray(historyTimeline)) payload.historyTimeline = historyTimeline;
      if (Object.keys(payload).length) {
        wbStates.set(meetingId, payload);
        socket.to(`meeting:${meetingId}`).emit('wb_sync', payload);
      }
    });


    // ── Tableau blanc : l'IA dessine pour le participant ───────────────────────
    // Utilisable par TOUS les participants admis (invités compris), sous réserve du
    // mode d'accès du tableau. Le résultat n'est renvoyé qu'au demandeur : son client
    // construit les objets puis les synchronise comme n'importe quel dessin.
    socket.on('wb_ai_request', async ({ meetingId, prompt, requestId, context } = {}) => {
      const reply = (payload) => socket.emit('wb_ai_result', { requestId, ...payload });
      try {
        if (!meetingId || socket.data?.meetingId !== meetingId || socket.data?.waiting) {
          return reply({ ok: false, error: 'Vous devez être dans la réunion pour utiliser l\'IA.' });
        }
        const text = String(prompt || '').trim();
        if (text.length < 3) return reply({ ok: false, error: 'Décrivez ce que vous voulez dessiner.' });

        const lockMode = (wbStates.get(meetingId) || {}).lockMode || 'shared';
        if (lockMode === 'readonly') return reply({ ok: false, error: 'Le tableau est en lecture seule.' });
        if (lockMode === 'host_only' && !socket.data?.isHost) return reply({ ok: false, error: 'Le tableau est réservé à l\'hôte.' });

        // Limite de débit : 1 demande en cours, 6 par minute et par participant
        const now = Date.now();
        const rl = socket.data.wbAi || (socket.data.wbAi = { busy: false, hits: [] });
        rl.hits = rl.hits.filter(t => now - t < 60000);
        if (rl.busy) return reply({ ok: false, error: 'Une demande est déjà en cours.' });
        if (rl.hits.length >= 6) return reply({ ok: false, error: 'Trop de demandes. Réessayez dans une minute.' });
        rl.busy = true; rl.hits.push(now);

        const who = socket.data?.displayName || socket.data?.meetingEmail || 'Un participant';
        socket.to(`meeting:${meetingId}`).emit('wb_ai_status', { busy: true, name: who });
        try {
          const result = await aiContext.run({ user: socket.data?.meetingEmail || `invité:${who}`, feature: 'whiteboard' }, () => aiWhiteboardService.generate(text, context || {}));
          reply({ ok: true, ...result });
        } finally {
          rl.busy = false;
          socket.to(`meeting:${meetingId}`).emit('wb_ai_status', { busy: false, name: who });
        }
      } catch (e) {
        console.error('[wb_ai_request]', e.message);
        reply({ ok: false, error: e.message || 'Erreur IA.' });
      }
    });

    // ── Tableau blanc : images sécurisées (envoi depuis l'ordinateur ou import par lien) ─────────────
    // Les images sont validées / importées par le SERVEUR puis servies depuis notre domaine (/wb-media/…).
    const imageGate = (meetingId, ack) => {
      const done = (payload) => { if (typeof ack === 'function') ack(payload); };
      if (!meetingId || socket.data?.meetingId !== meetingId || socket.data?.waiting) { done({ ok: false, error: 'Vous devez être dans la réunion.' }); return null; }
      const lockMode = (wbStates.get(meetingId) || {}).lockMode || 'shared';
      if (lockMode === 'readonly' || (lockMode === 'host_only' && !socket.data?.isHost)) { done({ ok: false, error: "Le tableau n'est pas modifiable." }); return null; }
      const now = Date.now();
      const rl = socket.data.wbImg || (socket.data.wbImg = { hits: [] });
      rl.hits = rl.hits.filter(t0 => now - t0 < 60000);
      if (rl.hits.length >= 8) { done({ ok: false, error: 'Trop d\'images en peu de temps. Réessayez dans une minute.' }); return null; }
      rl.hits.push(now);
      return done;
    };

    socket.on('wb_image_upload', ({ meetingId, data } = {}, ack) => {
      const done = imageGate(meetingId, ack); if (!done) return;
      try {
        const buf = Buffer.isBuffer(data) ? data : (data instanceof ArrayBuffer ? Buffer.from(data) : null);
        if (!buf) return done({ ok: false, error: 'Fichier invalide.' });
        done({ ok: true, ...wbImageService.saveBuffer(buf) });
      } catch (e) { done({ ok: false, error: e instanceof wbImageService.ImageError ? e.message : "L'image n'a pas pu être enregistrée." }); if (!(e instanceof wbImageService.ImageError)) console.error('[wb_image_upload]', e.message); }
    });

    socket.on('wb_image_import', async ({ meetingId, url } = {}, ack) => {
      const done = imageGate(meetingId, ack); if (!done) return;
      try { done({ ok: true, ...(await wbImageService.importFromUrl(url)) }); }
      catch (e) { done({ ok: false, error: e instanceof wbImageService.ImageError ? e.message : "Impossible d'importer l'image." }); if (!(e instanceof wbImageService.ImageError)) console.error('[wb_image_import]', e.message); }
    });

    // ── Sous-titres : traduction à la demande (tous les participants admis) ───────
    socket.on('caption_translate', async ({ meetingId, text, target, requestId } = {}) => {
      const reply = (p) => socket.emit('caption_translated', { requestId, ...p });
      try {
        if (!meetingId || socket.data?.meetingId !== meetingId || socket.data?.waiting) return reply({ ok: false });
        const clean = String(text || '').trim().slice(0, 300);
        if (clean.length < 2 || !aiMeetingService.CAPTION_LANGS[target]) return reply({ ok: false });
        const now = Date.now();
        const rl = socket.data.capAi || (socket.data.capAi = { hits: [] });
        rl.hits = rl.hits.filter(t0 => now - t0 < 60000);
        if (rl.hits.length >= 15) return reply({ ok: false, limited: true });
        rl.hits.push(now);
        reply({ ok: true, text: await aiContext.run({ user: socket.data?.meetingEmail || `invité:${socket.data?.displayName || 'inconnu'}`, feature: 'captions' }, () => aiMeetingService.translateCaption(clean, target)) });
      } catch (e) {
        console.error('[caption_translate]', e.message);
        reply({ ok: false });
      }
    });

    socket.on('wb_request_state', ({ meetingId }) => {
      const state = wbStates.get(meetingId);
      if (state) socket.emit('wb_state', state);
    });

    // ── Popcorn ──────────────────────────────────────────────────────────────
    socket.on('popcorn_launch', ({ meetingId, targetSocketId, targetName, question, duration }) => {
      if (!socketHasControlPower(meetingId, socket)) {
        return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent lancer le mode Popcorn." });
      }

      const room = `meeting:${meetingId}`;
      if (targetSocketId && targetSocketId !== 'all') {
        const targetSock = io.sockets.sockets.get(targetSocketId);
        if (!targetSock || targetSock.data.meetingId !== meetingId) {
          return socket.emit('meeting_role_error', { error: 'Participant Popcorn introuvable.' });
        }
        if (socketHasControlPower(meetingId, targetSock)) {
          return socket.emit('meeting_role_error', { error: "Les animateurs ne peuvent pas être ciblés en mode Popcorn." });
        }
      }
      io.to(room).emit('popcorn_start', { targetName, targetSocketId, question, duration });
    });

    socket.on('popcorn_answer', ({ meetingId, answer }) => {
      const room = `meeting:${meetingId}`;
      const name = socket.data.displayName || "Quelqu'un";
      io.to(room).emit('popcorn_answer', { answer, targetName: name });
    });

    socket.on('popcorn_timeout', ({ meetingId, targetName }) => {
      const room = `meeting:${meetingId}`;
      socket.to(room).emit('popcorn_timeout', { targetName });
    });

    // ── Quiz ─────────────────────────────────────────────────────────────────
    socket.on('quiz_launch', ({ meetingId, question, options, correctIdx, duration, points, isBingo, speedBonus }) => {
      if (!socketHasControlPower(meetingId, socket)) {
        return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent lancer un quiz." });
      }

      const room = `meeting:${meetingId}`;
      const quizId = 'q_' + Date.now();
      quizVotes.set(quizId, {
        votes: new Array(options.length).fill(0),
        voters: {},
        voterNames: {},
        options,
        correctIdx,
        question,
        points: points || 1,
        isBingo: isBingo || false,
        speedBonus: speedBonus || false,
        scores: {},
        meetingId,
      });

      io.to(room).emit('quiz_question', {
        id: quizId,
        question,
        options,
        duration,
        points: points || 1,
        isBingo: isBingo || false,
        correctIdx: -1,
      });

      setTimeout(() => {
        const data = quizVotes.get(quizId);
        if (!data) return;
        const scores = Object.entries(data.scores)
          .map(([name, score]) => ({ name, score }))
          .sort((a, b) => b.score - a.score);
        const lb = quizLeaderboard.get(meetingId) || {};
        const leaderboard = Object.entries(lb)
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total);
        io.to(room).emit('quiz_results', {
          question: data.question,
          options: data.options,
          votes: data.votes,
          voterNames: data.voterNames,
          correctIdx: data.correctIdx,
          scores,
          leaderboard,
          points: data.points,
        });
        quizVotes.delete(quizId);
      }, duration * 1000 + 500);
    });

    socket.on('quiz_vote', ({ meetingId, optionIdx, displayName }) => {
      for (const [qid, data] of quizVotes.entries()) {
        if (data.meetingId !== meetingId) continue;
        if (socketHasControlPower(meetingId, socket)) return;
        if (data.voters[socket.id] !== undefined) return;

        data.voters[socket.id] = optionIdx;
        if (!data.voterNames[optionIdx]) data.voterNames[optionIdx] = [];
        data.voterNames[optionIdx].push(displayName || "Quelqu'un");
        if (data.votes[optionIdx] !== undefined) data.votes[optionIdx]++;

        if (optionIdx === data.correctIdx) {
          let earned = data.points;
          if (data.speedBonus) {
            const nCorrect = Object.values(data.voters).filter(v => v === data.correctIdx).length;
            earned += Math.max(0, 4 - nCorrect);
          }
          data.scores[displayName] = (data.scores[displayName] || 0) + earned;
          if (!quizLeaderboard.has(data.meetingId)) quizLeaderboard.set(data.meetingId, {});
          const lb = quizLeaderboard.get(data.meetingId);
          lb[displayName] = (lb[displayName] || 0) + earned;
        }

        const total = Object.keys(data.voters).length;
        io.to(`meeting:${meetingId}`).emit('quiz_vote_count', { total });
        break;
      }
    });

    socket.on('quiz_restore_leaderboard', ({ meetingId, leaderboard }) => {
      if (!leaderboard?.length) return;
      if (!quizLeaderboard.has(meetingId)) quizLeaderboard.set(meetingId, {});
      const lb = quizLeaderboard.get(meetingId);
      leaderboard.forEach(({ name, total }) => {
        if (!lb[name] || lb[name] < total) lb[name] = total;
      });
      socket.to(`meeting:${meetingId}`).emit('quiz_leaderboard_sync', { leaderboard });
    });

    // ── Salles de sous-groupes (breakout rooms) ─────────────────────────────
    // rooms: [{ label }], assignments: { socketId: roomIndex }, durationMinutes (optionnel)
    socket.on('breakout_open', async ({ meetingId, rooms, assignments, durationMinutes }) => {
      if (!socketHasControlPower(meetingId, socket)) {
        return socket.emit('meeting_role_error', { error: "Seul l'hôte peut ouvrir des salles de sous-groupes." });
      }
      if (!Array.isArray(rooms) || !rooms.length) return;

      try {
        // Fermer une éventuelle session de sous-groupes déjà en cours pour cette réunion
        const existing = activeBreakouts.get(meetingId);
        if (existing) { clearTimeout(existing.timer); activeBreakouts.delete(meetingId); }

        const createdRooms = [];
        for (const r of rooms) {
          const { id } = await meetingService.createBreakoutRoom({
            parentMeetingId: meetingId,
            host: socket.data.meetingEmail,
            label: r.label,
          });
          createdRooms.push({ id, label: r.label });
        }

        const baseUrl = process.env.APP_URL || '';

        // Envoyer à chaque participant assigné le lien de SA salle uniquement
        Object.entries(assignments || {}).forEach(([socketId, roomIdx]) => {
          const room = createdRooms[roomIdx];
          if (!room) return;
          io.to(socketId).emit('breakout_move', {
            roomLabel: room.label,
            link: `${baseUrl}/meeting/${room.id}`,
          });
        });

        let timer = null;
        if (durationMinutes && durationMinutes > 0) {
          timer = setTimeout(() => {
            createdRooms.forEach(room => {
              io.to(`meeting:${room.id}`).emit('breakout_time_up');
              meetingService.closeBreakoutRoom(room.id).catch(() => {});
            });
            activeBreakouts.delete(meetingId);
            // Corrigé : sans ceci, le widget de l'hôte dans la salle principale
            // ("Salles ouvertes / Fermer toutes les salles") restait affiché
            // indéfiniment après un retour automatique par minuterie — seule
            // la fermeture manuelle prévenait la salle principale.
            io.to(`meeting:${meetingId}`).emit('breakout_closed');
          }, durationMinutes * 60 * 1000);
        }

        activeBreakouts.set(meetingId, { rooms: createdRooms, timer, durationMinutes: durationMinutes || null, openedAt: Date.now() });

        io.to(`meeting:${meetingId}`).emit('breakout_opened', {
          count: createdRooms.length,
          durationMinutes: durationMinutes || null,
        });
      } catch (e) {
        console.error('[Breakout] Échec ouverture des salles :', e.message);
        socket.emit('meeting_role_error', { error: 'Impossible de créer les salles de sous-groupes.' });
      }
    });

    // Fermeture manuelle anticipée par l'hôte — tout le monde revient tout de suite
    socket.on('breakout_close', ({ meetingId }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const session = activeBreakouts.get(meetingId);
      if (!session) return;

      clearTimeout(session.timer);
      session.rooms.forEach(room => {
        io.to(`meeting:${room.id}`).emit('breakout_time_up');
        meetingService.closeBreakoutRoom(room.id).catch(() => {});
      });
      activeBreakouts.delete(meetingId);
      io.to(`meeting:${meetingId}`).emit('breakout_closed');
    });

    // ── Réactions emoji ───────────────────────────────────────────────────────
    socket.on('meeting_reaction', ({ meetingId, emoji }) => {
      const room = `meeting:${meetingId}`;
      socket.to(room).emit('meeting_reaction', { displayName: socket.data.displayName || '', email: socket.data.meetingEmail || '', emoji });
    });

    // ── Host mute / unmute ────────────────────────────────────────────────────
    socket.on('host_mute', ({ meetingId, targetSocket: targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent couper un micro." });
      const target = io.sockets.sockets.get(targetSocketId);
      if (target?.data?.meetingEmail) setParticipantPermissions(meetingId, target.data.meetingEmail, { forceMuted: true, canUnmute: false });
      io.to(targetSocketId).emit('host_mute', { forced: true });
      addAdminLog(io, meetingId, socket, 'muted', target?.data?.displayName || targetSocketId, '');
    });

    socket.on('host_unmute', ({ meetingId, targetSocket: targetSocketId }) => {
      if (!socketHasControlPower(meetingId, socket)) return socket.emit('meeting_role_error', { error: "Seuls l'hôte et les Catalyst peuvent réactiver un micro." });
      const target = io.sockets.sockets.get(targetSocketId);
      if (target?.data?.meetingEmail) {
        const permissions = setParticipantPermissions(meetingId, target.data.meetingEmail, { forceMuted: false, canUnmute: true });
        target.emit('meeting_permissions_sync', { permissions, targetEmail: target.data.meetingEmail, socketId: target.id, mine: true });
      }
      io.to(targetSocketId).emit('host_unmute');
      addAdminLog(io, meetingId, socket, 'unmuted', target?.data?.displayName || targetSocketId, '');
    });

    // ── Fin de réunion ────────────────────────────────────────────────────────
    socket.on('meeting_end', ({ meetingId }) => {
      if (!socket.data.isHost) return;
      const room = `meeting:${meetingId}`;
      triggerAiSummary(io, meetingId);
      io.to(room).emit('meeting_ended');
      meetingChatHistory.delete(meetingId);

      // Corrigé : une session de sous-salles ouverte en retour manuel
      // (pas de minuterie) restait indéfiniment en mémoire et en base si
      // l'hôte terminait la réunion sans avoir cliqué "Fermer toutes les
      // salles" — fuite mémoire/BDD qui grandit avec chaque réunion oubliée.
      const breakoutSession = activeBreakouts.get(meetingId);
      if (breakoutSession) {
        clearTimeout(breakoutSession.timer);
        breakoutSession.rooms.forEach(room => {
          io.to(`meeting:${room.id}`).emit('breakout_time_up');
          meetingService.closeBreakoutRoom(room.id).catch(() => {});
        });
        activeBreakouts.delete(meetingId);
      }
    });

    // ── Timer extension ───────────────────────────────────────────────────────
    socket.on('meeting_extend', ({ meetingId, minutes }) => {
      if (!socketHasControlPower(meetingId, socket)) return;
      const session = getMeetingSession(meetingId);
      if (!session) return;
      const ext = Math.max(1, Math.min(120, parseInt(minutes || 30, 10)));
      session.expiresAt += ext * 60 * 1000;
      session.promptForExpiresAt = null;
      emitMeetingTimerSync(io, meetingId);
    });

    // ── Statistiques de participation ─────────────────────────────────────────
    socket.on('participation_get', ({ meetingId }) => {
      emitParticipationStats(io, meetingId, socket);
    });

    socket.on('speak_state', ({ meetingId, speaking }) => {
      const stat = touchParticipantStat(meetingId, socket);
      if (speaking && !stat.speakingSince) { stat.speakingSince = Date.now(); stat.speechTurns = (stat.speechTurns || 0) + 1; }
      else if (!speaking && stat.speakingSince) { stat.speakingMs = (stat.speakingMs || 0) + (Date.now() - stat.speakingSince); stat.speakingSince = null; }
      emitParticipationStats(io, meetingId);
      socket.to(`meeting:${meetingId}`).emit('speak_state', { socketId: socket.id, speaking });
    });

    socket.on('speak_limit', ({ meetingId, limitSeconds }) => {
      socket.to(`meeting:${meetingId}`).emit('speak_limit', { limitSeconds });
    });

    socket.on('speak_reset', ({ meetingId, targetSocket: targetSocketId }) => {
      io.to(targetSocketId).emit('speak_reset', { socketId: targetSocketId });
    });
  });
}

module.exports = { initSocket };
