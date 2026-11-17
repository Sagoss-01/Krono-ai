/**
 * scripts/run-tests.js — lance tous les tests (tests/*.test.js) avec le lanceur intégré de Node (node --test).
 * Portable (Linux, macOS, Windows) : pas de glob shell. Usage : npm test
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f));
if (!files.length) { console.error('Aucun test trouvé dans tests/'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
