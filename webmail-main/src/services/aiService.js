/**
 * src/services/aiService.js
 * Point d'entrée UNIQUE pour tous les appels à l'IA (OpenRouter).
 *
 * Variables .env lues À CHAQUE APPEL :
 *   OPEN_ROUTER_API_KEY          clé API OpenRouter
 *   OPEN_ROUTER_BASE_URL         ex. https://openrouter.ai/api/v1
 *   OPEN_ROUTER_MODEL            modèle principal, ex. openrouter/free
 *   OPEN_ROUTER_FALLBACK_MODELS  (facultatif) modèles de secours séparés par des virgules, essayés dans l'ordre
 *   OPEN_ROUTER_MODEL_FAST       (facultatif) petit modèle pour les tâches simples (objet, correction, traduction)
 *   AI_DAILY_CALLS_PER_USER      (facultatif) quota d'appels par utilisateur et par jour (défaut 300, 0 = illimité)
 *
 * Fiabilité : bascule automatique sur le modèle suivant en cas d'échec (limite, panne, délai, réponse vide),
 * disjoncteur par modèle (3 échecs d'affilée → ignoré 60 s), interrupteur administrateur, quotas, et journal
 * d'usage (qui, quoi, quel modèle, durée, succès) alimentant l'écran de surveillance.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const aiContext = require('./aiContext');
const aiUsage = require('./aiUsage');

const MAX_RETRIES = 2;        // nouvelles tentatives sur 429 / 5xx, uniquement sur le DERNIER modèle de la chaîne
const RETRY_DELAY = 1500;     // ms (multiplié par le numéro de tentative)
const TIMEOUT_MS = 60000;
const BREAKER_FAILS = 3;
const BREAKER_OPEN_MS = 60000;

class AiError extends Error {
  constructor(message, { code = 'erreur', fatal = false } = {}) { super(message); this.name = 'AiError'; this.code = code; this.fatal = fatal; }
}

// ── Configuration ───────────────────────────────────────────────────────────────────────────────────
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function getConfig() {
  const apiKey = (process.env.OPEN_ROUTER_API_KEY || '').trim();
  const baseUrl = (process.env.OPEN_ROUTER_BASE_URL || '').trim().replace(/\/+$/, '');
  const main = list(process.env.OPEN_ROUTER_MODEL);              // « a,b » : le premier est le principal, les suivants servent de secours
  const fallbacks = [...new Set([...main.slice(1), ...list(process.env.OPEN_ROUTER_FALLBACK_MODELS)])].filter(m => m !== main[0]);
  const fast = list(process.env.OPEN_ROUTER_MODEL_FAST)[0] || '';
  return { apiKey, baseUrl, model: main[0] || '', fallbacks, fast };
}

/** Chaîne de modèles à essayer, dans l'ordre : « fast » commence par le petit modèle, puis le principal et les secours. */
function modelChain(tier, cfg = getConfig()) {
  const base = [cfg.model, ...cfg.fallbacks].filter(Boolean);
  const chain = tier === 'fast' && cfg.fast ? [cfg.fast, ...base] : base;
  return [...new Set(chain)];
}

function assertConfigured() {
  const cfg = getConfig();
  const missing = [];
  if (!cfg.apiKey) missing.push('OPEN_ROUTER_API_KEY');
  if (!cfg.baseUrl) missing.push('OPEN_ROUTER_BASE_URL');
  if (!cfg.model) missing.push('OPEN_ROUTER_MODEL');
  if (missing.length) {
    console.error(`[AI] Variable(s) .env manquante(s) : ${missing.join(', ')}`);
    throw new AiError("Le service IA n'est pas configuré. Contactez l'administrateur.", { code: 'not_configured', fatal: true });
  }
  return cfg;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function httpError(status) {
  const known = {
    401: ["Clé API IA invalide. Contactez l'administrateur.", 'auth_401', true],
    402: ["Crédits IA insuffisants. Contactez l'administrateur.", 'credits_402', true],
    429: ['Le service IA est temporairement surchargé. Réessayez dans quelques instants.', 'rate_limited', false],
    503: ['Le service IA est indisponible. Réessayez plus tard.', 'server_5xx', false],
  }[status];
  if (known) return new AiError(known[0], { code: known[1], fatal: known[2] });
  return new AiError(`Erreur du service IA (code ${status}). Réessayez.`, { code: status >= 500 ? 'server_5xx' : 'http_4xx' });
}

// ── Disjoncteur par modèle + état de santé ──────────────────────────────────────────────────────────
const breaker = new Map();
const state = (m) => { if (!breaker.has(m)) breaker.set(m, { fails: 0, openUntil: 0, lastError: '', lastOkAt: 0, lastFailAt: 0 }); return breaker.get(m); };
const isOpen = (m) => state(m).openUntil > Date.now();
const markOk = (m) => { const s = state(m); s.fails = 0; s.openUntil = 0; s.lastOkAt = Date.now(); keyProblem = ''; };
let keyProblem = '';
function markFail(m, err) {
  if (err.code === 'auth_401' || err.code === 'credits_402') { keyProblem = err.code; return; }      // problème de clé : pas la faute du modèle
  const s = state(m); s.fails++; s.lastError = err.code; s.lastFailAt = Date.now();
  if (s.fails >= BREAKER_FAILS) s.openUntil = Date.now() + BREAKER_OPEN_MS;
}

function healthSnapshot() {
  const cfg = getConfig();
  const models = [...new Set([cfg.fast, cfg.model, ...cfg.fallbacks].filter(Boolean))];
  return {
    configured: !!(cfg.apiKey && cfg.baseUrl && cfg.model), baseUrl: cfg.baseUrl, keyProblem,
    models: { main: cfg.model, fallbacks: cfg.fallbacks, fast: cfg.fast },
    breakers: models.map(m => { const s = state(m); return { model: m, fails: s.fails, open: isOpen(m), reopenInSec: Math.max(0, Math.ceil((s.openUntil - Date.now()) / 1000)), lastError: s.lastError, lastOkAt: s.lastOkAt, lastFailAt: s.lastFailAt }; }),
  };
}

// ── Garde : interrupteur administrateur et quota ────────────────────────────────────────────────────
async function guard() {
  const ctx = aiContext.get();
  if (ctx.feature === 'health') return ctx;
  const s = await aiUsage.getSettings();
  if (!s.enabled) throw new AiError(s.message || "L'assistant IA est temporairement désactivé par l'administrateur.", { code: 'disabled', fatal: true });
  if (s.dailyCallsPerUser > 0 && ctx.user !== 'système') {
    if (await aiUsage.callsToday(ctx.user) >= s.dailyCallsPerUser) {
      throw new AiError(`Limite quotidienne atteinte (${s.dailyCallsPerUser} requêtes IA par jour). Réessayez demain.`, { code: 'quota', fatal: true });
    }
    aiUsage.countCall(ctx.user);
  }
  return ctx;
}

// ── Une tentative sur un modèle ─────────────────────────────────────────────────────────────────────
function headers(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': process.env.APP_URL || 'https://webmail.netiify.cloud',
    'X-Title': 'TechSphere AI', 'Content-Type': 'application/json',
  };
}

async function post(cfg, body, timeoutMs) {
  try {
    return await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: headers(cfg.apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(`[AI] Connexion échouée (${body.model}) :`, e.message);
    throw new AiError(timeout ? 'Le service IA met trop de temps à répondre. Réessayez.' : 'Impossible de joindre le service IA. Réessayez.', { code: timeout ? 'timeout' : 'network' });
  }
}

async function attempt(cfg, model, messages, opts) {
  const body = { model, messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.maxTokens ?? 1024 };
  if (opts.json) body.response_format = { type: 'json_object' };
  const response = await post(cfg, body, TIMEOUT_MS);
  const raw = await response.text();
  console.log(`[AI] HTTP ${response.status} — ${model}`);
  if (!response.ok) { console.error(`[AI] Erreur ${response.status} :`, raw.slice(0, 300)); throw httpError(response.status); }
  let data;
  try { data = JSON.parse(raw); } catch (_) { throw new AiError('Réponse invalide reçue du service IA.', { code: 'bad_response' }); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) { console.warn('[AI] Réponse vide :', raw.slice(0, 200)); throw new AiError("Je n'ai pas pu générer de réponse. Reformulez votre demande.", { code: 'empty' }); }
  return { text: String(content).trim(), model: data.model || model, tokens: data.usage?.total_tokens };
}

/**
 * Parcourt la chaîne de modèles. Les erreurs de clé/crédits/désactivation arrêtent tout (inutile d'essayer les autres) ;
 * le reste bascule sur le modèle suivant. Les nouvelles tentatives (429/5xx) ne s'appliquent qu'au dernier modèle.
 */
async function runChain(tier, tryModel) {
  const ctx = await guard();
  const cfg = assertConfigured();
  const chain = modelChain(tier, cfg);
  const candidates = chain.filter(m => !isOpen(m));
  const order = candidates.length ? candidates : chain;                 // tous en panne : on réessaie quand même, mieux que rien
  const started = Date.now();
  let lastErr = null, usedModel = order[0];

  for (let i = 0; i < order.length; i++) {
    const model = order[i], isLast = i === order.length - 1;
    for (let n = 0; n <= (isLast ? MAX_RETRIES : 0); n++) {
      try {
        const out = await tryModel(cfg, model);
        markOk(model);
        aiUsage.record({ ...ctx, tier, model: out.model || model, ok: true, latencyMs: Date.now() - started, tokens: out.tokens });
        if (i > 0) console.warn(`[AI] bascule réussie sur ${model} (modèles précédents en échec)`);
        return out;
      } catch (e) {
        lastErr = e instanceof AiError ? e : new AiError("Erreur du service IA. Réessayez.", { code: 'erreur' });
        usedModel = model;
        if (lastErr.fatal) { markFail(model, lastErr); break; }
        const retryable = lastErr.code === 'rate_limited' || lastErr.code === 'server_5xx';
        if (isLast && retryable && n < MAX_RETRIES) { await sleep(RETRY_DELAY * (n + 1)); continue; }
        markFail(model, lastErr);
        break;
      }
    }
    if (lastErr?.fatal) break;
  }
  aiUsage.record({ ...ctx, tier, model: usedModel, ok: false, latencyMs: Date.now() - started, error: lastErr?.code });
  throw lastErr;
}

/**
 * Appel chat completion.
 * @param {Array<{role:string,content:string}>} messages
 * @param {{maxTokens?:number, temperature?:number, json?:boolean, tier?:'main'|'fast'}} [opts]
 * @returns {Promise<string>} contenu texte de la réponse
 */
async function chat(messages, opts = {}) {
  const out = await runChain(opts.tier === 'fast' ? 'fast' : 'main', (cfg, model) => attempt(cfg, model, messages, opts));
  console.log(`[AI] OK ${out.model} — tokens: ${out.tokens ?? '?'}`);
  return out.text;
}

/**
 * Appel chat en streaming (SSE). `onToken(texteAjouté)` est appelé au fil de l'eau ; renvoie le texte complet.
 * La bascule sur un autre modèle n'est possible qu'AVANT le premier mot affiché.
 */
async function chatStream(messages, opts = {}, onToken = () => {}) {
  const out = await runChain(opts.tier === 'fast' ? 'fast' : 'main', async (cfg, model) => {
    const response = await post(cfg, { model, messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.maxTokens ?? 1024, stream: true }, TIMEOUT_MS * 2);
    if (!response.ok) { const raw = await response.text(); console.error(`[AI] Erreur ${response.status} :`, raw.slice(0, 300)); throw httpError(response.status); }
    let full = '', buf = '', tokens;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta?.content;
            if (j?.usage?.total_tokens) tokens = j.usage.total_tokens;
            if (delta) { full += delta; onToken(delta); }
          } catch (_) { /* ligne SSE partielle ou commentaire : ignorée */ }
        }
      }
    } catch (e) {
      if (full.trim()) { console.warn('[AI] flux interrompu, texte partiel conservé'); }          // mieux vaut une réponse partielle qu'aucune
      else throw new AiError('Le flux de la réponse a été interrompu. Réessayez.', { code: 'stream' });
    }
    if (!full.trim()) throw new AiError("Je n'ai pas pu générer de réponse. Reformulez votre demande.", { code: 'empty' });
    return { text: full.trim(), model, tokens };
  });
  console.log(`[AI] stream OK ${out.model} — ${out.text.length} car.`);
  return out.text;
}

/**
 * Extrait un objet JSON d'une réponse texte (tolère ```json ... ``` et texte autour).
 * @returns {object|null}
 */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch (_) { /* on tente l'extraction */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

/**
 * Appel chat qui attend une réponse JSON. Réessaie une fois si le JSON est invalide.
 * @returns {Promise<object>}
 */
async function chatJson(messages, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0 ? messages : [
      ...messages,
      { role: 'user', content: 'Ta réponse précédente n\'était pas un JSON valide. Réponds UNIQUEMENT avec l\'objet JSON demandé, sans aucun texte autour.' },
    ];
    const text = await chat(msgs, { ...opts, temperature: opts.temperature ?? 0.3 });
    const data = extractJson(text);
    if (data && typeof data === 'object') return data;
    console.warn('[AI] JSON invalide, tentative', attempt + 1, ':', text.slice(0, 200));
  }
  throw new AiError("L'IA n'a pas renvoyé de réponse exploitable. Reformulez votre demande.", { code: 'bad_json' });
}

/** Test de santé : un appel minimal PAR modèle configuré, sans bascule (contourne interrupteur et quota). */
async function pingAll() {
  const cfg = assertConfigured();
  const models = [...new Set([cfg.fast, cfg.model, ...cfg.fallbacks].filter(Boolean))];
  return aiContext.run({ user: 'système', feature: 'health' }, () => Promise.all(models.map(async (model) => {
    const t = Date.now();
    try {
      const out = await attempt(cfg, model, [{ role: 'user', content: 'Réponds uniquement par : OK' }], { maxTokens: 8, temperature: 0 });
      markOk(model);
      aiUsage.record({ user: 'système', feature: 'health', tier: 'main', model, ok: true, latencyMs: Date.now() - t, tokens: out.tokens });
      return { model, ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      markFail(model, e instanceof AiError ? e : new AiError('erreur'));
      aiUsage.record({ user: 'système', feature: 'health', tier: 'main', model, ok: false, latencyMs: Date.now() - t, error: e.code });
      return { model, ok: false, latencyMs: Date.now() - t, error: e.message, code: e.code };
    }
  })));
}

module.exports = { chat, chatStream, chatJson, extractJson, getConfig, modelChain, healthSnapshot, pingAll, AiError, _breaker: breaker };
