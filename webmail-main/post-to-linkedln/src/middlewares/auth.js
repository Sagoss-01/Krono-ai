function requireAuth(req, res, next) {
  if (req.session && req.session.accounts && req.session.accounts.length > 0) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ ok: false, error: 'Non authentifié' });
  }
  res.redirect('/login');
}

module.exports = { requireAuth };
