/**
 * src/controllers/meetingController.js
 * Gestion complète des réunions :
 * - Vérification code AVANT d'entrer dans la salle
 * - Invités anonymes (allow_guests) sans auth
 * - Historique live + terminées
 */
const meetingService = require('../services/meeting');
const { pool }       = require('../services/db');
const crypto         = require('crypto');
const fs             = require('fs');
const path           = require('path');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}


function getDirSizeBytes(dir) {
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


// ─── GET /meeting/:id ─────────────────────────────────────────────────────────
// Pas de requireAuth ici — on gère manuellement selon allow_guests
async function showRoom(req, res) {
  const meeting = await meetingService.getMeeting(req.params.id);
  if (!meeting) return res.status(404).render('pages/error', { title: 'Réunion introuvable', message: 'Cette réunion n\'existe pas ou a été supprimée.' });
  if (meeting.status === 'ended') return res.status(410).render('pages/error', { title: 'Réunion terminée', message: 'Cette réunion est terminée.' });

  const email = activeEmail(req);

  // Pas connecté et invités non autorisés → login
  if (!email && !meeting.allow_guests) {
    return res.redirect('/login?redirect=/meeting/' + req.params.id);
  }

  // Accès par emails → vérifier si l'email est autorisé (seulement si connecté)
  if (meeting.access === 'emails' && email && meeting.host !== email) {
    const allowed = (meeting.allowed_emails || '').split(',').map(e => e.trim().toLowerCase());
    if (!allowed.includes(email.toLowerCase())) {
      return res.status(403).render('pages/error', { title: 'Accès refusé', message: 'Votre adresse email n\'est pas autorisée pour cette réunion.' });
    }
  }

  // Pour les réunions avec code : afficher d'abord la page de saisie du code
  // sauf si c'est l'hôte
  const needsCode = (meeting.access === 'code') && (email !== meeting.host);

  res.render('pages/meeting-room', {
    title:      meeting.title + ' — TechSphere Meet',
    meeting,
    userEmail:  email || '',          // vide si invité anonyme
    isGuest:    !email,               // true si pas connecté
    needsCode,                         // true si doit saisir le code
    csrfToken:  req.session.csrfToken || '',
  });
}

// ─── POST /api/meetings/verify-code ──────────────────────────────────────────
// Vérifier le code AVANT d'entrer dans la salle (appelé depuis le lobby)
async function verifyCode(req, res) {
  const { meetingId, code } = req.body;
  if (!meetingId || !code) return res.json({ ok: false, error: 'Paramètres manquants' });
  try {
    const valid = await meetingService.verifyCode(meetingId, code);
    res.json({ ok: valid, error: valid ? null : 'Code incorrect' });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── POST /api/meetings ───────────────────────────────────────────────────────
async function createMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });

  const { title, access, allowedEmails, guestEmails, scheduledAt, instant, customCode, allowGuests } = req.body;
  try {
    const { id, code } = await meetingService.createMeeting({
      host:         email,
      title,
      access,
      allowedEmails: allowedEmails ? allowedEmails.split(/[,;\n]/) : [],
      guestEmails:   guestEmails   ? guestEmails.split(/[,;\n]/)   : [],
      scheduledAt:   scheduledAt   || null,
      customCode:    customCode    || null,
      allowGuests:   allowGuests === '1' || allowGuests === true,
      instant:       !!instant,
    });
    const link = `${req.protocol}://${req.get('host')}/meeting/${id}`;
    res.json({ ok: true, id, code, link });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── GET /api/meetings — réunions actives ────────────────────────────────────
async function getMyMeetings(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    const meetings = await meetingService.getMyMeetings(email);
    res.json({ ok: true, meetings });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── GET /api/meetings/history — tout l'historique ──────────────────────────
async function getMeetingHistory(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    const meetings = await meetingService.getAllMeetings(email);
    res.json({ ok: true, meetings });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── POST /api/meetings/:id/start ────────────────────────────────────────────
async function startMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    await meetingService.startMeeting(req.params.id, email);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── POST /api/meetings/:id/end ──────────────────────────────────────────────
async function endMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false });
  try {
    await meetingService.endMeeting(req.params.id, email);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// ─── POST /api/meetings/join-by-code ─────────────────────────────────────────
async function joinByCode(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });
  const { code } = req.body;
  if (!code) return res.json({ ok: false, error: 'Code manquant' });
  try {
    const [rows] = await pool.execute(
      `SELECT id FROM meetings WHERE code=? AND status!='ended'`, [code.trim()]
    );
    if (!rows.length) return res.json({ ok: false, error: 'Code invalide ou réunion terminée' });
    res.json({ ok: true, id: rows[0].id });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// DELETE /api/meetings/:id
async function deleteMeeting(req, res) {
  const email = activeEmail(req);
  if (!email) return res.json({ ok: false, error: 'Non authentifié' });
  try {
    const [result] = await pool.execute(
      'DELETE FROM meetings WHERE id=? AND host=?', [req.params.id, email]
    );
    if (result.affectedRows === 0) return res.json({ ok: false, error: 'Réunion introuvable ou non autorisé' });
    // Supprimer aussi les participants
    await pool.execute('DELETE FROM meeting_participants WHERE meeting_id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}

// POST /api/meetings/:id/review
async function submitReview(req, res) {
  const email = activeEmail(req);
  // Permettre aussi les invités anonymes si email fourni dans le body
  const reviewer = email || req.body.email;
  if (!reviewer) return res.json({ ok: false, error: 'Email requis' });
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.json({ ok: false, error: 'Note invalide (1-5)' });
  try {
    await meetingService.saveReview(req.params.id, reviewer, parseInt(rating), comment || null);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
}


const chatUploadStorage = {
  _handleFile(req, file, cb) {
    try {
      const meetingId = req.params.id;
      const baseDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat', meetingId);
      fs.mkdirSync(baseDir, { recursive: true });
      const safeOriginal = (file.originalname || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const filename = `${fileId}_${safeOriginal}`;
      const absPath = path.join(baseDir, filename);
      const out = fs.createWriteStream(absPath);
      file.stream.pipe(out);
      out.on('error', cb);
      out.on('finish', () => cb(null, {
        destination: baseDir,
        filename,
        path: absPath,
        size: out.bytesWritten,
      }));
    } catch (err) { cb(err); }
  },
  _removeFile(_req, file, cb) {
    fs.unlink(file.path, cb);
  },
};

async function uploadChatFile(req, res) {
  try {
    const meeting = await meetingService.getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ ok: false, error: 'Réunion introuvable' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Fichier manquant' });

    const quotaMb = Math.max(1, parseInt(process.env.MEETING_CHAT_UPLOAD_QUOTA_MB || '100', 10));
    const quotaBytes = quotaMb * 1024 * 1024;
    const meetingDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat', req.params.id);
    const currentUsage = getDirSizeBytes(meetingDir);
    if ((currentUsage + (req.file.size || 0)) > quotaBytes) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(413).json({
        ok: false,
        error: `Quota d'upload dépassé pour cette réunion (max ${quotaMb} Mo).`,
        code: 'UPLOAD_QUOTA_EXCEEDED',
      });
    }

    const rel = `/uploads/chat/${req.params.id}/${req.file.filename}`;
    res.json({ ok: true, file: {
      fileId: req.file.filename.split('_').slice(0, 2).join('_'),
      fileName: req.file.originalname || req.file.filename,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      fileUrl: rel,
      quotaBytes,
      currentUsage,
    }});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "Erreur serveur pendant l'upload" });
  }
}


// ══════════════════════════════════════════════════════════════════
// IA MEET — calqué sur SupportController.php
// Modèles avec fallback automatique si 429
// ══════════════════════════════════════════════════════════════════

const OR_MODELS = [
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

/** Prompt système — rôle élargi : accès au chat + actions sur la réunion */
function buildMeetSystemPrompt(ctx) {
  const chatSection = ctx.chatHistory?.length
    ? `\n━━ MESSAGES DU CHAT EN COURS ━━\nVoici les derniers messages échangés dans la réunion :\n${ctx.chatHistory.map(m => `• ${m.who} : ${m.text}`).join('\n')}`
    : '';

  return `Tu es TechSphere Meet AI, l'assistant IA officiel de la plateforme de visioconférence TechSphere.

━━ TON RÔLE ━━
Tu es présent DANS la réunion et tu peux :
- Résumer les échanges du chat ou de la discussion
- Répondre aux questions des participants
- Rédiger du contenu (emails, comptes-rendus, listes de tâches, plans de projet…)
- Clarifier des idées ou reformuler des points abordés
- Générer des suggestions, des décisions ou des actions à suivre
- Analyser les messages du chat pour en extraire l'essentiel
- Aider à rédiger des messages à envoyer dans le chat

━━ CONTEXTE DE LA RÉUNION ━━
- Titre       : ${ctx.title || 'Réunion en cours'}
- Durée       : ${ctx.duration || 'non communiquée'}${chatSection}

━━ RÈGLES ━━
1. Tu réponds EXCLUSIVEMENT en français.
2. Tu es professionnel, concis, orienté action.
3. Tu utilises du Markdown pour structurer tes réponses.
4. Si le participant demande un résumé du chat, tu l'analyses et tu produis un résumé structuré.
5. Si le participant demande de rédiger un message pour le chat, tu le rédiges directement.
6. Si la demande est hors sujet, tu réponds brièvement et tu recentres sur l'assistance réunion.
7. Tu n'inventes jamais d'informations absentes de la conversation.`;
}

/** Appel OpenRouter avec fallback (identique au PHP) */
async function callOpenRouter(apiMessages, maxTokens = 1024) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    require('../services/logger')?.error?.('TechSphere Meet AI : AI_API_KEY manquante');
    throw new Error("⚠️ Le service IA n'est pas configuré. Contactez l'administrateur.");
  }

  for (const model of OR_MODELS) {
    console.log(`[Meet AI] Tentative : ${model}`);
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer':  process.env.APP_URL || 'https://webmail.netiify.cloud',
          'X-Title':       'TechSphere Meet AI',
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model,
          messages:    apiMessages,
          temperature: 0.6,
          max_tokens:  maxTokens,
        }),
      });
    } catch(connErr) {
      console.error(`[Meet AI] Connexion échouée (${model}) :`, connErr.message);
      throw new Error('⚠️ Impossible de joindre le service IA. Vérifiez votre connexion.');
    }

    const raw = await response.text();
    console.log(`[Meet AI] HTTP ${response.status} — ${model}`);

    if (response.status === 429) {
      console.warn(`[Meet AI] Rate-limit sur ${model}, essai suivant…`);
      continue;
    }

    if (!response.ok) {
      console.error(`[Meet AI] Erreur ${response.status} :`, raw);
      const msg = {
        401: "⚠️ Clé API invalide. Contactez l'administrateur.",
        503: "⚠️ Le service IA est indisponible. Réessayez plus tard.",
      }[response.status] || `⚠️ Erreur du service IA (code ${response.status}). Réessayez.`;
      throw new Error(msg);
    }

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      throw new Error('Réponse invalide reçue du service IA.');
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      console.warn('[Meet AI] Réponse vide :', JSON.stringify(data));
      throw new Error("Je n'ai pas pu générer de réponse. Reformulez votre question.");
    }

    console.log(`[Meet AI] ✅ ${model} — tokens: ${data.usage?.total_tokens ?? '?'}`);
    return content.trim();
  }

  throw new Error('⚠️ Le service IA est temporairement surchargé. Réessayez dans quelques instants.');
}

// ─── POST /api/meetings/:id/ai-chat ──────────────────────────────────────────
async function aiChat(req, res) {
  const { messages, context = {} } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    return res.json({ ok: false, error: 'Messages manquants.' });

  const apiMessages = [
    { role: 'system', content: buildMeetSystemPrompt(context) },
    ...messages.slice(-20)
      .filter(m => ['user', 'assistant'].includes(m.role))
      .map(m => ({ role: m.role, content: String(m.content || '') })),
  ];

  try {
    const reply = await callOpenRouter(apiMessages, 1024);
    res.json({ ok: true, reply });
  } catch(e) {
    console.error('[aiChat]', e.message);
    res.json({ ok: false, error: e.message });
  }
}

// ─── POST /api/meetings/:id/summary ──────────────────────────────────────────
async function generateSummary(req, res) {
  const { chatMessages = [], notes = '', duration = '', participants = [], transcript = '' } = req.body;
  const meeting = await meetingService.getMeeting(req.params.id);
  const title   = meeting?.title || 'Réunion';

  // Construire le contenu avec toutes les sources disponibles
  const hasContent = chatMessages.length > 0 || notes.trim() || transcript.trim();

  const userContent = [
    `Tu es expert en rédaction de comptes-rendus de réunion. Génère un compte-rendu complet, structuré et professionnel de la réunion ci-dessous.`,
    ``,
    `**Titre de la réunion :** ${title}`,
    duration            ? `**Durée :** ${duration}` : '',
    participants.length ? `**Participants :** ${participants.join(', ')}` : '',
    ``,
    transcript.trim() ? `### Transcription audio (paroles enregistrées en temps réel) :\n${transcript.slice(0, 4000)}` : '',
    chatMessages.length ? `\n### Messages du chat :\n${chatMessages.map(m => `- **${m.displayName}** : ${m.text}`).join('\n')}` : '',
    notes.trim()        ? `\n### Notes collaboratives :\n${notes.trim()}` : '',
    ``,
    `### Instructions :`,
    `Produis un compte-rendu en Markdown avec exactement ces sections :`,
    `1. **Résumé exécutif** (2-3 phrases)`,
    `2. **Points clés abordés** (liste à puces)`,
    `3. **Décisions prises** (liste à puces, "Aucune" si applicable)`,
    `4. **Actions à suivre** (liste avec responsable si mentionné)`,
    `5. **Notes importantes** (optionnel)`,
    ``,
    hasContent
      ? `Utilise le contenu fourni pour rédiger le compte-rendu. Sois précis et concret.`
      : `La réunion vient de se terminer. Génère un compte-rendu type pour une réunion intitulée "${title}" avec les participants mentionnés.`,
  ].filter(s => s !== undefined && s !== false).join('\n');

  const apiMessages = [
    { role: 'system', content: 'Tu es expert en rédaction de comptes-rendus de réunion professionnels. Réponds en français structuré avec du Markdown.' },
    { role: 'user',   content: userContent },
  ];

  try {
    const summary = await callOpenRouter(apiMessages, 2048);
    res.json({ ok: true, summary });
  } catch(e) {
    console.error('[generateSummary]', e.message);
    res.json({ ok: false, error: e.message });
  }
}

// ─── GET /api/meetings/ice-servers ───────────────────────────────────────────
function getIceServers(req, res) {
  const secret = process.env.TURN_SECRET;
  const domain = process.env.TURN_DOMAIN || 'netiify.cloud';

  if (!secret) {
    return res.json({
      ok: true,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
  }

  const ttl        = 3600;
  const timestamp  = Math.floor(Date.now() / 1000) + ttl;
  const username   = `${timestamp}:webrtc`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  res.json({
    ok: true,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: [
          `turn:${domain}:3478`,
          `turn:${domain}:3478?transport=tcp`,
          `turns:${domain}:5349?transport=tcp`,
          
        ],
        username,
        credential,
      },
    ],
  });
}

module.exports = {
  showRoom, createMeeting,
  getMyMeetings, getMeetingHistory,
  startMeeting, endMeeting,
  joinByCode, verifyCode, deleteMeeting, submitReview,
  aiChat, generateSummary,
  getIceServers, uploadChatFile, chatUploadStorage,
};
