const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh } = require('./helpers');

const crypto = { isConfigured: true, encryptContent: (v) => 'enc:' + Buffer.from(String(v)).toString('base64'), decryptContent: (v) => Buffer.from(String(v).replace(/^enc:/, ''), 'base64').toString() };

/** Pool factice : enregistre les requêtes ; `answers` donne les réponses dans l'ordre (ou une fonction). */
function fakePool(answers = []) {
  const calls = [], queue = Array.isArray(answers) ? [...answers] : null;
  const run = async (sql, params = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (typeof answers === 'function') return answers(sql, params);
    return queue.length ? queue.shift() : [[]];
  };
  return { pool: { execute: run, query: run }, calls };
}
const flush = () => new Promise(r => setImmediate(r));

test('audit : seules les actions connues sont journalisées, le texte est nettoyé et borné', async () => {
  const fp = fakePool([[{}], [[{ ts: '2026-10-22T09:00:00Z', user_key: 'a@x.com', action: 'email_sent', detail: 'Rapport' }]]]);
  const r = stub('src/services/db.js', { pool: fp.pool });
  try {
    const audit = fresh('src/services/aiAuditService.js');
    audit.log('A@X.com', 'pirater_la_nasa', 'x');                                      // action inconnue : ignorée
    audit.log('A@X.com', 'email_sent', 'Rapport\u0000\n' + 'x'.repeat(900));
    await flush();
    assert.equal(fp.calls.length, 1);
    assert.equal(fp.calls[0].params[0], 'a@x.com');                                      // identité normalisée
    assert.ok(fp.calls[0].params[2].length <= 500 && !/[\u0000\n]/.test(fp.calls[0].params[2]));
    const rows = await audit.recent(5);
    assert.deepEqual(rows[0], { ts: '2026-10-22T09:00:00Z', user: 'a@x.com', action: 'email_sent', label: 'E-mail envoyé', detail: 'Rapport' });
  } finally { r(); fresh('src/services/aiAuditService.js'); }
});

test('signalements : contenu chiffré, fonctionnalité contrôlée, limite de 20 par jour, export en cas rejouables', async () => {
  let count = 0;
  const fp = fakePool((sql) => {
    if (sql.includes('COUNT(*)')) return [[{ n: count }]];
    if (sql.startsWith('SELECT id, DATE_FORMAT')) return [[{ id: 3, ts: 't', user_key: 'a@x.com', feature: 'whiteboard', prompt: crypto.encryptContent('fais un site'), response: crypto.encryptContent('raté'), note: 'trop simple' }]];
    return [{}];
  });
  const restores = [stub('src/services/db.js', { pool: fp.pool }), stub('src/services/messageCrypto.js', crypto)];
  try {
    const fb = fresh('src/services/aiFeedbackService.js');
    await fb.add('A@x.com', { feature: 'assistant', prompt: 'Écris à Jean', response: 'Voici', note: 'mauvais ton' });
    const insert = fp.calls.find(c => c.sql.startsWith('INSERT'));
    assert.ok(insert.params[2].startsWith('enc:') && insert.params[3].startsWith('enc:'));        // demande et réponse chiffrées
    assert.ok(!insert.params[2].includes('Jean'));
    await assert.rejects(() => fb.add('a@x.com', { feature: 'nimporte', prompt: 'x', response: 'y' }), /Fonctionnalité inconnue/);
    await assert.rejects(() => fb.add('', { feature: 'assistant', prompt: 'x', response: 'y' }), /authentifié/);
    count = fb.DAILY_LIMIT;
    await assert.rejects(() => fb.add('a@x.com', { feature: 'assistant', prompt: 'x', response: 'y' }), /Limite de signalements/);
    const cases = await fb.asEvalCases();
    assert.deepEqual(cases, [{ id: 'feedback-3', feature: 'whiteboard', prompt: 'fais un site', expect: {}, note: 'trop simple' }]);
  } finally { restores.reverse().forEach(x => x()); fresh('src/services/aiFeedbackService.js'); }
});

test('réglages : interrupteur et quota validés, lecture avec valeurs par défaut sûres', async () => {
  const stored = new Map();
  const fp = fakePool((sql, p) => {
    if (sql.startsWith('INSERT INTO ai_settings')) { stored.set(p[0], p[1]); return [{}]; }
    if (sql.startsWith('SELECT setting_key')) return [[...stored].map(([setting_key, value]) => ({ setting_key, value }))];
    return [[]];
  });
  const r = stub('src/services/db.js', { pool: fp.pool });
  const saved = process.env.AI_DAILY_CALLS_PER_USER;
  try {
    delete process.env.AI_DAILY_CALLS_PER_USER;
    const usage = fresh('src/services/aiUsage.js');
    assert.deepEqual(await usage.getSettings(true), { enabled: true, message: '', dailyCallsPerUser: 300 });
    const s = await usage.saveSettings({ enabled: false, message: 'Maintenance\u0000 18h', dailyCallsPerUser: '50' }, 'admin@x.com');
    assert.deepEqual(s, { enabled: false, message: 'Maintenance  18h', dailyCallsPerUser: 50 });
    await assert.rejects(() => usage.saveSettings({ dailyCallsPerUser: -5 }, 'a'), /Quota invalide/);
    await assert.rejects(() => usage.saveSettings({ dailyCallsPerUser: 'beaucoup' }, 'a'), /Quota invalide/);
    assert.equal(await usage.callsToday('u@x.com'), 0);
    usage.countCall('u@x.com'); usage.countCall('u@x.com');
    assert.equal(await usage.callsToday('u@x.com'), 2);
    process.env.AI_DAILY_CALLS_PER_USER = '12';
    assert.equal(usage.defaults().dailyCallsPerUser, 12);
  } finally { r(); if (saved === undefined) delete process.env.AI_DAILY_CALLS_PER_USER; else process.env.AI_DAILY_CALLS_PER_USER = saved; fresh('src/services/aiUsage.js'); }
});

test('statistiques : taux d\'échec, percentiles de latence, regroupements', async () => {
  const fp = fakePool([
    [[{ calls: 10, failures: 2, tokens: 500 }]],
    [Array.from({ length: 8 }, (_, i) => ({ latency_ms: (i + 1) * 100 }))],
    [[{ user: 'a@x.com', calls: 6, failures: 1, tokens: 300 }]],
    [[{ feature: 'assistant', calls: 7, failures: 2, avg_ms: 950 }]],
    [[{ model: 'm-b', calls: 10, failures: 2, avg_ms: 900 }]],
    [[{ error_code: 'timeout', n: 2 }]],
    [[{ slot: '2026-10-22 09:00', calls: 10, failures: 2 }]],
  ]);
  const r = stub('src/services/db.js', { pool: fp.pool });
  try {
    const usage = fresh('src/services/aiUsage.js');
    const st = await usage.stats(24);
    assert.equal(st.calls, 10); assert.equal(st.failures, 2); assert.equal(st.failureRate, 0.2);
    assert.deepEqual(st.latency, { p50: 500, p95: 800 });
    assert.deepEqual(st.errors, [{ code: 'timeout', n: 2 }]);
    assert.equal(st.byUser[0].user, 'a@x.com');
    assert.ok(fp.calls.every(c => !/[;]\s*DROP/i.test(c.sql)));
    const fp2 = fakePool([[[{ calls: 0, failures: 0, tokens: 0 }]], [[]], [[]], [[]], [[]], [[]], [[]]]);
    const r2 = stub('src/services/db.js', { pool: fp2.pool });
    try { await fresh('src/services/aiUsage.js').stats("1; DROP TABLE x"); } finally { r2(); }
    assert.ok(fp2.calls.every(c => !/DROP/i.test(c.sql) && /INTERVAL 24 HOUR/.test(c.sql)), 'une période invalide retombe sur 24 h, sans jamais entrer dans le SQL');
  } finally { r(); fresh('src/services/aiUsage.js'); }
});

test('conservation : la purge applique la durée de chaque utilisateur, avec une valeur par défaut', async () => {
  const fp = fakePool([[{ affectedRows: 4 }]]);
  const restores = [stub('src/services/db.js', { pool: fp.pool }), stub('src/services/messageCrypto.js', crypto)];
  try {
    const chat = fresh('src/services/aiChatService.js');
    assert.equal(await chat.purgeExpired(90), 4);
    assert.match(fp.calls[0].sql, /COALESCE\(p\.retention_days, \?\) > 0/);
    assert.deepEqual(fp.calls[0].params, [90, 90]);
  } finally { restores.reverse().forEach(x => x()); fresh('src/services/aiChatService.js'); }
  const prefs = fresh('src/services/aiPreferencesService.js');
  assert.equal(prefs.sanitize({ retentionDays: 30 }).retentionDays, 30);
  assert.equal(prefs.sanitize({ retentionDays: 17 }).retentionDays, prefs.DEFAULTS.retentionDays);       // valeur hors liste : défaut
  assert.equal(prefs.sanitize({ retentionDays: 'abc' }).retentionDays, prefs.DEFAULTS.retentionDays);
  assert.equal(prefs.sanitize({ language: 'en' }, prefs.sanitize({ retentionDays: 90 })).retentionDays, 90);   // mise à jour partielle : valeur conservée
});
