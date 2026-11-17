const nodemailer = require('nodemailer');
const logger = require('./logger');

const SMTP_HOST = process.env.SMTP_HOST || 'mail.netiify.cloud';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SYSTEM_EMAIL = process.env.SYSTEM_EMAIL;
const SYSTEM_EMAIL_PASS = process.env.SYSTEM_EMAIL_PASS;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createTransporter() {
  if (!SYSTEM_EMAIL || !SYSTEM_EMAIL_PASS) {
    throw new Error('SYSTEM_EMAIL ou SYSTEM_EMAIL_PASS manquant dans .env');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SYSTEM_EMAIL, pass: SYSTEM_EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

function buildCodeHtml({ title, intro, code, warning }) {
  const safeCode = escapeHtml(code);
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#060d1a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060d1a;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0f172a;border:1px solid rgba(3,92,128,.18);border-radius:18px;overflow:hidden;">
        <tr><td style="padding:0;background:linear-gradient(135deg,#035c80 0%,#8b5cf6 100%);">
          <div style="padding:24px 32px;">
            <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.75);font-weight:700;">TechSphere Webmail</div>
            <h1 style="margin:10px 0 0;font-size:24px;color:#ffffff;">${escapeHtml(title)}</h1>
          </div>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#94a3b8;">${escapeHtml(intro)}</p>
          <div style="text-align:center;margin:24px 0;">
            <div style="display:inline-block;padding:18px 32px;border-radius:14px;background:rgba(3,92,128,.12);border:1px solid rgba(3,92,128,.3);">
              <div style="font-size:34px;font-weight:800;letter-spacing:.25em;color:#7dd3fc;font-family:'Courier New',monospace;">${safeCode}</div>
            </div>
          </div>
          <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#64748b;">${escapeHtml(warning)}</p>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid rgba(3,92,128,.12);background:#0b1324;">
          <div style="font-size:12px;color:#64748b;">© TechSphere Webmail — Messagerie professionnelle sécurisée</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

async function sendRecoveryLinkCode({ to, code, accountEmail }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: 'Code de confirmation — email de secours',
    text: `Code de confirmation pour lier cette adresse comme email de secours du compte ${accountEmail} : ${code}\nCe code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    html: buildCodeHtml({
      title: 'Confirmer votre email de secours',
      intro: `Quelqu'un a demandé à lier cette adresse comme email de secours du compte ${accountEmail}. Entrez ce code dans TechSphere Webmail pour confirmer.`,
      code,
      warning: 'Ce code expire dans 15 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez simplement ce message.',
    }),
  });
  logger.smtp(to, 'INFO', 'Code de liaison email de secours envoyé');
}

async function sendPasswordResetCode({ to, code, accountEmail }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: 'Code de réinitialisation de mot de passe',
    text: `Code de réinitialisation du mot de passe du compte ${accountEmail} : ${code}\nCe code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message et votre mot de passe restera inchangé.`,
    html: buildCodeHtml({
      title: 'Réinitialiser votre mot de passe',
      intro: `Une demande de réinitialisation du mot de passe du compte ${accountEmail} a été faite depuis TechSphere Webmail. Entrez ce code pour choisir un nouveau mot de passe.`,
      code,
      warning: 'Ce code expire dans 15 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message : votre mot de passe restera inchangé.',
    }),
  });
  logger.smtp(to, 'INFO', 'Code de réinitialisation envoyé');
}

async function sendNewDeviceAlert({ to, accountEmail, deviceLabel, ip, when, blockUrl, reason = 'new_device' }) {
  const transporter = createTransporter();
  const safeLabel = escapeHtml(deviceLabel || 'Appareil inconnu');
  const safeIp = escapeHtml(ip || 'IP inconnue');
  const safeWhen = escapeHtml(when);

  const isSuspicious = reason === 'suspicious';
  const heading = isSuspicious ? 'Activité suspecte détectée' : 'Nouvelle connexion détectée';
  const intro = isSuspicious
    ? `Une connexion a réussi sur le compte <strong style="color:#7dd3fc;">${escapeHtml(accountEmail)}</strong> juste après plusieurs tentatives de mot de passe échouées — même si cet appareil est déjà connu, on préfère te prévenir :`
    : `Une connexion vient d'avoir lieu sur le compte <strong style="color:#7dd3fc;">${escapeHtml(accountEmail)}</strong> depuis un appareil qu'on ne reconnaît pas :`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#060d1a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060d1a;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0f172a;border:1px solid rgba(3,92,128,.18);border-radius:18px;overflow:hidden;">
        <tr><td style="padding:0;background:linear-gradient(135deg,#f59e0b 0%,#dc2626 100%);">
          <div style="padding:24px 32px;">
            <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.75);font-weight:700;">TechSphere Webmail</div>
            <h1 style="margin:10px 0 0;font-size:22px;color:#ffffff;">${heading}</h1>
          </div>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#cbd5e1;">
            ${intro}
          </p>
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;margin-bottom:20px;font-size:13px;line-height:2;color:#94a3b8;">
            <div><strong style="color:#f1f5f9;">Appareil :</strong> ${safeLabel}</div>
            <div><strong style="color:#f1f5f9;">Adresse IP :</strong> ${safeIp}</div>
            <div><strong style="color:#f1f5f9;">Date :</strong> ${safeWhen}</div>
          </div>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#94a3b8;">
            Si c'est vous, ignorez ce message. Sinon, bloquez cet appareil immédiatement, en un clic, sans avoir besoin de vous reconnecter :
          </p>
          <div style="text-align:center;margin-top:20px;">
            <a href="${blockUrl}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Ce n'était pas moi — bloquer cet appareil</a>
          </div>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid rgba(3,92,128,.12);background:#0b1324;">
          <div style="font-size:12px;color:#64748b;">© TechSphere Webmail — Messagerie professionnelle sécurisée</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: isSuspicious ? `Activité suspecte sur ${accountEmail}` : `Nouvelle connexion sur ${accountEmail}`,
    text: `${isSuspicious ? 'Activité suspecte' : 'Nouvelle connexion'} sur ${accountEmail} depuis : ${deviceLabel || 'appareil inconnu'} (IP ${ip || 'inconnue'}) le ${when}.\nSi ce n'était pas vous, bloquez cet appareil ici : ${blockUrl}`,
    html
  });

  logger.smtp(to, 'INFO', 'Alerte nouvel appareil envoyée', { accountEmail, deviceLabel });
}

module.exports = { sendRecoveryLinkCode, sendPasswordResetCode, sendNewDeviceAlert };
