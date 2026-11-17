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

function buildWelcomeHtml({ firstName, email }) {
  const safeFirstName = escapeHtml(firstName || 'Bonjour');
  const safeEmail = escapeHtml(email);

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Bienvenue sur TechSphere Webmail</title>
</head>
<body style="margin:0;padding:0;background:#060d1a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060d1a;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0f172a;border:1px solid rgba(3,92,128,.18);border-radius:18px;overflow:hidden;">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,#035c80 0%,#8b5cf6 100%);">
              <div style="padding:28px 32px;">
                <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.75);font-weight:700;">
                  TechSphere Webmail
                </div>
                <h1 style="margin:12px 0 0;font-size:30px;line-height:1.2;color:#ffffff;">
                  Bienvenue à bord ✨
                </h1>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#cbd5e1;">
                Bonjour <strong style="color:#ffffff;">${safeFirstName}</strong>,
              </p>

              <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#94a3b8;">
                Votre compte <strong style="color:#7dd3fc;">TechSphere Webmail</strong> a bien été créé.
                Vous pouvez maintenant envoyer, recevoir et organiser vos emails professionnels depuis votre interface sécurisée.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:rgba(3,92,128,.08);border:1px solid rgba(3,92,128,.18);border-radius:14px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">
                      Votre adresse email
                    </div>
                    <div style="font-size:18px;font-weight:700;color:#7dd3fc;font-family:'Courier New',monospace;">
                      ${safeEmail}
                    </div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0 8px;">
                <tr>
                  <td style="padding:0 0 12px;">
                    <div style="font-size:14px;font-weight:700;color:#ffffff;">Accès rapides</div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style="padding:14px 16px;border-radius:12px;background:#111c31;border:1px solid rgba(3,92,128,.14);margin-bottom:10px;">
                      <div style="font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:4px;">Webmail</div>
                      <div style="font-size:14px;color:#cbd5e1;">https://webmail.netiify.cloud/mail</div>
                    </div>
                    <div style="padding:14px 16px;border-radius:12px;background:#111c31;border:1px solid rgba(3,92,128,.14);margin-bottom:10px;">
                      <div style="font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:4px;">IMAP</div>
                      <div style="font-size:14px;color:#cbd5e1;">mail.netiify.cloud · Port 993 · SSL/TLS</div>
                    </div>
                    <div style="padding:14px 16px;border-radius:12px;background:#111c31;border:1px solid rgba(3,92,128,.14);">
                      <div style="font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:4px;">SMTP</div>
                      <div style="font-size:14px;color:#cbd5e1;">mail.netiify.cloud · Port 587 · STARTTLS</div>
                    </div>
                  </td>
                </tr>
              </table>

              <div style="margin-top:24px;text-align:center;">
                <a href="https://webmail.netiify.cloud/mail"
                   style="display:inline-block;padding:14px 22px;border-radius:12px;background:linear-gradient(135deg,#035c80,#024a6a);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
                  Ouvrir mon webmail
                </a>
              </div>

              <p style="margin:26px 0 0;font-size:13px;line-height:1.7;color:#64748b;">
                Si vous n’êtes pas à l’origine de cette création de compte, contactez immédiatement le support.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px;border-top:1px solid rgba(3,92,128,.12);background:#0b1324;">
              <div style="font-size:12px;color:#64748b;line-height:1.7;">
                © TechSphere Webmail — Messagerie professionnelle sécurisée
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildWelcomeText({ firstName, email }) {
  return [
    `Bonjour ${firstName || ''},`,
    '',
    'Bienvenue sur TechSphere Webmail.',
    'Votre compte email professionnel a bien été créé.',
    '',
    `Adresse : ${email}`,
    'Webmail : https://webmail.netiify.cloud/mail',
    'IMAP : mail.netiify.cloud:993 SSL/TLS',
    'SMTP : mail.netiify.cloud:587 STARTTLS',
    '',
    'Merci de votre confiance.',
    'TechSphere Webmail'
  ].join('\n');
}

function createTransporter() {
  if (!SYSTEM_EMAIL || !SYSTEM_EMAIL_PASS) {
    throw new Error('SYSTEM_EMAIL ou SYSTEM_EMAIL_PASS manquant dans .env');
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
      user: SYSTEM_EMAIL,
      pass: SYSTEM_EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

async function sendWelcomeEmail({ to, firstName }) {
  const transporter = createTransporter();

  const html = buildWelcomeHtml({
    firstName,
    email: to
  });

  const text = buildWelcomeText({
    firstName,
    email: to
  });

  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: 'Bienvenue sur TechSphere Webmail',
    text,
    html
  });

  logger.smtp(to, 'INFO', 'Mail de bienvenue envoyé');
}

module.exports = {
  sendWelcomeEmail
};