const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh } = require('./helpers');
const aiContext = require('../src/services/aiContext');

const ENV_KEYS = ['OPEN_ROUTER_API_KEY', 'OPEN_ROUTER_BASE_URL', 'OPEN_ROUTER_MODEL', 'OPEN_ROUTER_FALLBACK_MODELS', 'OPEN_ROUTER_MODEL_FAST'];
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
const realFetch = global.fetch;

/** Prépare l'environnement, un journal d'usage factice et un faux OpenRouter (réponses scénarisées par modèle). */
function setup({ main = 'm-main', fallbacks = 'm-b,m-c', fast = '', settings = {}, script = {} } = {}) {
  Object.assign(process.env, { OPEN_ROUTER_API_KEY: 'k', OPEN_ROUTER_BASE_URL: 'https://api.test/v1', OPEN_ROUTER_MODEL: main, OPEN_ROUTER_FALLBACK_MODELS: fallbacks, OPEN_ROUTER_MODEL_FAST: fast });
  const records = [], calls = [], counts = new Map();
  const usage = {
    getSettings: async () => ({ enabled: true, message: '', dailyCallsPerUser: 300, ...settings }),
    callsToday: async (u) => counts.get(u) || 0, countCall: (u) => counts.set(u, (counts.get(u) || 0) + 1), record: (r) => records.push(r),
  };
  const restore = stub('src/services/aiUsage.js', usage);
  const queues = Object.fromEntries(Object.entries(script).map(([m, v]) => [m, [...v]]));
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body.model);
    const step = (queues[body.model] || [{ ok: 'réponse de ' + body.model }]).shift() || { ok: 'réponse de ' + body.model };
    if (step.throw) throw Object.assign(new Error('boom'), { name: step.throw });
    const status = step.status || 200;
    if (body.stream && status === 200) {
      const chunks = (step.stream || ['Bon', 'jour']).map(t => Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)).concat(Buffer.from('data: [DONE]\n\n'));
      return { ok: true, status, body: (async function* () { yield* chunks; })(), text: async () => '' };
    }
    const payload = status === 200 ? { model: body.model, choices: [{ message: { content: step.empty ? '' : step.ok } }], usage: { total_tokens: 42 } } : { error: 'x' };
    return { ok: status === 200, status, text: async () => JSON.stringify(payload) };
  };
  const svc = fresh('src/services/aiService.js');
  const ask = (opts, user = 'u@x.com', feature = 'test') => aiContext.run({ user, feature }, () => svc.chat([{ role: 'user', content: 'salut' }], opts));
  return { svc, ask, records, calls, counts, restore: () => { restore(); global.fetch = realFetch; ENV_KEYS.forEach(k => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); fresh('src/services/aiService.js'); } };
}

test('configuration : liste de modèles, secours dédoublonnés, petit modèle pour les tâches simples', () => {
  const t = setup({ main: 'a, b', fallbacks: 'b,c', fast: 'petit' });
  try {
    const cfg = t.svc.getConfig();
    assert.equal(cfg.model, 'a'); assert.deepEqual(cfg.fallbacks, ['b', 'c']); assert.equal(cfg.fast, 'petit');
    assert.deepEqual(t.svc.modelChain('main'), ['a', 'b', 'c']);
    assert.deepEqual(t.svc.modelChain('fast'), ['petit', 'a', 'b', 'c']);
  } finally { t.restore(); }
  const noFast = setup({ fast: '' });
  try { assert.deepEqual(noFast.svc.modelChain('fast'), noFast.svc.modelChain('main')); } finally { noFast.restore(); }
});

test('bascule : le modèle principal échoue (500) → le secours répond, l\'usage est journalisé', async () => {
  const t = setup({ script: { 'm-main': [{ status: 500 }] } });
  try {
    assert.equal(await t.ask({}), 'réponse de m-b');
    assert.deepEqual(t.calls, ['m-main', 'm-b']);
    const r = t.records[0];
    assert.deepEqual([r.ok, r.model, r.user, r.feature, r.tokens], [true, 'm-b', 'u@x.com', 'test', 42]);
  } finally { t.restore(); }
});

test('bascule : réponse vide, délai dépassé et 429 passent au modèle suivant', async () => {
  const t = setup({ script: { 'm-main': [{ empty: true }], 'm-b': [{ throw: 'TimeoutError' }] } });
  try {
    assert.equal(await t.ask({}), 'réponse de m-c');
    assert.deepEqual(t.calls, ['m-main', 'm-b', 'm-c']);
  } finally { t.restore(); }
});

test('clé invalide (401) ou crédits épuisés (402) : arrêt immédiat, pas d\'essai des autres modèles', async () => {
  const t = setup({ script: { 'm-main': [{ status: 401 }] } });
  try {
    await assert.rejects(() => t.ask({}), (e) => e.code === 'auth_401' && /Clé API IA invalide/.test(e.message));
    assert.deepEqual(t.calls, ['m-main']);
    assert.equal(t.svc.healthSnapshot().keyProblem, 'auth_401');
    assert.equal(t.records[0].ok, false); assert.equal(t.records[0].error, 'auth_401');
  } finally { t.restore(); }
});

test('tous les modèles en échec : erreur claire, échec journalisé', async () => {
  const t = setup({ fallbacks: '', script: { 'm-main': [{ status: 400 }] } });
  try {
    await assert.rejects(() => t.ask({}), /Erreur du service IA/);
    assert.equal(t.records.length, 1); assert.equal(t.records[0].ok, false);
  } finally { t.restore(); }
});

test('disjoncteur : après 3 échecs d\'affilée, le modèle est ignoré (plus aucun appel) puis la santé le montre', async () => {
  const t = setup({ script: { 'm-main': [{ status: 500 }, { status: 500 }, { status: 500 }] } });
  try {
    for (let i = 0; i < 3; i++) await t.ask({});
    t.calls.length = 0;
    await t.ask({});
    assert.ok(!t.calls.includes('m-main'), 'le modèle en panne ne doit plus être appelé');
    const b = t.svc.healthSnapshot().breakers.find(x => x.model === 'm-main');
    assert.equal(b.open, true); assert.equal(b.lastError, 'server_5xx'); assert.ok(b.reopenInSec > 0);
  } finally { t.restore(); }
});

test('petit modèle : les tâches « fast » l\'essaient d\'abord et retombent sur le principal', async () => {
  const t = setup({ fast: 'm-fast', script: { 'm-fast': [{ status: 500 }] } });
  try {
    await t.ask({ tier: 'fast' });
    assert.deepEqual(t.calls, ['m-fast', 'm-main']);
    t.calls.length = 0;
    await t.ask({});
    assert.deepEqual(t.calls, ['m-main']);                                   // une tâche normale n'utilise pas le petit modèle
    assert.equal(t.records.find(r => r.tier === 'fast').model, 'm-main');
  } finally { t.restore(); }
});

test('interrupteur administrateur : aucun appel réseau, message personnalisé, santé non bloquée', async () => {
  const t = setup({ settings: { enabled: false, message: 'Maintenance jusqu\'à 18 h.' } });
  try {
    await assert.rejects(() => t.ask({}), (e) => e.code === 'disabled' && e.message === 'Maintenance jusqu\'à 18 h.');
    assert.equal(t.calls.length, 0);
    const ping = await t.svc.pingAll();
    assert.ok(ping.length === 3 && ping.every(p => p.ok));                  // le test de santé fonctionne même IA coupée
  } finally { t.restore(); }
});

test('quota journalier : refusé au-delà de la limite, par utilisateur, « système » exempté', async () => {
  const t = setup({ settings: { dailyCallsPerUser: 2 } });
  try {
    await t.ask({}); await t.ask({});
    await assert.rejects(() => t.ask({}), (e) => e.code === 'quota' && /2 requêtes/.test(e.message));
    await t.ask({}, 'autre@x.com');                                           // un autre utilisateur n'est pas touché
    for (let i = 0; i < 5; i++) await t.ask({}, 'système');                   // les tâches automatiques ne consomment pas de quota
    assert.equal(t.counts.get('système'), undefined);
  } finally { t.restore(); }
});

test('streaming : bascule sur le secours avant le premier mot, les morceaux arrivent dans l\'ordre', async () => {
  const t = setup({ script: { 'm-main': [{ status: 503 }], 'm-b': [{ stream: ['Bon', 'jour ', 'Aude'] }] } });
  try {
    const got = [];
    const text = await aiContext.run({ user: 'u@x.com', feature: 'chat' }, () => t.svc.chatStream([{ role: 'user', content: 'x' }], {}, (d) => got.push(d)));
    assert.equal(text, 'Bonjour Aude');
    assert.deepEqual(got, ['Bon', 'jour ', 'Aude']);
    assert.deepEqual(t.calls, ['m-main', 'm-b']);
  } finally { t.restore(); }
});

test('test de santé : un appel par modèle, sans bascule, avec le résultat de chacun', async () => {
  const t = setup({ fast: 'm-fast', script: { 'm-b': [{ status: 500 }] } });
  try {
    const res = await t.svc.pingAll();
    assert.deepEqual(res.map(r => [r.model, r.ok]).sort(), [['m-b', false], ['m-c', true], ['m-fast', true], ['m-main', true]]);
    assert.equal(res.find(r => r.model === 'm-b').code, 'server_5xx');
    assert.ok(t.records.every(r => r.feature === 'health'));
  } finally { t.restore(); }
});

test('configuration absente : message clair, aucun appel', async () => {
  const t = setup();
  delete process.env.OPEN_ROUTER_API_KEY;
  try { await assert.rejects(() => t.ask({}), (e) => e.code === 'not_configured'); assert.equal(t.calls.length, 0); } finally { t.restore(); }
});
