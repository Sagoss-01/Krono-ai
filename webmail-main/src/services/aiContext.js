/**
 * src/services/aiContext.js
 * Contexte d'un appel IA (qui, pour quelle fonctionnalité), transmis automatiquement jusqu'à aiService
 * sans changer la signature des fonctions : journal d'usage, quotas et interrupteur en dépendent.
 */
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

/** Exécute `fn` avec ce contexte. @param {{user:string, feature:string}} ctx */
const run = (ctx, fn) => als.run({ user: String(ctx.user || 'anonyme').toLowerCase().slice(0, 250), feature: String(ctx.feature || 'autre').slice(0, 40) }, fn);
const get = () => als.getStore() || { user: 'système', feature: 'autre' };

/** Enveloppe un gestionnaire Express : le contexte porte l'utilisateur de la session. */
function http(feature, handler) {
  return (req, res, next) => {
    const user = req.session?.activeAccount || req.session?.accounts?.[0]?.email || req.ip;
    return run({ user, feature }, () => handler(req, res, next));
  };
}

module.exports = { run, get, http };
