const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh } = require('./helpers');
const T = require('../src/services/aiTime');

test('aiTime : normalisation, comparaison et ajout de minutes', () => {
  assert.equal(T.cleanLocal('2026-10-16T09:05:00'), '2026-10-16T09:05');
  assert.equal(T.cleanLocal('2026-13-16T09:05'), null);
  assert.equal(T.cleanLocal('n importe quoi'), null);
  assert.equal(T.addMinutes('2026-10-16T23:30', 60), '2026-10-17T00:30');
  assert.ok(T.localMs('2026-10-16T10:00') > T.localMs('2026-10-16T09:59'));
  assert.equal(T.weekday('2026-10-17T10:00'), 6);                       // samedi
  assert.equal(T.toLocalString('2026-10-16T08:00:00Z', 'Africa/Porto-Novo'), '2026-10-16T09:00');   // UTC+1
  assert.equal(T.safeTimeZone('Fuseau/Inexistant'), 'Africa/Porto-Novo');
});

function loadAgenda(events) {
  const restore = stub('src/services/calendarService.js', { listRange: async () => events });
  const agenda = fresh('src/services/aiAgendaService.js');
  return { agenda, restore };
}

const ev = (id, start, end) => ({ id, title: 'RDV ' + id, start_at: new Date(start), end_at: new Date(end), all_day: 0 });

test('findConflicts : chevauchement détecté, bords exacts et événement exclu ignorés', async () => {
  const { agenda, restore } = loadAgenda([
    ev(1, '2026-10-16T09:00:00Z', '2026-10-16T10:00:00Z'),    // 10h00–11h00 locales (UTC+1)
    ev(2, '2026-10-16T12:00:00Z', '2026-10-16T13:00:00Z'),
  ]);
  try {
    const hit = await agenda.findConflicts('a@b.c', '2026-10-16T10:30', '2026-10-16T11:30', 'Africa/Porto-Novo');
    assert.deepEqual(hit.map(c => c.id), [1]);
    assert.equal((await agenda.findConflicts('a@b.c', '2026-10-16T11:00', '2026-10-16T12:00', 'Africa/Porto-Novo')).length, 0);   // simple contiguïté
    assert.equal((await agenda.findConflicts('a@b.c', '2026-10-16T10:30', '2026-10-16T11:30', 'Africa/Porto-Novo', 1)).length, 0);
  } finally { restore(); }
});

test('findFreeSlots : respecte horaires, week-ends et événements existants', async () => {
  const { agenda, restore } = loadAgenda([ev(1, '2099-01-05T08:00:00Z', '2099-01-05T10:00:00Z')]);   // lundi 9h–11h locales
  try {
    const slots = await agenda.findFreeSlots({
      owner: 'a@b.c', timeZone: 'Africa/Porto-Novo', durationMin: 60, fromLocal: '2099-01-05T08:00',
      days: 3, max: 4, workStart: 8, workEnd: 12, weekends: false,
    });
    assert.ok(slots.length >= 2);
    assert.equal(slots[0].startAt, '2099-01-05T08:00');                   // avant le RDV
    assert.ok(slots.every(s => T.localMs(s.endAt) - T.localMs(s.startAt) === 3600000));
    assert.ok(slots.every(s => !(T.localMs(s.startAt) < T.localMs('2099-01-05T11:00') && T.localMs(s.endAt) > T.localMs('2099-01-05T09:00'))));
    // un samedi n'est jamais proposé sans l'option week-ends
    const sat = await agenda.findFreeSlots({ owner: 'a@b.c', timeZone: 'Africa/Porto-Novo', durationMin: 60, fromLocal: '2099-01-03T08:00', days: 1, workStart: 8, workEnd: 12, weekends: false });
    assert.equal(sat.length, 0);
    const satOk = await agenda.findFreeSlots({ owner: 'a@b.c', timeZone: 'Africa/Porto-Novo', durationMin: 60, fromLocal: '2099-01-03T08:00', days: 1, workStart: 8, workEnd: 12, weekends: true });
    assert.ok(satOk.length > 0);
  } finally { restore(); }
});
