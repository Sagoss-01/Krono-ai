/**
 * src/services/aiAgendaService.js
 * Agenda « intelligent » : détection de conflits et suggestion de créneaux libres.
 * Calcul fait en heure locale de l'utilisateur, dans ses horaires de travail (préférences).
 */
const calendarService = require('./calendarService');
const T = require('./aiTime');

const DAY_MS = 86400000;

/** Événements du propriétaire qui chevauchent [startAt, endAt[ (chaînes locales). */
async function findConflicts(owner, startAt, endAt, timeZone, excludeId = null) {
  const s = T.localMs(startAt), e = T.localMs(endAt);
  // Fenêtre élargie de 2 jours pour absorber les écarts de fuseau, puis comparaison en heure locale
  const rows = await calendarService.listRange(
    owner,
    new Date(T.localMs(startAt) - 2 * DAY_MS).toISOString(),
    new Date(T.localMs(endAt) + 2 * DAY_MS).toISOString(),
  );
  return rows
    .filter(r => r.id !== excludeId)
    .map(r => ({ id: r.id, title: r.title, startAt: T.toLocalString(r.start_at, timeZone), endAt: T.toLocalString(r.end_at, timeZone), allDay: !!r.all_day }))
    .filter(r => !r.allDay && T.localMs(r.startAt) < e && T.localMs(r.endAt) > s);
}

/**
 * Créneaux libres à partir de `fromLocal`, dans les horaires de travail.
 * @param {{owner,timeZone,durationMin,fromLocal?,days?,workStart?,workEnd?,weekends?,max?,excludeId?}} o
 * @returns {Promise<Array<{startAt:string,endAt:string}>>}
 */
async function findFreeSlots(o) {
  const duration = Math.min(480, Math.max(15, Number(o.durationMin) || 60));
  const days = Math.min(14, Math.max(1, Number(o.days) || 7));
  const workStart = Number.isInteger(o.workStart) ? o.workStart : 8;
  const workEnd = Number.isInteger(o.workEnd) ? o.workEnd : 18;
  const max = Math.min(8, Math.max(1, Number(o.max) || 4));
  const now = T.nowLocalMs(o.timeZone);
  const startLocal = o.fromLocal && T.cleanLocal(o.fromLocal) ? T.localMs(T.cleanLocal(o.fromLocal)) : now;
  const from = Math.max(startLocal, now);
  const dayStart = Math.floor(from / DAY_MS) * DAY_MS;
  const windowEnd = dayStart + days * DAY_MS;

  const rows = await calendarService.listRange(
    o.owner, new Date(dayStart - DAY_MS).toISOString(), new Date(windowEnd + DAY_MS).toISOString(),
  );
  const busy = rows
    .filter(r => r.id !== o.excludeId && !r.all_day)
    .map(r => [T.localMs(T.toLocalString(r.start_at, o.timeZone)), T.localMs(T.toLocalString(r.end_at, o.timeZone))])
    .sort((a, b) => a[0] - b[0]);

  const slots = [];
  const step = 30 * 60000;
  for (let day = dayStart; day < windowEnd && slots.length < max; day += DAY_MS) {
    const wd = new Date(day).getUTCDay();
    if (!o.weekends && (wd === 0 || wd === 6)) continue;
    let t = Math.max(day + workStart * 3600000, Math.ceil(from / step) * step);
    const end = day + workEnd * 3600000;
    while (t + duration * 60000 <= end && slots.length < max) {
      const clash = busy.find(([bs, be]) => bs < t + duration * 60000 && be > t);
      if (clash) { t = Math.max(t + step, Math.ceil(clash[1] / step) * step); continue; }
      slots.push({ startAt: T.fromLocalMs(t), endAt: T.fromLocalMs(t + duration * 60000) });
      t += Math.max(duration * 60000, 60 * 60000);   // on espace les propositions
    }
  }
  return slots;
}

module.exports = { findConflicts, findFreeSlots };
