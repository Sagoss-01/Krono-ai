/**
 * meeting-state.js
 * État global partagé entre tous les modules de la réunion.
 * Toutes les variables mutables sont ici — les modules les lisent/écrivent via cet objet.
 */
const MeetState = {
  // Identifiants (injectés depuis EJS via window.MEET_CONFIG)
  MEETING_ID:      window.MEET_CONFIG.MEETING_ID,
  MEETING_CODE:    window.MEET_CONFIG.MEETING_CODE,
  PARENT_MEETING_ID: window.MEET_CONFIG.PARENT_MEETING_ID || '',
  BREAKOUT_LABEL:  window.MEET_CONFIG.BREAKOUT_LABEL || '',
  USER_EMAIL:      window.MEET_CONFIG.USER_EMAIL,
  IS_HOST:         window.MEET_CONFIG.IS_HOST,
  IS_CATALYST:    false,
  NEEDS_CODE:      window.MEET_CONFIG.NEEDS_CODE,
  IS_GUEST:        window.MEET_CONFIG.IS_GUEST,
  REVIEWS_ENABLED: window.MEET_CONFIG.REVIEWS_ENABLED,

  HAND_SVG: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,

  // Media
  localStream:  null,
  micEnabled:   true,
  camEnabled:   true,
  screenStream: null,
  screenEnabled: false,
  screenTrack: null,
  cameraTrackBeforeScreen: null,
  remoteStreams: {},

  // ── Ancien état P2P (conservé pour compatibilité UI — plus utilisé pour WebRTC) ──
  peers:    {},   // socketId → { email, name, isSharing } — métadonnées UI uniquement
  peerMeta: {},   // socketId → { email, name, isSharing, isCatalyst }
  ICE_CONFIG: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },

  // Socket
  socket: null,

  // ── État SFU mediasoup ──────────────────────────────────────────────────────
  /** Instance mediasoup-client Device */
  sfuDevice: null,

  /** Transport d'envoi (un seul par client) */
  sfuSendTransport: null,

  /** Transport de réception (un seul par client) */
  sfuRecvTransport: null,

  /**
   * Producers locaux actifs.
   * Clé : source ('audio' | 'camera' | 'screen')
   * Valeur : Producer mediasoup-client
   */
  sfuProducers: {},   // { audio: Producer, camera: Producer, screen: Producer }

  /**
   * Consumers distants actifs.
   * Clé : consumerId (string)
   * Valeur : { consumer: Consumer, peerId, source, kind }
   */
  sfuConsumers: {},   // consumerId → { consumer, peerId, source, kind }

  /**
   * Mapping producerId → { peerId, source, kind }
   * Permet de retrouver l'origine d'un producer à partir de son ID.
   */
  sfuProducerMap: {}, // producerId → { peerId, source, kind, email, displayName }

  /**
   * Streams distants reconstruits par peerId.
   * Un même peerId peut avoir plusieurs sources (camera, screen).
   * Clé : `${peerId}::${source}`   ex: "abc123::camera"
   * Valeur : MediaStream
   */
  sfuRemoteStreams: {}, // `${peerId}::${source}` → MediaStream

  /** Vrai si le Device SFU est initialisé et les transports créés */
  sfuReady: false,

  // ── UI ──────────────────────────────────────────────────────────────────────
  displayName:   '',
  handRaised:    false,
  chatOpen:      false,
  currentTab:    'chat',
  unreadCount:   0,
  badgeTimer:    null,
  handQueue:     new Map(),
  handOrder:     0,
  startTime:     null,
  timerInterval: null,
  timerStarted:   false,
  meetingExpiresAt: null,
  extensionPromptFor: null,
  participationStats: [],
  participationOpen: false,
  participationTab:  'participation',
  adminOpen: false,
  adminTab: 'participants',
  waitingList: [],
  adminLogs: [],
  meetingLocked: false,
  meetingLockMode: 'waiting',
  participantPermissions: {},
  forcedMute: false,
  canUnmute: true,
  isReadOnly: false,
  canUseCamera: true,
  canShareScreen: true,
  canChat: true,
  audioDiagnostics: {},
  audioDiagTimer: null,
  bitrateReduced: false,
  defaultSenderParams: {},

  // Speech detection
  _speechCtx:      null,
  _speechAnalyser:  null,
  _speechInterval:  null,
  SPEECH_THRESHOLD: 20,
  SPEECH_DURATION:  1500,

  // Recording
  _mediaRecorder:  null,
  _recordChunks:   [],
  _recordCanvas:   null,
  _recordCtx:      null,
  _recordFrame:    null,
  _recordAudioCtx: null,
  _recordPreviewVideo: null,
  _recordingPendingUnload: false,
  _recordingBeforeUnloadHandler: null,
  _recordingKeydownHandler: null,
  _badConnectionToastShown: false,
  _pipVideo: null,
  _pipCanvas: null,
  _pipCtx: null,
  _pipStream: null,
  _pipFrame: null,

  // Whiteboard
  wbCanvas: null,
  wbCtx:    null,
  wbCurrentTool:  'pen',
  wbCurrentColor: '#4db8d8',
  wbCurrentSize:  3,
  wbDrawing:      false,
  wbLastX:        0,
  wbLastY:        0,

  // Notes
  notesRevision:  0,
  notesSaveTimer: null,

  // Speech timers
  speechTimers:  {},
  speechLimit:   0,

  // AI
  aiMessages: [],

  // Poll
  currentPoll:    null,
  reviewRating:   0,
  codeVerified: false,
  wbLocked: false,
  wbLockOwner: '',
  wbRemoteCursors: {},
};
