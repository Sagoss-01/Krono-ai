/**
 * src/services/meetingAiSummaryService.js
 * Transcription IA d'une réunion + compte-rendu automatique envoyé à l'hôte à la fin.
 *
 * Consentement : rien n'est collecté tant que l'HÔTE n'a pas activé l'option dans la réunion ;
 * tous les participants sont alors prévenus (événement `ai_summary_state`). Seules les phrases
 * FINALES des sous-titres que les participants ont eux-mêmes activés sont conservées, en mémoire
 * uniquement, et effacées à la fin de la réunion. Le compte-rendu est conservé 30 jours.
 */
const { pool } = require('./db');
const messageCrypto = require('./messageCrypto');
const meetingService = require('./meeting');
const aiMeetingService = require('./aiMeetingService');
const { sendSystemMail } = require('./systemMailer');
const aiContext = require('./aiContext');

const MAX_LINES = 1500;
const MAX_CHARS = 120000;
const STALE_MS  = 8 * 3600 * 1000;       // une réunion jamais terminée n'accumule pas indéfiniment
const RETENTION_DAYS = 30;

const states = new Map();                 // meetingId -> { hostEmail, since, lines, chars, finalizing }

const pad = (n) => String(n).padStart(2, '0');

function gc() {
  const now = Date.now();
  for (const [id, st] of states) if (now - st.since > STALE_MS) states.delete(id);
}

function enable(meetingId, hostEmail) {
  gc();
  if (!states.has(meetingId)) states.set(meetingId, { hostEmail, since: Date.now(), lines: [], chars: 0, finalizing: false });
}
function disable(meetingId) { states.delete(meetingId); }
const isEnabled = (meetingId) => states.has(meetingId);

/** Mémorise une phrase finale de sous-titre (doublons consécutifs ignorés). */
function addCaption(meetingId, name, text) {
  const st = states.get(meetingId);
  if (!st) return false;
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (clean.length < 2) return false;
  const who = String(name || 'Participant').slice(0, 60);
  const last = st.lines[st.lines.length - 1];
  if (last && last.name === who && last.text === clean) return false;
  st.lines.push({ at: Date.now(), name: who, text: clean });
  st.chars += clean.length + who.length;
  while ((st.lines.length > MAX_LINES || st.chars > MAX_CHARS) && st.lines.length) {
    const old = st.lines.shift();
    st.chars -= old.text.length + old.name.length;
  }
  return true;
}

function getTranscript(meetingId) {
  const st = states.get(meetingId);
  if (!st || !st.lines.length) return '';
  return st.lines.map(l => `[${pad(new Date(l.at).getHours())}:${pad(new Date(l.at).getMinutes())}] ${l.name} : ${l.text}`).join('\n');
}

// ── Markdown → HTML minimal pour l'e-mail (texte échappé d'abord) ────────────────
function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let html = '', open = false;
  for (const raw of String(md).split('\n')) {
    const line = esc(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) { if (!open) { html += '<ul style="margin:6px 0 10px 18px;padding:0;">'; open = true; } html += `<li style="margin:3px 0;">${li[1]}</li>`; continue; }
    if (open) { html += '</ul>'; open = false; }
    html += line.trim() ? `<p style="margin:8px 0;">${line}</p>` : '';
  }
  if (open) html += '</ul>';
  return html;
}

async function saveSummary(meetingId, hostEmail, summary, emailed) {
  await pool.execute(
    `INSERT INTO meeting_ai_summaries (meeting_id, host_email, summary, emailed_at) VALUES (?, ?, ?, ${emailed ? 'NOW()' : 'NULL'})
     ON DUPLICATE KEY UPDATE summary = VALUES(summary), emailed_at = VALUES(emailed_at)`,
    [meetingId, hostEmail, messageCrypto.encryptContent(summary)]
  );
  await pool.execute(`DELETE FROM meeting_ai_summaries WHERE created_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_DAYS} DAY)`);
}

async function getSavedSummary(meetingId, hostEmail) {
  const [rows] = await pool.execute(
    `SELECT summary, emailed_at, created_at FROM meeting_ai_summaries WHERE meeting_id = ? AND host_email = ?`, [meetingId, hostEmail]
  );
  if (!rows[0]) return null;
  return { summary: messageCrypto.decryptContent(rows[0].summary), emailedAt: rows[0].emailed_at, createdAt: rows[0].created_at };
}

/**
 * À appeler quand la réunion se termine. Ne lève jamais (appel « fire and forget »).
 * @param {{meetingId:string, chat?:Array, participants?:string[], duration?:string}} p
 */
async function finalize({ meetingId, chat = [], participants = [], duration = '' }) {
  const st = states.get(meetingId);
  if (!st || st.finalizing) return;
  st.finalizing = true;
  const transcript = getTranscript(meetingId);
  try {
    const meeting = await meetingService.getMeeting(meetingId);
    if (!meeting) return;
    const hostEmail = String(meeting.host || st.hostEmail || '').toLowerCase();
    const summary = await aiContext.run({ user: hostEmail, feature: 'meeting_summary' }, () => aiMeetingService.summarize({ title: meeting.title, duration, participants, transcript, chat }));

    let emailed = false;
    try {
      await sendSystemMail({
        to: hostEmail,
        subject: `Compte-rendu IA — ${meeting.title || 'Réunion'}`,
        text: `Compte-rendu généré automatiquement par l'IA à la fin de la réunion « ${meeting.title} ».\n\n${summary}\n\n— Relisez-le avant de le partager : il peut contenir des erreurs.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:22px;color:#1e293b;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#0891b2;font-weight:700;">Compte-rendu IA</div>
          <h2 style="margin:6px 0 14px;">${String(meeting.title || 'Réunion').replace(/[&<>]/g, '')}</h2>
          ${mdToHtml(summary)}
          <p style="margin-top:18px;font-size:12px;color:#64748b;">Généré automatiquement à partir des sous-titres, du chat et des notes. Relisez-le avant de le partager : il peut contenir des erreurs.</p></div>`,
      });
      emailed = true;
    } catch (e) { console.error('[AI] envoi du compte-rendu à l\'hôte impossible :', e.message); }
    await saveSummary(meetingId, hostEmail, summary, emailed);
    console.log(`[AI] compte-rendu automatique ${emailed ? 'envoyé' : 'enregistré'} pour ${meetingId}`);
  } catch (e) {
    console.warn('[AI] compte-rendu automatique ignoré :', e.message);
  } finally {
    states.delete(meetingId);               // la transcription est effacée dans tous les cas
  }
}

/** La transcription n'est accessible qu'à l'hôte et aux participants de la réunion. */
async function canAccess(meeting, email) {
  const e = String(email || '').toLowerCase();
  if (!meeting || !e) return false;
  if (String(meeting.host || '').toLowerCase() === e) return true;
  const rows = await meetingService.getAttendance(meeting.id).catch(() => []);
  return rows.some(r => String(r.email || '').toLowerCase() === e);
}

module.exports = { canAccess, enable, disable, isEnabled, addCaption, getTranscript, finalize, getSavedSummary, mdToHtml };
