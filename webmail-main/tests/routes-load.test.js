/**
 * Démarrage : routes.js (et donc tous les contrôleurs/services IA) se charge sans erreur,
 * et les routes attendues sont déclarées. Exécuté dans un sous-processus (la base ouvre des minuteurs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('routes.js se charge et déclare les routes IA et Banque de quiz', () => {
  const code = `
    process.env.NODE_ENV = 'test';
    const r = require('./src/routes');
    const list = r.stack.filter(l => l.route).map(l => Object.keys(l.route.methods)[0].toUpperCase() + ' ' + l.route.path);
    console.log(JSON.stringify(list)); process.exit(0);`;
  const out = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stderr);
  const routes = JSON.parse(out.stdout.trim().split('\n').pop());
  for (const expected of [
    'POST /api/ai/chat', 'POST /api/ai/chat/stream', 'GET /api/ai/conversations', 'POST /api/ai/tools',
    'GET /api/ai/preferences', 'POST /api/ai/preferences', 'POST /api/ai/agenda/check',
    'POST /api/ai/meetings/:id/quiz', 'GET /api/meetings/:id/ai-summary', 'GET /api/quiz-sets', 'POST /api/schedule',
  ]) assert.ok(routes.includes(expected), 'route manquante : ' + expected);
});

test('socket.js se charge sans erreur', () => {
  const out = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='test'; require('./src/services/socket'); process.exit(0);"],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stderr);
});
