/**
 * Rate limiter générique en mémoire, par IP (ou clé personnalisée).
 * Contrairement à loginLimiter (couplé à res.render('pages/login')), celui-ci
 * répond en JSON et peut protéger n'importe quelle route API — codes de
 * vérification (2FA, reset mdp, code réunion) qui sont sinon brute-forçables
 * (un code à 6 chiffres = 1 million de combinaisons, sans limite c'est cassable).
 */
const buckets = new Map(); // clé -> { count, firstAttempt }

function createRateLimiter({ windowMs, max, keyFn, message }) {
  return function rateLimiter(req, res, next) {
    const key = (keyFn ? keyFn(req) : req.ip) || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.firstAttempt > windowMs) {
      bucket = { count: 0, firstAttempt: now };
      buckets.set(key, bucket);
    }

    bucket.count++;
    if (bucket.count > max) {
      const waitSec = Math.ceil((windowMs - (now - bucket.firstAttempt)) / 1000);
      return res.status(429).json({
        ok: false,
        error: message || `Trop de tentatives. Réessaie dans ${waitSec}s.`,
      });
    }
    next();
  };
}

// Nettoyage périodique pour ne pas accumuler indéfiniment en mémoire
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.firstAttempt > 60 * 60 * 1000) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ── Limiteurs prêts à l'emploi ───────────────────────────────────────────────
// Vérification de code (6 chiffres) : 8 essais / 15 min / IP — assez pour un
// utilisateur qui se trompe, bien trop peu pour brute-forcer 1M de combinaisons.
const codeVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Trop de tentatives de code. Réessaie dans quelques minutes.',
});

// Demande de code (envoi d'email) : 5 / 15 min / IP — évite le flood d'emails
// au-delà du cooldown de 60s déjà en place par adresse dans recoveryService.
const requestCodeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de demandes. Réessaie dans quelques minutes.',
});

// Upload dans une réunion : 20 / 5 min / IP — un participant légitime n'a pas
// besoin de plus, ça freine le spam de fichiers.
const uploadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Trop d\'envois de fichiers. Réessaie dans quelques minutes.',
});

// Assistant IA : 40 requêtes / 10 min par compte (ou par IP à défaut) — chaque requête coûte
// un appel au fournisseur IA, on évite l'abus et l'épuisement du quota.
const aiLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  keyFn: (req) => 'ai:' + (req.session?.activeAccount || req.session?.accounts?.[0]?.email || req.ip),
  message: 'Trop de requêtes à l\'assistant IA. Réessayez dans quelques minutes.',
});

module.exports = { createRateLimiter, codeVerifyLimiter, requestCodeLimiter, uploadLimiter, aiLimiter };
