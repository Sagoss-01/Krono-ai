/**
 * src/services/aiUsage.js
 * Journal d'usage de l'IA (une ligne par appel), réglages administrateur (interrupteur, quota)
 * et statistiques pour l'écran d'administration. Ne lève jamais : la surveillance ne doit pas casser l'IA.
 */
const DAY_MS = 86400000;
const RETENTION_DAYS = 60;
const SETTINGS_TTL_MS = 10000;

let dbPool = null;
const pool = () => { if (dbPool) return dbPool; try { dbPool = require('./db').pool; } catch (_) { /* base indisponible (tests) */ } return dbPool; };

// ── Réglages (interrupteur, message, quota) avec petit cache ───────────────────────────────────────────
const envQuota = () => { const n = parseInt(process.env.AI_DAILY_CALLS_PER_USER, 10); return Number.isFinite(n) && n >= 0 ? n : 300; };
let settingsCache = { at: 0, value: null };

const defaults = () => ({ enabled: true, message: '', dailyCallsPerUser: envQuota() });

async function getSettings(force = false) {
  if (!force && settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
  const out = defaults();
  try {
    const p = pool();
    if (p) {
      const [rows] = await p.execute(`SELECT setting_key, value FROM ai_settings`);
      for (const r of rows) {
        if (r.setting_key === 'enabled') out.enabled = r.value !== '0';
        else if (r.setting_key === 'message') out.message = String(r.value).slice(0, 300);
        else if (r.setting_key === 'daily_calls_per_user') { const n = parseInt(r.value, 10); if (Number.isFinite(n) && n >= 0) out.dailyCallsPerUser = n; }
      }
    }
  } catch (e) { /* on garde les valeurs par défaut : l'IA reste disponible si la base est injoignable */ }
  settingsCache = { at: Date.now(), value: out };
  return out;
}

async function saveSettings(patch, adminEmail) {
  const p = pool();
  if (!p) throw new Error('Base de données indisponible.');
  const entries = [];
  if (patch.enabled !== undefined) entries.push(['enabled', patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1 ? '1' : '0']);
  if (patch.message !== undefined) entries.push(['message', String(patch.message).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300)]);
  if (patch.dailyCallsPerUser !== undefined) {
    const n = parseInt(patch.dailyCallsPerUser, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('Quota invalide (0 à 100 000, 0 = illimité).');
    entries.push(['daily_calls_per_user', String(n)]);
  }
  for (const [k, v] of entries) {
    await p.execute(`INSERT INTO ai_settings (setting_key, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`, [k, v, String(adminEmail || '').slice(0, 250)]);
  }
  return getSettings(true);
}

// ── Quota journalier : compteur en mémoire, initialisé depuis la base au premier appel du jour ──────────
const counters = new Map();                      // `${jour}|${utilisateur}` -> nombre d'appels
const dayKey = () => new Date().toISOString().slice(0, 10);

async function callsToday(user) {
  const key = `${dayKey()}|${user}`;
  if (!counters.has(key)) {
    let n = 0;
    try {
      const p = pool();
      if (p) { const [rows] = await p.execute(`SELECT COUNT(*) AS n FROM ai_usage WHERE user_key = ? AND ts >= CURDATE()`, [user]); n = Number(rows[0]?.n) || 0; }
    } catch (_) { /* compteur à 0 si la base ne répond pas */ }
    for (const k of counters.keys()) if (!k.startsWith(dayKey())) counters.delete(k);       // purge des jours passés
    counters.set(key, n);
  }
  return counters.get(key);
}
const countCall = (user) => { const key = `${dayKey()}|${user}`; counters.set(key, (counters.get(key) || 0) + 1); };

// ── Journal ─────────────────────────────────────────────────────────────────────────────────────────────
async function record(e) {
  try {
    const p = pool();
    if (!p) return;
    await p.execute(
      `INSERT INTO ai_usage (user_key, feature, model, tier, ok, latency_ms, tokens, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(e.user).slice(0, 250), String(e.feature).slice(0, 40), String(e.model || '').slice(0, 120), e.tier === 'fast' ? 'fast' : 'main',
        e.ok ? 1 : 0, Math.min(2147483647, Math.max(0, Math.round(e.latencyMs || 0))), Number.isFinite(e.tokens) ? e.tokens : null, e.error ? String(e.error).slice(0, 40) : null]
    );
  } catch (_) { /* la surveillance ne doit jamais faire échouer un appel IA */ }
}

async function purgeOld() {
  try {
    const p = pool();
    if (!p) return;
    await p.execute(`DELETE FROM ai_usage WHERE ts < DATE_SUB(NOW(), INTERVAL ${RETENTION_DAYS} DAY)`);
    await p.execute(`DELETE FROM ai_audit WHERE ts < DATE_SUB(NOW(), INTERVAL 180 DAY)`);
    await p.execute(`DELETE FROM ai_feedback WHERE ts < DATE_SUB(NOW(), INTERVAL 60 DAY)`);
  } catch (_) { /* purge reportée à la prochaine exécution */ }
}

const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/** Statistiques sur une période (heures) pour l'écran d'administration. */
async function stats(hours = 24) {
  const p = pool();
  if (!p) throw new Error('Base de données indisponible.');
  const n = Math.round(Number(hours));
  const h = Number.isFinite(n) ? Math.min(24 * 30, Math.max(1, n)) : 24;          // jamais autre chose qu'un nombre dans le SQL
  const since = `DATE_SUB(NOW(), INTERVAL ${h} HOUR)`;
  const [[total]] = await p.query(`SELECT COUNT(*) AS calls, SUM(ok = 0) AS failures, SUM(COALESCE(tokens, 0)) AS tokens FROM ai_usage WHERE ts >= ${since}`);
  const [lat] = await p.query(`SELECT latency_ms FROM ai_usage WHERE ts >= ${since} AND ok = 1 ORDER BY latency_ms`);
  const sorted = lat.map(r => r.latency_ms);
  const [byUser] = await p.query(`SELECT user_key AS user, COUNT(*) AS calls, SUM(ok = 0) AS failures, SUM(COALESCE(tokens, 0)) AS tokens FROM ai_usage WHERE ts >= ${since} GROUP BY user_key ORDER BY calls DESC LIMIT 25`);
  const [byFeature] = await p.query(`SELECT feature, COUNT(*) AS calls, SUM(ok = 0) AS failures, ROUND(AVG(latency_ms)) AS avg_ms FROM ai_usage WHERE ts >= ${since} GROUP BY feature ORDER BY calls DESC`);
  const [byModel] = await p.query(`SELECT model, COUNT(*) AS calls, SUM(ok = 0) AS failures, ROUND(AVG(latency_ms)) AS avg_ms FROM ai_usage WHERE ts >= ${since} GROUP BY model ORDER BY calls DESC`);
  const [errors] = await p.query(`SELECT error_code, COUNT(*) AS n FROM ai_usage WHERE ts >= ${since} AND ok = 0 GROUP BY error_code ORDER BY n DESC LIMIT 8`);
  const [perHour] = await p.query(`SELECT DATE_FORMAT(ts, '%Y-%m-%d %H:00') AS slot, COUNT(*) AS calls, SUM(ok = 0) AS failures FROM ai_usage WHERE ts >= ${since} GROUP BY slot ORDER BY slot`);
  const calls = Number(total.calls) || 0, failures = Number(total.failures) || 0;
  const num = (r) => ({ ...r, calls: Number(r.calls), failures: Number(r.failures || 0), tokens: r.tokens !== undefined ? Number(r.tokens) : undefined, avg_ms: r.avg_ms !== undefined ? Number(r.avg_ms) : undefined });
  return {
    hours: h, calls, failures, failureRate: calls ? failures / calls : 0, tokens: Number(total.tokens) || 0,
    latency: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) },
    byUser: byUser.map(num), byFeature: byFeature.map(num), byModel: byModel.map(num),
    errors: errors.map(r => ({ code: r.error_code || 'inconnue', n: Number(r.n) })), perHour: perHour.map(num),
  };
}

module.exports = { getSettings, saveSettings, callsToday, countCall, record, stats, purgeOld, defaults, RETENTION_DAYS };
