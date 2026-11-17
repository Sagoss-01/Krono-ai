const gdprService = require('../services/gdprService');
const imapService = require('../services/imap');
const logger = require('../services/logger');

function getActiveAccount(req) {
  const email = req.session.activeAccount || req.session.accounts?.[0]?.email;
  const entry = req.session.accounts?.find((a) => a.email === email);
  return { email, encryptedPassword: entry?.password };
}

// ── Export de données (droit d'accès) ───────────────────────────────────

async function exportData(req, res) {
  try {
    const { email } = getActiveAccount(req);
    if (!email) return res.status(401).json({ ok: false, error: 'Non authentifié' });

    const data = await gdprService.exportUserData(email);
    const json = JSON.stringify(data, null, 2);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mes-donnees-${email.split('@')[0]}-${new Date().toISOString().slice(0,10)}.json"`);
    return res.send(json);
  } catch (err) {
    logger.auth('gdpr', 'ERROR', 'Échec export des données', { message: err.message });
    return res.status(500).json({ ok: false, error: "Erreur lors de la génération de l'export" });
  }
}

// ── Suppression de compte (droit à l'effacement) ────────────────────────

async function deleteAccount(req, res) {
  try {
    const { email, encryptedPassword } = getActiveAccount(req);
    if (!email || !encryptedPassword) return res.status(401).json({ ok: false, error: 'Non authentifié' });

    const { password, confirmation } = req.body || {};

    if (confirmation !== 'SUPPRIMER') {
      return res.status(400).json({ ok: false, error: 'Tape SUPPRIMER pour confirmer.' });
    }
    if (!password) {
      return res.status(400).json({ ok: false, error: 'Mot de passe requis pour confirmer la suppression.' });
    }

    // Re-authentification obligatoire : une action irréversible comme
    // celle-ci ne doit jamais reposer uniquement sur une session déjà
    // ouverte (qui a pu être laissée active sur un appareil partagé, etc.).
    try {
      await imapService.testConnection({ email, password });
    } catch (e) {
      return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
    }

    logger.auth(email, 'WARN', 'Suppression de compte demandée par l’utilisateur');
    await gdprService.deleteUserAccount(email);

    // Détruit la session courante : le compte n'existe plus.
    req.session.destroy(() => {});

    return res.json({ ok: true });
  } catch (err) {
    logger.auth('gdpr', 'ERROR', 'Échec suppression de compte', { message: err.message });
    return res.status(500).json({
      ok: false,
      error: "Erreur lors de la suppression. Si le problème persiste, contacte le support — ne réessaie pas plusieurs fois d'affilée.",
    });
  }
}

module.exports = { exportData, deleteAccount };
