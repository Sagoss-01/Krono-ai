const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

async function runSudoScript(args, { timeout = 40000 } = {}) {
  try {
    const { stdout } = await execFileAsync('sudo', args, { timeout });
    const parsed = JSON.parse(stdout || '{}');
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Commande de provisioning échouée');
    }
    return parsed;
  } catch (err) {
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        throw new Error(parsed.error || 'Commande de provisioning échouée');
      } catch (_) {
        // noop, on retombe sur l'erreur d'origine
      }
    }
    throw err;
  }
}

async function provisionMailbox({ email, password, firstName, lastName }) {
  return runSudoScript([
    '/usr/local/bin/create-mailbox',
    '--email', email,
    '--password', password,
    '--firstname', firstName,
    '--lastname', lastName
  ]);
}

// ⚠️ À VÉRIFIER CÔTÉ SERVEUR : ce script n'existait pas encore dans le repo.
// Il doit exister sur le serveur mail (même convention que create-mailbox :
// JSON en sortie avec { ok: true } ou { ok: false, error }), sinon la
// réinitialisation de mot de passe échouera à cette étape précise.
// Si le nom réel du script diffère, changer uniquement la ligne ci-dessous.
async function setMailboxPassword({ email, password }) {
  return runSudoScript([
    '/usr/local/bin/set-mailbox-password',
    '--email', email,
    '--password', password
  ]);
}

module.exports = {
  provisionMailbox,
  setMailboxPassword
};
