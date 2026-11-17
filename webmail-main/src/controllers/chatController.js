const chatService = require('../services/chat');

function getMyEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email || null;
}

async function getConversations(req, res) {
  const email = getMyEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifie' });
  try {
    const convs = await chatService.getConversations(email);
    res.json({ ok: true, conversations: convs });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

async function getHistory(req, res) {
  const email = getMyEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifie' });
  const peer = req.params.peerEmail;
  const room = chatService.roomId(email, peer);
  try {
    await chatService.markRead(email, peer);
    const messages = await chatService.getHistory(room, 100);
    res.json({ ok: true, messages });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// /api/chat/media/:msgId — redirige vers le fichier statique
// Le fichier est déjà servi par express.static sur /uploads/chat/...
// Cette route n'est plus nécessaire mais on la garde pour compatibilité
async function getMedia(req, res) {
  const email = getMyEmail(req);
  if (!email) return res.status(401).json({ ok: false, error: 'Non authentifie' });
  // Les fichiers sont désormais servis directement par express.static
  // Cette route ne devrait plus être appelée
  res.status(410).json({ ok: false, error: 'Utiliser le chemin media_path directement' });
}

module.exports = { getConversations, getHistory, getMedia };
