/**
 * Rate limiter simple en mémoire pour le login
 * Max 10 tentatives par IP sur 15 minutes
 */
const attempts = new Map(); // IP => { count, firstAttempt }

const MAX_ATTEMPTS  = 10;
const WINDOW_MS     = 15 * 60 * 1000; // 15 min

function loginLimiter(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);

  if (rec) {
    // Reset fenêtre si expirée
    if (now - rec.firstAttempt > WINDOW_MS) {
      attempts.delete(ip);
    } else if (rec.count >= MAX_ATTEMPTS) {
      const wait = Math.ceil((WINDOW_MS - (now - rec.firstAttempt)) / 60000);
      return res.render('pages/login', {
        error: `Trop de tentatives. Réessayez dans ${wait} minute(s).`,
        title: 'Connexion — TechSphere Webmail',
        knownAccounts: req.session.knownAccounts || [],
      });
    }
  }

  // Hook : on comptabilise uniquement après la réponse
  const origSend = res.render.bind(res);
  res.render = function(view, data, cb) {
    // Si la vue login est rendue avec une erreur → échec → incrémenter
    if (view === 'pages/login' && data && data.error) {
      const r = attempts.get(ip) || { count: 0, firstAttempt: now };
      r.count++;
      if (!attempts.has(ip)) r.firstAttempt = now;
      attempts.set(ip, r);
    } else if (view !== 'pages/login') {
      // succès (redirect) → reset
      attempts.delete(ip);
    }
    return origSend(view, data, cb);
  };

  next();
}

module.exports = { loginLimiter };
