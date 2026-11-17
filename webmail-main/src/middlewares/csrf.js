const crypto = require('crypto');

function generateToken(req) {
  if (!req.session) {
    throw new Error('Session non disponible pour CSRF');
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }

  return req.session.csrfToken;
}

function wantsJson(req) {
  return (
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.path.startsWith('/api/')
  );
}

function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.locals.csrfToken = generateToken(req);
    return next();
  }

  if (
    req.path === '/login' ||
    req.path === '/login/2fa' ||
    req.path === '/logout' ||
    req.path === '/api/meetings/verify-code' ||
    req.path === '/api/auth/forgot-password' ||
    req.path === '/api/auth/reset-password'
  ) {
    return next();
  }

  const token =
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'] ||
    req.body?._csrf ||
    '';

  const stored = req.session?.csrfToken || '';

  if (!token || !stored || token !== stored) {
    if (wantsJson(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Token CSRF invalide'
      });
    }

    return res.status(403).send('Requête invalide (CSRF)');
  }

  next();
}

module.exports = {
  csrfMiddleware,
  generateToken
};