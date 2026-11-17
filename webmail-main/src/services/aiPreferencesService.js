/**
 * src/services/aiPreferencesService.js
 * Préférences de l'assistant IA (ton, langue, formule de politesse, durée de réunion, horaires…).
 * Les valeurs sont toujours validées : elles sont injectées dans les prompts.
 */
const { pool } = require('./db');
const { TONES } = require('./aiPrompts');

const LANGS = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', ar: 'arabe' };
const DURATIONS = [15, 30, 45, 60, 90, 120];
const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440];
const RETENTIONS = [0, 7, 30, 90, 365];                       // jours ; 0 = conserver jusqu'à suppression manuelle
const envRetention = () => { const n = parseInt(process.env.AI_DEFAULT_RETENTION_DAYS, 10); return RETENTIONS.includes(n) ? n : 0; };

const DEFAULTS = Object.freeze({
  tone: 'formel', language: 'fr', closing: '', meetingDuration: 60, reminderMinutes: 15, workStart: 8, workEnd: 18, weekends: false, retentionDays: envRetention(),
});

const int = (v, min, max, d) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= min && n <= max ? n : d; };

/** Valide un objet de préférences (valeurs inconnues → défauts). */
function sanitize(raw = {}, base = DEFAULTS) {
  const closing = String(raw.closing ?? base.closing ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 200).trim();
  let workStart = int(raw.workStart, 0, 23, base.workStart);
  let workEnd = int(raw.workEnd, 1, 24, base.workEnd);
  if (workEnd <= workStart) { workStart = DEFAULTS.workStart; workEnd = DEFAULTS.workEnd; }
  const dur = parseInt(raw.meetingDuration, 10);
  const rem = parseInt(raw.reminderMinutes, 10);
  return {
    tone: TONES[raw.tone] ? raw.tone : base.tone,
    language: LANGS[raw.language] ? raw.language : base.language,
    closing,
    meetingDuration: DURATIONS.includes(dur) ? dur : base.meetingDuration,
    reminderMinutes: REMINDERS.includes(rem) ? rem : base.reminderMinutes,
    workStart, workEnd,
    weekends: raw.weekends === undefined ? !!base.weekends : (raw.weekends === true || raw.weekends === 'true' || raw.weekends === 1),
    retentionDays: RETENTIONS.includes(parseInt(raw.retentionDays, 10)) ? parseInt(raw.retentionDays, 10) : (base.retentionDays ?? envRetention()),
  };
}

async function get(owner) {
  const [rows] = await pool.execute(`SELECT * FROM ai_preferences WHERE owner_email = ?`, [owner]);
  if (!rows[0]) return { ...DEFAULTS };
  const r = rows[0];
  return sanitize({
    tone: r.tone, language: r.language, closing: r.closing, meetingDuration: r.meeting_duration,
    reminderMinutes: r.reminder_minutes, workStart: r.work_start, workEnd: r.work_end, weekends: !!r.weekends, retentionDays: r.retention_days,
  });
}

async function save(owner, raw) {
  const current = await get(owner);
  const p = sanitize(raw, current);
  await pool.execute(
    `INSERT INTO ai_preferences (owner_email, tone, language, closing, meeting_duration, reminder_minutes, work_start, work_end, weekends, retention_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tone=VALUES(tone), language=VALUES(language), closing=VALUES(closing), meeting_duration=VALUES(meeting_duration),
       reminder_minutes=VALUES(reminder_minutes), work_start=VALUES(work_start), work_end=VALUES(work_end), weekends=VALUES(weekends), retention_days=VALUES(retention_days)`,
    [owner, p.tone, p.language, p.closing, p.meetingDuration, p.reminderMinutes, p.workStart, p.workEnd, p.weekends ? 1 : 0, p.retentionDays]
  );
  return p;
}

async function remove(owner) { await pool.execute(`DELETE FROM ai_preferences WHERE owner_email = ?`, [owner]); }

module.exports = { get, save, remove, sanitize, DEFAULTS, LANGS, DURATIONS, REMINDERS, RETENTIONS };
