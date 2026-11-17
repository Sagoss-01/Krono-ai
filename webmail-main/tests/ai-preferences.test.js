const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh, fakePool } = require('./helpers');

const restoreDb = stub('src/services/db.js', fakePool());
const prefs = fresh('src/services/aiPreferencesService.js');
restoreDb();

test('sanitize : valeurs inconnues ramenées aux défauts, horaires cohérents', () => {
  const p = prefs.sanitize({ tone: 'agressif', language: 'xx', meetingDuration: 7, reminderMinutes: 3, workStart: 18, workEnd: 8, weekends: 'true' });
  assert.equal(p.tone, 'formel'); assert.equal(p.language, 'fr');
  assert.equal(p.meetingDuration, 60); assert.equal(p.reminderMinutes, 15);
  assert.deepEqual([p.workStart, p.workEnd], [8, 18]);
  assert.equal(p.weekends, true);
});

test('sanitize : valeurs valides conservées, signature nettoyée et limitée', () => {
  const p = prefs.sanitize({ tone: 'amical', language: 'en', closing: '  Cordialement,\u0000 Aude  ', meetingDuration: 30, reminderMinutes: 60, workStart: 9, workEnd: 17 });
  assert.equal(p.tone, 'amical'); assert.equal(p.language, 'en');
  assert.equal(p.closing, 'Cordialement, Aude');
  assert.equal(p.meetingDuration, 30); assert.equal(p.reminderMinutes, 60);
  assert.equal(prefs.sanitize({ closing: 'x'.repeat(500) }).closing.length, 200);
});

test('sanitize : une mise à jour partielle garde les préférences existantes', () => {
  const base = prefs.sanitize({ tone: 'concis', meetingDuration: 45 });
  const next = prefs.sanitize({ language: 'es' }, base);
  assert.equal(next.tone, 'concis'); assert.equal(next.meetingDuration, 45); assert.equal(next.language, 'es');
});
