const { promisify } = require('util');
const { execFile } = require('child_process');

const imapService = require('../services/imap');
const logger = require('../services/logger');
const browserAccounts = require('../services/browserAccounts');
const userService = require('../services/userService');
const { pool } = require('../services/db');
const { encrypt } = require('../middlewares/encrypt');

const welcomeMailService = require('../services/welcomeMailService');


const execFileAsync = promisify(execFile);

function getKnownAccounts(req, res) {
  const browserId = browserAccounts.getBrowserId(req, res);
  return browserAccounts.getAccounts(browserId);
}

async function setAuthenticatedSession(req, res, email, password, rememberMe = true) {
  if (!req.session.accounts) req.session.accounts = [];

  const exists = req.session.accounts.find((a) => a.email === email);
  if (!exists) {
    req.session.accounts.push({
      email,
      password: encrypt(password)
    });
  }

  req.session.activeAccount = email;

  if (rememberMe) {
    req.session.cookie.maxAge = 90 * 24 * 60 * 60 * 1000;
  } else {
    req.session.cookie.expires = false;
  }

  const browserId = browserAccounts.getBrowserId(req, res);
  await browserAccounts.addAccount(browserId, email);
}

async function runMailboxProvision({ email, password, firstName, lastName }) {
  try {
    const { stdout } = await execFileAsync('sudo', [
      '/usr/local/bin/create-mailbox',
      '--email', email,
      '--password', password,
      '--firstname', firstName,
      '--lastname', lastName
    ], { timeout: 40000 });

    const parsed = JSON.parse(stdout || '{}');
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Provisioning mailbox échoué');
    }

    return parsed;
  } catch (err) {
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        throw new Error(parsed.error || 'Provisioning mailbox échoué');
      } catch (_) {
        // noop
      }
    }
    throw err;
  }
}

async function showLogin(req, res) {
  if (req.session.accounts && req.session.accounts.length > 0) {
    return res.redirect('/mail');
  }

  const knownAccounts = await getKnownAccounts(req, res);

  res.render('pages/login', {
    error: null,
    title: 'Connexion — TechSphere Webmail',
    knownAccounts
  });
}

async function showRegister(req, res) {
  if (req.session.accounts && req.session.accounts.length > 0) {
    return res.redirect('/mail');
  }

  res.render('pages/register', {
    error: null,
    title: 'Inscription — TechSphere Webmail',
    csrfToken: res.locals.csrfToken || ''
  });
}

async function doLogin(req, res) {
  const { username, password } = req.body;
  const email = username && username.includes('@')
    ? username
    : `${username}@netiify.cloud`;

  const knownAccounts = await getKnownAccounts(req, res);

  if (!email || !password) {
    return res.render('pages/login', {
      error: 'Veuillez remplir tous les champs',
      title: 'Connexion — TechSphere Webmail',
      knownAccounts
    });
  }

  try {
    await imapService.testConnection({ email, password });
    const rememberMe = req.body.rememberMe === '1' || req.body.rememberMe === 'on';

    await setAuthenticatedSession(req, res, email, password, rememberMe);

    logger.auth(email, 'INFO', 'Login OK');
    return res.redirect('/mail');
  } catch (err) {
    logger.auth(email, 'ERROR', 'Échec login', { message: err.message });

    return res.render('pages/login', {
      error: 'Identifiants incorrects : ' + err.message,
      title: 'Connexion — TechSphere Webmail',
      knownAccounts
    });
  }
}

async function suggestRegisterEmail(req, res) {
  try {
    const { firstName, lastName, localpart } = req.body || {};

    const suggestion = await userService.findAvailableLocalpart({
      firstName,
      lastName,
      preferredLocalpart: localpart || ''
    });

    return res.json({
      ok: true,
      localpart: suggestion.localpart,
      email: suggestion.email,
      generated: suggestion.generated
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message || "Impossible de proposer une adresse"
    });
  }
}

async function doRegister(req, res) {
  const {
    firstName,
    lastName,
    gender,
    birthDate,
    password,
    confirmPassword,
    localpart
  } = req.body || {};

  let conn;

  try {
    userService.assertProfile({
      firstName,
      lastName,
      gender,
      birthDate,
      password
    });

    if (password !== confirmPassword) {
      throw new Error('Les mots de passe ne correspondent pas');
    }

    const finalChoice = await userService.findAvailableLocalpart({
      firstName,
      lastName,
      preferredLocalpart: localpart || ''
    });

    const finalLocalpart = finalChoice.localpart;
    const email = finalChoice.email;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (await userService.emailExists(email, conn)) {
      throw new Error('Cette adresse email est déjà utilisée');
    }

    const passwordHash = userService.hashPassword(password);

    await userService.insertUser(conn, {
      email,
      firstName,
      lastName,
      gender,
      birthDate,
      passwordHash
    });

    await runMailboxProvision({
      email,
      password,
      firstName,
      lastName
    });

    await conn.commit();
    conn.release();
    conn = null;

    await imapService.testConnection({ email, password });

try {
  await welcomeMailService.sendWelcomeEmail({
    to: email,
    firstName
  });
} catch (mailErr) {
  logger.smtp(email, 'ERROR', 'Échec envoi mail de bienvenue', {
    message: mailErr.message
  });
}

await setAuthenticatedSession(req, res, email, password, true);

logger.auth(email, 'INFO', 'Inscription OK');

return res.json({
  ok: true,
  email,
  redirect: '/mail'
});
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {
        // noop
      }
      conn.release();
    }

    logger.auth('register', 'ERROR', 'Échec inscription', {
      message: err.message
    });

    return res.status(400).json({
      ok: false,
      error: err.message || 'Impossible de créer le compte'
    });
  }
}

async function addAccount(req, res) {
  const { username, password } = req.body;
  const email = username && username.includes('@')
    ? username
    : `${username}@netiify.cloud`;

  try {
    await imapService.testConnection({ email, password });

    if (!req.session.accounts) req.session.accounts = [];

    const exists = req.session.accounts.find((a) => a.email === email);
    if (exists) {
      return res.json({ ok: false, error: 'Ce compte est déjà connecté' });
    }

    req.session.accounts.push({
      email,
      password: encrypt(password)
    });

    const browserId = browserAccounts.getBrowserId(req, res);
    await browserAccounts.addAccount(browserId, email);

    logger.auth(email, 'INFO', 'Compte supplémentaire ajouté');
    return res.json({ ok: true, email });
  } catch (err) {
    return res.json({
      ok: false,
      error: 'Connexion échouée : ' + err.message
    });
  }
}

function removeAccount(req, res) {
  const { email } = req.body;

  if (!req.session.accounts) {
    return res.json({ ok: true });
  }

  req.session.accounts = req.session.accounts.filter((a) => a.email !== email);

  if (req.session.activeAccount === email) {
    req.session.activeAccount = req.session.accounts[0]?.email || null;
  }

  logger.auth(email, 'INFO', 'Compte retiré de la session');

  if (req.session.accounts.length === 0) {
    return req.session.destroy(() => res.json({
      ok: true,
      redirect: '/login'
    }));
  }

  return res.json({
    ok: true,
    activeAccount: req.session.activeAccount
  });
}

function switchAccount(req, res) {
  const { email } = req.body;
  const found = req.session.accounts?.find((a) => a.email === email);

  if (!found) {
    return res.json({ ok: false, error: 'Compte non trouvé' });
  }

  req.session.activeAccount = email;
  return res.json({ ok: true, email });
}

function doLogout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

function getMe(req, res) {
  const accounts = req.session.accounts || [];
  const active = req.session.activeAccount || accounts[0]?.email;

  res.json({
    ok: true,
    accounts: accounts.map((a) => a.email),
    activeAccount: active
  });
}

async function removeKnownAccount(req, res) {
  const { email } = req.body;
  if (!email) return res.json({ ok: false });

  const browserId = req.cookies?.[browserAccounts.COOKIE_NAME];
  if (!browserId) return res.json({ ok: false });

  await browserAccounts.removeAccount(browserId, email);
  return res.json({ ok: true });
}

module.exports = {
  showLogin,
  showRegister,
  doLogin,
  doRegister,
  suggestRegisterEmail,
  addAccount,
  removeAccount,
  removeKnownAccount,
  switchAccount,
  doLogout,
  getMe
};