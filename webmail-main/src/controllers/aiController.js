/**
 * src/controllers/aiController.js
 * API de l'assistant IA du webmail :
 *   - conversations persistées (liste, messages, suppression, renommage)
 *   - chat avec cartes d'action
 *   - état des cartes (envoyé / créé / ignoré)
 *   - outils IA dans la lecture et la rédaction des e-mails (résumé, réponse, correction, traduction, dates, recherche…)
 */
const aiService   = require('../services/aiService');
const aiContext   = require('../services/aiContext');
const audit       = require('../services/aiAuditService');
const feedbackService = require('../services/aiFeedbackService');
const chatService = require('../services/aiChatService');
const assistant   = require('../services/aiAssistantService');
const prompts     = require('../services/aiPrompts');
const meetAI      = require('../services/aiMeetingService');
const meetingService = require('../services/meeting');
const meetingAiSummary = require('../services/meetingAiSummaryService');
const prefsService = require('../services/aiPreferencesService');
const agendaService = require('../services/aiAgendaService');
const T = require('../services/aiTime');
const { getActiveCredentials } = require('./mailController');

const activeEmail = (req) => (req.session.activeAccount || req.session.accounts?.[0]?.email || '').toLowerCase();
const MAX_TEXT = 12000;

const clip = (v, max = MAX_TEXT) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const fail = (res, e, fallback = 'Erreur IA') => {
  console.error('[AI]', e.message);
  return res.json({ ok: false, error: e.message || fallback });
};

// ── Conversations ────────────────────────────────────────────────────────────
async function listConversations(req, res) {
  try { res.json({ ok: true, conversations: await chatService.listConversations(activeEmail(req)) }); }
  catch (e) { fail(res, e); }
}

async function getMessages(req, res) {
  try {
    const owner = activeEmail(req);
    const conv = await chatService.getConversation(owner, req.params.id);
    if (!conv) return res.status(404).json({ ok: false, error: 'Conversation introuvable' });
    res.json({ ok: true, conversation: conv, messages: await chatService.getMessages(owner, conv.id) });
  } catch (e) { fail(res, e); }
}

async function removeConversation(req, res) {
  try {
    const ok = await chatService.deleteConversation(activeEmail(req), req.params.id);
    res.json({ ok });
  } catch (e) { fail(res, e); }
}

async function renameConversation(req, res) {
  try {
    const title = clip(req.body?.title, 80);
    if (!title) return res.json({ ok: false, error: 'Titre requis' });
    res.json({ ok: await chatService.renameConversation(activeEmail(req), req.params.id, title) });
  } catch (e) { fail(res, e); }
}

// ── Chat ─────────────────────────────────────────────────────────────────────
/** Charge la conversation demandée et valide le message. Renvoie { error } ou le contexte. */
async function prepareChat(req) {
  const owner = activeEmail(req);
  if (!owner) return { status: 401, error: 'Non authentifié' };
  const message = clip(req.body?.message, 4000);
  if (!message) return { error: 'Message vide' };
  let conv = null, history = [];
  if (req.body?.conversationId) {
    conv = await chatService.getConversation(owner, String(req.body.conversationId));
    if (!conv) return { status: 404, error: 'Conversation introuvable' };
    history = await chatService.getHistoryForModel(owner, conv.id);
  }
  return { owner, message, conv, history, creds: getActiveCredentials(req), timeZone: req.body?.timeZone };
}

/** Enregistre l'échange (après l'appel IA : un échec ne crée aucune conversation vide). */
async function persistChat({ owner, message, conv }, result) {
  const isNew = !conv;
  if (isNew) conv = await chatService.createConversation(owner, message);
  await chatService.addMessage(conv.id, 'user', message, null);
  const messageId = await chatService.addMessage(conv.id, 'assistant', result.reply, result.cards);
  return {
    conversation: { id: conv.id, title: conv.title, isNew },
    message: { id: messageId, role: 'assistant', content: result.reply, cards: result.cards },
  };
}

async function chat(req, res) {
  try {
    const ctx = await prepareChat(req);
    if (ctx.error) return res.status(ctx.status || 200).json({ ok: false, error: ctx.error });
    const result = await assistant.respond(ctx);
    res.json({ ok: true, ...(await persistChat(ctx, result)) });
  } catch (e) { fail(res, e); }
}

/** Même chose en streaming : une ligne JSON par événement (status, delta, reset, done, error). */
async function chatStream(req, res) {
  let ctx;
  try { ctx = await prepareChat(req); } catch (e) { return fail(res, e); }
  if (ctx.error) return res.status(ctx.status || 200).json({ ok: false, error: ctx.error });

  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = (obj) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(obj) + '\n'); };

  try {
    const result = await assistant.respond({
      ...ctx,
      onDelta:  (text) => send({ t: 'delta', text }),
      onReset:  () => send({ t: 'reset' }),
      onStatus: (text) => send({ t: 'status', text }),
    });
    send({ t: 'done', ...(await persistChat(ctx, result)) });
  } catch (e) {
    console.error('[AI]', e.message);
    send({ t: 'error', error: e.message || 'Erreur IA' });
  }
  res.end();
}

// Actions de cartes journalisées (le navigateur signale l'état APRÈS la réussite de l'opération réelle)
const CARD_AUDIT = {
  email_draft: { sent: 'email_sent', scheduled: 'email_scheduled' }, calendar_event: { created: 'event_created' },
  calendar_event_update: { updated: 'event_updated' }, calendar_event_delete: { deleted: 'event_deleted' },
  contact: { created: 'contact_created' }, meeting: { created: 'meeting_created', started: 'meeting_created' },
};

// ── Signalement d'une réponse ratée ──────────────────────────────────────────────────────────────────────
async function sendFeedback(req, res) {
  try {
    const owner = activeEmail(req);
    const b = req.body || {};
    let prompt = clip(b.prompt, 2000), response = clip(b.response, 6000);
    if (b.messageId) {                                              // assistant du webmail : on relit l'échange en base (authentique)
      const msgs = await chatService.getMessages(owner, String(b.conversationId || ''), 400);
      const i = msgs.findIndex(m => m.id === Number(b.messageId));
      if (i < 0 || msgs[i].role !== 'assistant') return res.json({ ok: false, error: 'Message introuvable.' });
      response = msgs[i].content;
      prompt = [...msgs.slice(0, i)].reverse().find(m => m.role === 'user')?.content || '';
    }
    if (!response) return res.json({ ok: false, error: 'Rien à signaler.' });
    await feedbackService.add(owner, { feature: b.feature, prompt, response, note: b.note });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
}

// ── Préférences de l'assistant ───────────────────────────────────────────────
async function getPreferences(req, res) {
  try { res.json({ ok: true, preferences: await prefsService.get(activeEmail(req)) }); } catch (e) { fail(res, e); }
}

async function savePreferences(req, res) {
  try { res.json({ ok: true, preferences: await prefsService.save(activeEmail(req), req.body || {}) }); } catch (e) { fail(res, e); }
}

// ── Agenda : conflits et créneaux libres pour une plage donnée ───────────────
async function agendaCheck(req, res) {
  try {
    const owner = activeEmail(req);
    const tz = T.safeTimeZone(req.body?.timeZone);
    const startAt = T.cleanLocal(req.body?.startAt), endAt = T.cleanLocal(req.body?.endAt);
    if (!startAt || !endAt || T.localMs(endAt) <= T.localMs(startAt)) return res.json({ ok: true, conflicts: [], slots: [] });
    const excludeId = Number.isInteger(Number(req.body?.excludeId)) ? Number(req.body.excludeId) : null;
    const conflicts = await agendaService.findConflicts(owner, startAt, endAt, tz, excludeId);
    let slots = [];
    if (conflicts.length) {
      const prefs = await prefsService.get(owner);
      slots = await agendaService.findFreeSlots({
        owner, timeZone: tz, durationMin: (T.localMs(endAt) - T.localMs(startAt)) / 60000, days: 7, max: 3, excludeId,
        workStart: prefs.workStart, workEnd: prefs.workEnd, weekends: prefs.weekends,
      });
    }
    res.json({ ok: true, conflicts: conflicts.slice(0, 3).map(c => ({ title: c.title, startAt: c.startAt, endAt: c.endAt })), slots });
  } catch (e) { fail(res, e); }
}

async function setCardState(req, res) {
  try {
    const status = ['sent', 'scheduled', 'created', 'updated', 'started', 'deleted', 'dismissed', 'pending'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.json({ ok: false, error: 'Statut invalide' });
    const patch = { status };
    if (req.body?.detail) patch.detail = clip(req.body.detail, 300);
    const sid = Number(req.body?.scheduleId);
    if (Number.isInteger(sid) && sid > 0) patch.scheduleId = sid;                  // permet d'annuler un envoi programmé après rechargement
    const owner = activeEmail(req);
    const card = await chatService.setCardState(owner, Number(req.params.messageId), String(req.params.cardId), patch);
    if (card) {
      const action = (CARD_AUDIT[card.type] || {})[status];
      if (action) audit.log(owner, action, patch.detail || card.subject || card.title || card.name || '');
    }
    res.json({ ok: !!card });
  } catch (e) { fail(res, e); }
}

// ── Outils IA pour les e-mails ───────────────────────────────────────────────
const REWRITE_MODES = new Set(['correct', 'rephrase', 'shorten', 'formal', 'friendly', 'expand']);
const LANGS = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', ar: 'arabe', it: 'italien' };

async function tools(req, res) {
  const owner = activeEmail(req);
  if (!owner) return res.status(401).json({ ok: false, error: 'Non authentifié' });
  const b = req.body || {};
  const timeZone = b.timeZone || 'Africa/Porto-Novo';

  try {
    switch (b.tool) {
      case 'summarize': {
        const body = clip(b.body);
        if (body.length < 20) return res.json({ ok: false, error: 'Le message est trop court pour être résumé.' });
        const p = prompts.mailTools.summarize({ subject: clip(b.subject, 300), from: clip(b.from, 300), date: clip(b.date, 60), body });
        const text = await aiService.chat([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 900, temperature: 0.3 });
        return res.json({ ok: true, text });
      }
      case 'reply': {
        const body = clip(b.body);
        if (!body) return res.json({ ok: false, error: 'Message introuvable.' });
        const prefs = await prefsService.get(owner);
        const tone = prompts.TONES[b.tone] ? b.tone : prefs.tone;
        const p = prompts.mailTools.reply({ subject: clip(b.subject, 300), from: clip(b.from, 300), body, tone, instruction: clip(b.instruction, 500), userEmail: owner, closing: prefs.closing });
        const text = await aiService.chat([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 1200, temperature: 0.6 });
        return res.json({ ok: true, text });
      }
      case 'rewrite': {
        const text = clip(b.text);
        if (text.length < 3) return res.json({ ok: false, error: 'Écrivez d\'abord votre message.' });
        const mode = REWRITE_MODES.has(b.mode) ? b.mode : 'rephrase';
        const p = prompts.mailTools.rewrite({ text, mode });
        const out = await aiService.chat([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 2000, temperature: mode === 'correct' ? 0.1 : 0.5, tier: 'fast' });
        return res.json({ ok: true, text: out });
      }
      case 'translate': {
        const text = clip(b.text);
        if (!text) return res.json({ ok: false, error: 'Rien à traduire.' });
        const target = LANGS[b.target] || LANGS.fr;
        const p = prompts.mailTools.translate({ text, target });
        const out = await aiService.chat([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 2500, temperature: 0.2, tier: 'fast' });
        return res.json({ ok: true, text: out });
      }
      case 'subject': {
        const body = clip(b.body, 6000);
        if (body.length < 10) return res.json({ ok: false, error: 'Écrivez d\'abord le message pour générer un objet.' });
        const p = prompts.mailTools.subject({ body });
        const out = await aiService.chat([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 60, temperature: 0.4, tier: 'fast' });
        const subject = out.split('\n')[0].replace(/^(objet|subject)\s*:\s*/i, '').replace(/^["'«\s]+|["'»\s.]+$/g, '').slice(0, 120);
        return res.json({ ok: true, text: subject });
      }
      case 'extract_dates': {
        const body = clip(b.body);
        const p = prompts.mailTools.extractDate({ subject: clip(b.subject, 300), body, timeZone });
        const data = await aiService.chatJson([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 900 });
        const events = [];
        for (const e of (Array.isArray(data.events) ? data.events : []).slice(0, 5)) {
          const card = await assistant.sanitizeCard({ type: 'calendar_event', ...e, attendees: [] }, {
            owner, timeZone, allowed: new Set(), userEmails: new Set([owner]),
          });
          if (card) events.push({ title: card.title, startAt: card.startAt, endAt: card.endAt, location: card.location, description: card.description });
        }
        return res.json({ ok: true, events });
      }
      case 'nl_search': {
        const query = clip(b.query, 300);
        if (query.length < 3) return res.json({ ok: false, error: 'Décrivez les e-mails que vous cherchez.' });
        const p = prompts.mailTools.nlSearch({ query, timeZone });
        const data = await aiService.chatJson([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { maxTokens: 300 });
        const card = await assistant.sanitizeCard({ type: 'mail_search', ...data }, { owner, timeZone, allowed: new Set(), userEmails: new Set([owner]) });
        return res.json({ ok: true, criteria: card ? {
          folder: card.folder, from: card.from, subject: card.subject, since: card.since, before: card.before,
          unread: card.unread, starred: card.starred, hasAttachment: card.hasAttachment,
        } : null });
      }
      default:
        return res.json({ ok: false, error: 'Outil IA inconnu.' });
    }
  } catch (e) { fail(res, e); }
}

// ── Réunions ─────────────────────────────────────────────────────────────────
async function meetingActions(req, res) {
  try {
    const summary = clip(req.body?.summary, 8000);
    if (summary.length < 30) return res.json({ ok: false, error: 'Le compte-rendu est trop court.' });
    const actions = await meetAI.extractActions({ summary, timeZone: req.body?.timeZone });
    res.json({ ok: true, actions });
  } catch (e) { fail(res, e); }
}

async function meetingMinutes(req, res) {
  try {
    const email = activeEmail(req);
    const meeting = await meetingService.getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ ok: false, error: 'Réunion introuvable' });
    const summary = clip(req.body?.summary, 8000);
    if (summary.length < 30) return res.json({ ok: false, error: 'Le compte-rendu est trop court.' });
    const draft = await meetAI.draftMinutesEmail({ title: meeting.title, duration: req.body?.duration, summary });

    // Destinataires proposés : participants présents (réservé à l'hôte, comme le rapport de présence)
    let recipients = [];
    if (meeting.host === email) {
      const rows = await meetingService.getAttendance(req.params.id).catch(() => []);
      recipients = [...new Set(rows.map(r => String(r.email || '').toLowerCase()).filter(e => e && e.includes('@') && e !== email))];
    }
    res.json({ ok: true, ...draft, recipients, isHost: meeting.host === email });
  } catch (e) { fail(res, e); }
}

async function meetingQuiz(req, res) {
  try {
    const email = activeEmail(req);
    const meeting = await meetingService.getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ ok: false, error: 'Réunion introuvable' });
    const transcript = (await meetingAiSummary.canAccess(meeting, email)) ? meetingAiSummary.getTranscript(req.params.id) : '';
    const result = await meetAI.generateQuiz({
      owner: email, meetingTitle: meeting.title, transcript,
      chatMessages: req.body?.chatMessages, notes: req.body?.notes, summary: req.body?.summary,
      count: req.body?.count, topic: req.body?.topic,
    });
    res.json({ ok: true, ...result });
  } catch (e) { fail(res, e); }
}

const W = aiContext.http;      // chaque requête IA porte l'utilisateur et la fonctionnalité (journal d'usage, quotas)
module.exports = {
  listConversations, getMessages, removeConversation, renameConversation,
  chat: W('assistant', chat), chatStream: W('assistant', chatStream), setCardState, tools: W('mail_tools', tools),
  getPreferences, savePreferences, agendaCheck, sendFeedback,
  meetingActions: W('meeting', meetingActions), meetingMinutes: W('meeting', meetingMinutes), meetingQuiz: W('meeting', meetingQuiz),
};
