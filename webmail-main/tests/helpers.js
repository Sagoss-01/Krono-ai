/**
 * tests/helpers.js — doublures (stubs) pour tester les services IA sans MySQL, IMAP ni réseau.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(ROOT, rel));

/** Remplace un module par une doublure. Retourne une fonction qui le restaure. */
function stub(rel, exports) {
  const id = resolve(rel);
  const previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
  return () => { if (previous) require.cache[id] = previous; else delete require.cache[id]; };
}

/** Recharge un module en ignorant le cache (après avoir posé des doublures). */
function fresh(rel) {
  const id = resolve(rel);
  delete require.cache[id];
  return require(id);
}

/** Pool MySQL factice qui mémorise les requêtes. */
function fakePool(handler = () => [[]]) {
  const calls = [];
  const run = async (sql, params = []) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return handler(sql, params); };
  const conn = { beginTransaction: async () => calls.push({ sql: 'BEGIN' }), commit: async () => calls.push({ sql: 'COMMIT' }),
    rollback: async () => calls.push({ sql: 'ROLLBACK' }), release() {}, execute: run, query: run };
  return { pool: { execute: run, query: run, getConnection: async () => conn }, calls };
}

module.exports = { stub, fresh, fakePool, ROOT };
