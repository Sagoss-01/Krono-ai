const nodemailer = require('nodemailer');
const logger = require('./logger');

const SMTP_HOST = process.env.SMTP_HOST || 'mail.netiify.cloud';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SYSTEM_EMAIL = process.env.SYSTEM_EMAIL;
const SYSTEM_EMAIL_PASS = process.env.SYSTEM_EMAIL_PASS;

function createTransporter() {
  if (!SYSTEM_EMAIL || !SYSTEM_EMAIL_PASS) throw new Error('SYSTEM_EMAIL ou SYSTEM_EMAIL_PASS manquant dans .env');
  return nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: false,
    auth: { user: SYSTEM_EMAIL, pass: SYSTEM_EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

function wrapHtml({ title, color, body }) {
  return `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#060d1a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0f172a;border:1px solid rgba(148,163,184,.15);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;background:${color};">
          <div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.8);font-weight:700;">TechSphere Webmail</div>
          <h1 style="margin:8px 0 0;font-size:21px;color:#fff;">${title}</h1>
        </td></tr>
        <tr><td style="padding:28px;color:#cbd5e1;font-size:14px;line-height:1.7;">${body}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid rgba(148,163,184,.12);background:#0b1324;color:#64748b;font-size:11px;">
          Message automatique — Administration TechSphere Webmail
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();
}

async function sendSuspensionNotice({ to, reason }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: 'Votre compte a été suspendu',
    html: wrapHtml({
      title: 'Compte suspendu',
      color: '#b91c1c',
      body: `Votre compte <b>${to}</b> a été suspendu par un administrateur.<br/><br/>
        ${reason ? `<b>Motif :</b> ${reason}<br/><br/>` : ''}
        Vous ne pouvez plus vous connecter tant que la suspension est active. Contactez l'administration si vous pensez qu'il s'agit d'une erreur.`,
    }),
  });
  logger.smtp(to, 'INFO', 'Notification de suspension envoyée');
}

async function sendReactivationNotice({ to }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: 'Votre compte a été réactivé',
    html: wrapHtml({
      title: 'Compte réactivé',
      color: '#15803d',
      body: `Bonne nouvelle : votre compte <b>${to}</b> a été réactivé. Vous pouvez de nouveau vous connecter normalement.`,
    }),
  });
  logger.smtp(to, 'INFO', 'Notification de réactivation envoyée');
}

async function sendAccountDeletedNotice({ to }) {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
      to,
      subject: 'Votre compte a été supprimé',
      html: wrapHtml({
        title: 'Compte supprimé',
        color: '#4b5563',
        body: `Votre compte <b>${to}</b> et sa boîte mail ont été définitivement supprimés par un administrateur. Cette action est irréversible.`,
      }),
    });
    logger.smtp(to, 'INFO', 'Notification de suppression envoyée');
  } catch (e) {
    // La boîte peut déjà être supprimée au moment de l'envoi — on tente quand
    // même AVANT la suppression réelle côté appelant, mais on ne bloque jamais.
    logger.smtp(to, 'WARN', 'Notification de suppression non envoyée', { message: e.message });
  }
}

module.exports = { sendSuspensionNotice, sendReactivationNotice, sendAccountDeletedNotice };
