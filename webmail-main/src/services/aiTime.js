/**
 * src/services/aiTime.js
 * Dates « locales » sous forme de chaînes "AAAA-MM-JJTHH:mm" (fuseau de l'utilisateur),
 * sans dépendre du fuseau du serveur. Partagé par l'assistant, l'agenda et les réunions.
 */
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const p2 = (n) => String(n).padStart(2, '0');

function safeTimeZone(tz) {
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return tz; } catch (_) { return 'Africa/Porto-Novo'; }
}

/** Date → "AAAA-MM-JJTHH:mm" dans le fuseau donné. */
function toLocalString(date, timeZone) {
  const d = new Date(date);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(d).replace(' ', 'T');
}

/** Chaîne valide → chaîne normalisée, sinon null. */
function cleanLocal(v) {
  const m = LOCAL_RE.exec(String(v || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}`;
}

/** Chaîne locale → millisecondes « UTC fictives » (comparables entre elles). */
const localMs = (s) => { const m = LOCAL_RE.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); };

function fromLocalMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

const addMinutes = (s, min) => fromLocalMs(localMs(s) + min * 60000);
const nowLocalMs = (timeZone) => localMs(toLocalString(new Date(), timeZone));

/** 0 = dimanche … 6 = samedi, pour une chaîne locale. */
const weekday = (s) => new Date(localMs(s)).getUTCDay();

module.exports = { LOCAL_RE, safeTimeZone, toLocalString, cleanLocal, localMs, fromLocalMs, addMinutes, nowLocalMs, weekday };
