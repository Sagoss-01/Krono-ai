/**
 * src/controllers/aiAdminController.js
 * Écran d'administration de l'IA : état de la clé et des modèles, interrupteur, quotas, statistiques,
 * journal d'audit et signalements. Toutes les routes exigent le rôle administrateur.
 */
const aiService = require('../services/aiService');
const aiUsage = require('../services/aiUsage');
const audit = require('../services/aiAuditService');
const feedback = require('../services/aiFeedbackService');

const adminEmail = (req) => (req.session.activeAccount || req.session.accounts?.[0]?.email || '').toLowerCase();
const fail = (res, e) => { console.error('[AI admin]', e.message); res.json({ ok: false, error: e.message || 'Erreur' }); };

async function overview(req, res) {
  try {
    const hours = [24, 168, 720].includes(Number(req.query.hours)) ? Number(req.query.hours) : 24;
    const [settings, stats] = await Promise.all([aiUsage.getSettings(true), aiUsage.stats(hours)]);
    res.json({ ok: true, settings, health: aiService.healthSnapshot(), stats });
  } catch (e) { fail(res, e); }
}

async function saveSettings(req, res) {
  try {
    const patch = {};
    for (const k of ['enabled', 'message', 'dailyCallsPerUser']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    const settings = await aiUsage.saveSettings(patch, adminEmail(req));
    audit.log(adminEmail(req), 'admin_setting', `IA ${settings.enabled ? 'activée' : 'DÉSACTIVÉE'} · quota ${settings.dailyCallsPerUser}/jour/utilisateur`);
    res.json({ ok: true, settings });
  } catch (e) { fail(res, e); }
}

/** Un appel minimal par modèle configuré (contourne l'interrupteur et le quota). */
async function test(req, res) {
  try { res.json({ ok: true, results: await aiService.pingAll(), health: aiService.healthSnapshot() }); } catch (e) { fail(res, e); }
}

async function auditLog(req, res) {
  try { res.json({ ok: true, entries: await audit.recent(req.query.limit, String(req.query.user || '').toLowerCase()) }); } catch (e) { fail(res, e); }
}

async function feedbackList(req, res) {
  try { res.json({ ok: true, items: await feedback.recent(req.query.limit) }); } catch (e) { fail(res, e); }
}

/** Signalements au format de cas rejouables par scripts/eval-prompts.js (téléchargement JSON). */
async function feedbackCases(req, res) {
  try {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="cas-signales.json"' });
    res.send(JSON.stringify({ cases: await feedback.asEvalCases(200) }, null, 2));
  } catch (e) { fail(res, e); }
}

module.exports = { overview, saveSettings, test, auditLog, feedbackList, feedbackCases };
