const adminService = require('../services/adminService');

async function requireAdmin(req, res, next) {
  const email = req.session?.activeAccount || req.session?.accounts?.[0]?.email;
  const admin = await adminService.isAdmin(email);
  if (admin) return next();

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ ok: false, error: 'Accès réservé aux administrateurs' });
  }
  return res.status(403).render('pages/error', {
    title: 'Accès refusé',
    message: "Cette page est réservée aux administrateurs.",
    iconColor: 'red',
  });
}

module.exports = { requireAdmin };
