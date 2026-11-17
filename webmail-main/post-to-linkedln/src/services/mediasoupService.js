const os = require('os');
const mediasoup = require('mediasoup');

const MEDIA_CODECS = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];
const workers = [];
const rooms = new Map();
let nextWorkerIdx = 0;
let initialized = false;

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function buildListenInfos() {
  const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS || process.env.TURN_DOMAIN || process.env.PUBLIC_IP || undefined;
  const bindIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
  const udpMin = envNum('MEDIASOUP_UDP_MIN_PORT', 40000);
  const udpMax = envNum('MEDIASOUP_UDP_MAX_PORT', 49999);
  const tcpMin = envNum('MEDIASOUP_TCP_MIN_PORT', udpMax + 1);
  const tcpMax = envNum('MEDIASOUP_TCP_MAX_PORT', tcpMin + 999);

  const listenInfos = [
    {
      protocol: 'udp',
      ip: bindIp,
      announcedAddress,
      portRange: { min: udpMin, max: udpMax },
    },
    {
      protocol: 'tcp',
      ip: bindIp,
      announcedAddress,
      portRange: { min: tcpMin, max: tcpMax },
    },
  ];

  return listenInfos;
}

async function initMediasoup() {
  if (initialized) return;
  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus()?.length || 1);
  const workerCount = Math.max(1, Math.min(envNum('MEDIASOUP_WORKERS', Math.min(cpuCount, 4)), cpuCount));

  for (let i = 0; i < workerCount; i += 1) {
    const worker = await mediasoup.createWorker({
      logLevel: process.env.MEDIASOUP_LOG_LEVEL || 'warn',
      rtcMinPort: envNum('MEDIASOUP_RTC_MIN_PORT', 40000),
      rtcMaxPort: envNum('MEDIASOUP_RTC_MAX_PORT', 50999),
    });

    worker.on('died', () => {
      console.error('[mediasoup] worker died, pid=%s', worker.pid);
      setTimeout(() => process.exit(1), 1500);
    });

    workers.push(worker);
  }

  initialized = true;
  console.log('[mediasoup] initialized with %d worker(s)', workers.length);
}

function getWorker() {
  if (!workers.length) throw new Error('mediasoup not initialized');
  const worker = workers[nextWorkerIdx % workers.length];
  nextWorkerIdx += 1;
  return worker;
}

async function ensureRoom(meetingId) {
  if (rooms.has(meetingId)) return rooms.get(meetingId);
  const worker = getWorker();
  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  const room = {
    meetingId,
    worker,
    router,
    peers: new Map(),
    createdAt: Date.now(),
  };
  rooms.set(meetingId, room);
  return room;
}

function getRoom(meetingId) {
  return rooms.get(meetingId) || null;
}

function ensurePeer(room, peerId, meta = {}) {
  if (!room.peers.has(peerId)) {
    room.peers.set(peerId, {
      id: peerId,
      meta: {
        email: meta.email || '',
        displayName: meta.displayName || meta.email || peerId,
        isHost: !!meta.isHost,
        isCatalyst: !!meta.isCatalyst,
      },
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      rtpCapabilities: null,
    });
  } else if (meta && Object.keys(meta).length) {
    Object.assign(room.peers.get(peerId).meta, meta);
  }
  return room.peers.get(peerId);
}

function getPeer(room, peerId) {
  return room?.peers?.get(peerId) || null;
}

async function createWebRtcTransport(meetingId, peerId, direction, meta = {}) {
  const room = await ensureRoom(meetingId);
  const peer = ensurePeer(room, peerId, meta);
  const transport = await room.router.createWebRtcTransport({
    listenInfos: buildListenInfos(),
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: envNum('MEDIASOUP_INITIAL_OUTGOING_BITRATE', 1200000),
    appData: {
      peerId,
      direction,
      meetingId,
    },
  });

  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') {
      try { transport.close(); } catch (_) {}
    }
  });

  transport.on('close', () => {
    peer.transports.delete(transport.id);
  });

  peer.transports.set(transport.id, transport);

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters,
  };
}

async function connectTransport(meetingId, peerId, transportId, dtlsParameters) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const transport = peer?.transports?.get(transportId);
  if (!transport) throw new Error('Transport introuvable');
  await transport.connect({ dtlsParameters });
}

function getProducerSummary(room, producer) {
  const producerPeer = room.peers.get(producer.appData.peerId);
  return {
    producerId: producer.id,
    peerId: producer.appData.peerId,
    email: producerPeer?.meta?.email || '',
    displayName: producerPeer?.meta?.displayName || producer.appData.peerId,
    kind: producer.kind,
    source: producer.appData.source || producer.kind,
    appData: producer.appData,
    paused: producer.paused,
    isCatalyst: !!producerPeer?.meta?.isCatalyst,
  };
}

async function createProducer(meetingId, peerId, transportId, kind, rtpParameters, appData = {}) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const transport = peer?.transports?.get(transportId);
  if (!transport) throw new Error('Transport producteur introuvable');

  const source = appData.source || kind;
  for (const producer of peer.producers.values()) {
    if ((producer.appData?.source || producer.kind) === source) {
      try { producer.close(); } catch (_) {}
      peer.producers.delete(producer.id);
    }
  }

  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: {
      ...appData,
      source,
      peerId,
      meetingId,
    },
  });

  peer.producers.set(producer.id, producer);

  producer.on('transportclose', () => {
    peer.producers.delete(producer.id);
  });

  producer.on('close', () => {
    peer.producers.delete(producer.id);
  });

  return getProducerSummary(room, producer);
}

function listProducers(meetingId, excludingPeerId = null) {
  const room = getRoom(meetingId);
  if (!room) return [];
  const items = [];
  for (const peer of room.peers.values()) {
    if (excludingPeerId && peer.id === excludingPeerId) continue;
    for (const producer of peer.producers.values()) {
      items.push(getProducerSummary(room, producer));
    }
  }
  return items;
}

async function createConsumer(meetingId, peerId, transportId, producerId, rtpCapabilities) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const transport = peer?.transports?.get(transportId);
  if (!room || !peer || !transport) throw new Error('Transport consommateur introuvable');
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('Ce client ne peut pas consommer ce flux');
  }

  peer.rtpCapabilities = rtpCapabilities;
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
  });

  peer.consumers.set(consumer.id, consumer);

  consumer.on('transportclose', () => {
    peer.consumers.delete(consumer.id);
  });

  consumer.on('producerclose', () => {
    peer.consumers.delete(consumer.id);
  });

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused,
    appData: consumer.appData,
  };
}

async function resumeConsumer(meetingId, peerId, consumerId) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const consumer = peer?.consumers?.get(consumerId);
  if (!consumer) throw new Error('Consumer introuvable');
  await consumer.resume();
}

async function pauseProducer(meetingId, peerId, producerId) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const producer = peer?.producers?.get(producerId);
  if (!producer) throw new Error('Producer introuvable');
  await producer.pause();
}

async function resumeProducer(meetingId, peerId, producerId) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const producer = peer?.producers?.get(producerId);
  if (!producer) throw new Error('Producer introuvable');
  await producer.resume();
}

async function closeProducer(meetingId, peerId, producerId) {
  const room = getRoom(meetingId);
  const peer = getPeer(room, peerId);
  const producer = peer?.producers?.get(producerId);
  if (!producer) return;
  try { producer.close(); } catch (_) {}
  peer.producers.delete(producerId);
}

function closePeer(meetingId, peerId) {
  const room = getRoom(meetingId);
  if (!room) return [];
  const peer = room.peers.get(peerId);
  if (!peer) return [];
  const closedProducerIds = Array.from(peer.producers.keys());

  for (const consumer of peer.consumers.values()) {
    try { consumer.close(); } catch (_) {}
  }
  for (const producer of peer.producers.values()) {
    try { producer.close(); } catch (_) {}
  }
  for (const transport of peer.transports.values()) {
    try { transport.close(); } catch (_) {}
  }

  room.peers.delete(peerId);

  if (room.peers.size === 0) {
    try { room.router.close(); } catch (_) {}
    rooms.delete(meetingId);
  }

  return closedProducerIds;
}

module.exports = {
  initMediasoup,
  ensureRoom,
  getRoom,
  listProducers,
  createWebRtcTransport,
  connectTransport,
  createProducer,
  createConsumer,
  resumeConsumer,
  pauseProducer,
  resumeProducer,
  closeProducer,
  closePeer,
};
