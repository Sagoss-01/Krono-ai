/**
 * src/services/aiMeetingService.js
 * IA pour les réunions : actions à suivre, e-mail de compte-rendu, quiz (enregistré dans la Banque),
 * traduction des sous-titres. Tous les résultats de l'IA sont validés avant d'être renvoyés.
 */
const crypto = require('crypto');
const { pool }   = require('./db');
const aiService  = require('./aiService');
const prompts    = require('./aiPrompts');

const clip = (v, max) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CAPTION_LANGS = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', ar: 'arabe' };

// ── Actions à suivre ───────────────────────────────────────────────────────────
async function extractActions({ summary, timeZone }) {
  const data = await aiService.chatJson([
    { role: 'system', content: prompts.meeting.actions({ timeZone: timeZone || 'Africa/Porto-Novo' }) },
    { role: 'user', content: `Compte-rendu :\n"""\n${clip(summary, 6000)}\n"""` },
  ], { maxTokens: 1200 });

  return (Array.isArray(data.actions) ? data.actions : []).slice(0, 12).map(a => ({
    title: clip(a?.title, 120),
    owner: clip(a?.owner, 60),
    due: DATE_RE.test(String(a?.due || '')) ? a.due : null,
  })).filter(a => a.title);
}

// ── E-mail de compte-rendu ─────────────────────────────────────────────────────
async function draftMinutesEmail({ title, duration, summary }) {
  const data = await aiService.chatJson([
    { role: 'system', content: prompts.meeting.minutesEmail({ title: clip(title, 120) || 'Réunion', duration: clip(duration, 30) }) },
    { role: 'user', content: `Compte-rendu :\n"""\n${clip(summary, 7000)}\n"""` },
  ], { maxTokens: 2200, temperature: 0.4 });
  const subject = clip(data.subject, 150) || `Compte-rendu — ${clip(title, 100) || 'Réunion'}`;
  const body = clip(data.body, 9000);
  if (!body) throw new Error("L'IA n'a pas pu rédiger l'e-mail. Réessayez.");
  return { subject, body };
}


// ── Compte-rendu ───────────────────────────────────────────────────────────────
/** Garde le début et la fin d'un long texte (les réunions longues perdent le milieu, pas l'ouverture ni la conclusion). */
function headTail(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.35);
  return `${t.slice(0, head)}\n[… passage omis …]\n${t.slice(-(max - head))}`;
}

async function summarize({ title, duration, participants, transcript, chat, notes }) {
  const chatText = (Array.isArray(chat) ? chat : []).slice(-80)
    .map(m => `- ${clip(m.displayName, 40) || 'Participant'} : ${clip(m.text, 300)}`).join('\n');
  const parts = [
    transcript ? `### Transcription (sous-titres)\n${headTail(transcript, 9000)}` : '',
    chatText   ? `### Messages du chat\n${clip(chatText, 3500)}` : '',
    notes && String(notes).trim() ? `### Notes collaboratives\n${clip(notes, 2500)}` : '',
  ].filter(Boolean);
  if (parts.join('').length < 80) throw new Error('Pas assez de contenu (sous-titres, chat ou notes) pour rédiger un compte-rendu.');

  return aiService.chat([
    { role: 'system', content: prompts.meeting.summary({
      title: clip(title, 120) || 'Réunion', duration: clip(duration, 30),
      participants: (Array.isArray(participants) ? participants : []).map(p => clip(p, 60)).filter(Boolean).slice(0, 30),
    }) },
    { role: 'user', content: parts.join('\n\n') },
  ], { maxTokens: 2500, temperature: 0.3 });
}

// ── Quiz → Banque ──────────────────────────────────────────────────────────────
function sanitizeQuestion(q) {
  const question = clip(q?.question, 200);
  const options = (Array.isArray(q?.options) ? q.options : []).map(o => clip(o, 100)).filter(Boolean).slice(0, 4);
  const idx = Number.isInteger(q?.correctIdx) ? q.correctIdx : parseInt(q?.correctIdx, 10);
  if (!question || options.length < 2 || !Number.isInteger(idx) || idx < 0 || idx >= options.length) return null;
  return { question, options, correctIdx: idx, points: 1, duration: 30, isBingo: false, speedBonus: false };
}

async function generateQuiz({ owner, meetingTitle, chatMessages, notes, summary, transcript, count, topic }) {
  const n = Math.min(10, Math.max(3, parseInt(count, 10) || 5));
  const lines = (Array.isArray(chatMessages) ? chatMessages : []).slice(-60)
    .map(m => `- ${clip(m.displayName, 40)} : ${clip(m.text, 300)}`).join('\n');
  const content = [
    `Réunion : ${clip(meetingTitle, 120) || 'Réunion'}`,
    summary ? `Compte-rendu :\n${clip(summary, 3500)}` : '',
    transcript ? `Transcription :\n${headTail(transcript, 4500)}` : '',
    notes   ? `Notes :\n${clip(notes, 2500)}` : '',
    lines   ? `Messages du chat :\n${lines.slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');
  if (content.length < 60 && !topic) throw new Error('Pas assez de contenu (chat, notes ou résumé) pour créer un quiz. Précisez un thème.');

  const data = await aiService.chatJson([
    { role: 'system', content: prompts.meeting.quiz({ count: n, topic: clip(topic, 120) }) },
    { role: 'user', content: `Contenu :\n"""\n${content}\n"""` },
  ], { maxTokens: 3000, temperature: 0.5 });

  const questions = (Array.isArray(data.questions) ? data.questions : []).slice(0, n).map(sanitizeQuestion).filter(Boolean);
  if (questions.length < 1) throw new Error("L'IA n'a pas produit de question exploitable. Réessayez.");

  const title = clip(data.title, 120) || `Quiz — ${clip(meetingTitle, 100) || 'Réunion'}`;
  const setId = 'qs_' + crypto.randomBytes(8).toString('hex');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`INSERT INTO quiz_sets (id, owner_email, title) VALUES (?, ?, ?)`, [setId, owner, title]);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await conn.execute(
        `INSERT INTO quiz_set_questions (quiz_set_id, position, question, options, correct_idx, points, duration, is_bingo, speed_bonus)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        [setId, i, q.question, JSON.stringify(q.options), q.correctIdx, q.points, q.duration]
      );
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return { setId, title, count: questions.length };
}

// ── Sous-titres traduits ───────────────────────────────────────────────────────
async function translateCaption(text, targetCode) {
  const target = CAPTION_LANGS[targetCode];
  if (!target) throw new Error('Langue non prise en charge.');
  const out = await aiService.chat([
    { role: 'system', content: prompts.meeting.captionTranslate({ target }) },
    { role: 'user', content: clip(text, 300) },
  ], { maxTokens: 300, temperature: 0.1, tier: 'fast' });
  return clip(out.split('\n')[0], 400);
}

module.exports = { extractActions, draftMinutesEmail, generateQuiz, summarize, headTail, translateCaption, CAPTION_LANGS, sanitizeQuestion };
