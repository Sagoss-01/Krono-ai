const { promisify } = require('util');
const { execFile } = require('child_process');

const imapService = require('../services/imap');
const logger = require('../services/logger');
const browserAccounts = require('../services/browserAccounts');
const userService = require('../services/userService');
const { pool } = require('../services/db');
const { encrypt, decrypt } = require('../middlewares/encrypt');
const totpService = require('../services/totpService');
const activityLog = require('../services/activityLogService');
const adminService = require('../services/adminService');
const deviceService = require('../services/deviceService');
const recoveryMailService = require('../services/recoveryMailService');

// N'accepte qu'un chemin interne relatif ("/meeting/xxx") — jamais une URL
// externe ("//evil.com" ou "https://evil.com") pour éviter tout open-redirect.
function safeRedirectPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  return raw;
}

const welcomeMailService = require('../services/welcomeMailService');


const execFileAsync = promisify(execFile);

function getKnownAccounts(req, res) {
  const browserId = browserAccounts.getBrowserId(req, res);
  return browserAccounts.getAccounts(browserId);
}

async function setAuthenticatedSession(req, res, email, password, rememberMe = true) {
  const browserId = browserAccounts.getBrowserId(req, res);

  // Vérifie la liste noire AVANT de créer quoi que ce soit en session —
  // un appareil bloqué ne doit jamais obtenir de session, même avec le bon mot de passe.
  await deviceService.assertNotBlocked(email, browserId);

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

  await browserAccounts.addAccount(browserId, email);

  // Le suivi d'appareil a besoin d'un sessionID stable : express-session le
  // fixe dès la 1ère requête, donc déjà disponible ici (pas besoin d'attendre
  // le save()). On le lie dans user_devices pour permettre la révocation
  // à distance depuis la page "Appareils".
  const { isNewDevice, trusted, label } = await deviceService.touchDevice({
    email,
    browserId,
    sessionId: req.sessionID,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  // On n'alerte plus à CHAQUE connexion — seulement si l'appareil n'est pas
  // (encore) un appareil de confiance, OU si la connexion a un profil
  // suspect même sur un appareil connu (ex : plusieurs échecs de mot de
  // passe juste avant — signe possible de vol de session/cookie plutôt que
  // du vrai propriétaire).
  const recentFailures = await activityLog.countRecentFailures(email, 15);
  const suspicious = recentFailures >= 3;

  if (!trusted || suspicious) {
    const reason = suspicious ? 'suspicious' : 'new_device';
    notifyNewDevice(req, email, label, reason).catch((err) => {
      logger.auth(email, 'ERROR', "Échec envoi alerte nouvel appareil", { message: err.message });
    });
  }
}

// Fire-and-forget : ne doit jamais bloquer ni faire échouer le login.
// Envoyée à l'adresse principale ET à l'adresse de confiance (si confirmée),
// comme demandé — pour que l'alerte reste visible même si le compte principal
// est justement celui qui a été compromis.
async function notifyNewDevice(req, email, deviceLabel, reason = 'new_device') {
  const device = await pool.execute(
    'SELECT id FROM user_devices WHERE session_id = ? LIMIT 1',
    [req.sessionID]
  ).then(([rows]) => rows[0]);
  if (!device) return;

  const blockUrl = `${process.env.APP_URL || 'https://webmail.netiify.cloud'}/account/devices/block-via-email?token=${encodeURIComponent(deviceService.signBlockToken(device.id, email))}`;

  const recipients = [email];
  const recoveryEmail = await userService.getVerifiedRecoveryEmail(email);
  if (recoveryEmail) recipients.push(recoveryEmail);

  const when = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  for (const to of recipients) {
    await recoveryMailService.sendNewDeviceAlert({
      to,
      accountEmail: email,
      deviceLabel,
      ip: req.ip,
      when,
      blockUrl,
      reason
    });
  }
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
  const redirectTo = safeRedirectPath(req.query.redirect);

  if (req.session.accounts && req.session.accounts.length > 0) {
    return res.redirect(redirectTo || '/mail');
  }

  const knownAccounts = await getKnownAccounts(req, res);

  res.render('pages/login', {
    error: null,
    title: 'Connexion — TechSphere Webmail',
    knownAccounts,
    redirectTo: redirectTo || '',
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

  const { username, password, domain } = req.body;
  const email = username.includes('@') ? username : `${username}${domain}`;
  const redirectTo = safeRedirectPath(req.body.redirect);

  const knownAccounts = await getKnownAccounts(req, res);
  console.log(domain);
  if (!email || !password) {
    return res.render('pages/login', {
      error: 'Veuillez remplir tous les champs',
      title: 'Connexion — TechSphere Webmail',
      knownAccounts,
      redirectTo: redirectTo || '',
    });
  }

  try {
    await imapService.testConnection({ email, password });

    const accStatus = await adminService.getAccountStatus(email);
    if (accStatus.status === 'suspended') {
      logger.auth(email, 'WARN', 'Tentative de connexion sur compte suspendu');
      activityLog.log(email, 'login_blocked_suspended', { ip: req.ip, detail: accStatus.reason || '' });
      return res.render('pages/login', {
        error: 'Ce compte est suspendu' + (accStatus.reason ? ' : ' + accStatus.reason : '') + '. Contacte l\'administration.',
        title: 'Connexion — TechSphere Webmail',
        knownAccounts,
        redirectTo: redirectTo || '',
      });
    }

    const rememberMe = req.body.rememberMe === '1' || req.body.rememberMe === 'on';

    const twofa = await totpService.getStatus(email);
    if (twofa.enabled) {
      // Ne pas finaliser la session tout de suite — l'utilisateur doit
      // d'abord fournir son code d'authentification à deux facteurs.
      // La destination de redirection est gardée en session, pas dans le
      // formulaire 2FA, pour survivre à cette étape intermédiaire.
      req.session.pending2FA = { email, password: encrypt(password), rememberMe, redirectTo };
      logger.auth(email, 'INFO', 'Login IMAP OK, en attente du code 2FA');
      activityLog.log(email, 'login_pending_2fa', { ip: req.ip });
      return res.render('pages/login', {
        error: null,
        title: 'Connexion — TechSphere Webmail',
        knownAccounts,
        require2FA: true,
        pendingEmail: email,
      });
    }

    await setAuthenticatedSession(req, res, email, password, rememberMe);

    logger.auth(email, 'INFO', 'Login OK');
    activityLog.log(email, 'login_success', { ip: req.ip });
    return res.redirect(redirectTo || '/mail');
  } catch (err) {
    if (err instanceof deviceService.DeviceBlockedError) {
      logger.auth(email, 'WARN', 'Connexion refusée : appareil bloqué');
      activityLog.log(email, 'login_blocked_device', { ip: req.ip });
      return res.render('pages/login', {
        error: err.message,
        title: 'Connexion — TechSphere Webmail',
        knownAccounts,
        redirectTo: redirectTo || '',
      });
    }

    logger.auth(email, 'ERROR', 'Échec login', { message: err.message });
    activityLog.log(email, 'login_failed', { ip: req.ip, detail: err.message.slice(0, 200) });

    return res.render('pages/login', {
      error: 'Identifiants incorrects : ' + err.message,
      title: 'Connexion — TechSphere Webmail',
      knownAccounts,
      redirectTo: redirectTo || '',
    });
  }
}

// Étape 2 du login quand la 2FA est activée : vérifie le code TOTP (ou un
// code de secours), puis finalise la session exactement comme un login normal.
async function verifyLogin2FA(req, res) {
  const pending = req.session.pending2FA;
  const knownAccounts = await getKnownAccounts(req, res);

  if (!pending) {
    return res.redirect('/login');
  }

  const { token } = req.body;
  const ok = token ? await totpService.verifyLoginCode(pending.email, token) : false;

  if (!ok) {
    return res.render('pages/login', {
      error: 'Code de vérification invalide',
      title: 'Connexion — TechSphere Webmail',
      knownAccounts,
      require2FA: true,
      pendingEmail: pending.email,
    });
  }

  const password = decrypt(pending.password);
  const redirectTo = pending.redirectTo;
  delete req.session.pending2FA;

  try {
    await setAuthenticatedSession(req, res, pending.email, password, pending.rememberMe);
  } catch (err) {
    if (err instanceof deviceService.DeviceBlockedError) {
      logger.auth(pending.email, 'WARN', 'Connexion refusée après 2FA : appareil bloqué');
      activityLog.log(pending.email, 'login_blocked_device', { ip: req.ip, detail: '2FA' });
      return res.render('pages/login', {
        error: err.message,
        title: 'Connexion — TechSphere Webmail',
        knownAccounts,
        redirectTo: redirectTo || '',
      });
    }
    throw err;
  }

  logger.auth(pending.email, 'INFO', 'Login OK (2FA vérifiée)');
  activityLog.log(pending.email, 'login_success', { ip: req.ip, detail: '2FA' });
  return res.redirect(redirectTo || '/mail');
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
  // Affiche dans ton terminal de serveur pour vérifier les données reçues
  console.log('--- TENTATIVE AJOUT COMPTE ---');
  console.log('Body reçu:', req.body); 
  
  const { username, password, domain } = req.body;
  
  // Construction de l'email
  let email = username;
  if (username && !username.includes('@')) {
    const suffix = domain || '@netiify.cloud';
    email = `${username}${suffix}`;
  }
  
  console.log('Email final testé:', email);

  try {
    // On teste la connexion avec l'email construit (ex: contact@kweapp.com)
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
  verifyLogin2FA,
  doRegister,
  suggestRegisterEmail,
  addAccount,
  removeAccount,
  removeKnownAccount,
  switchAccount,
  doLogout,
  getMe,
  setAuthenticatedSession
};