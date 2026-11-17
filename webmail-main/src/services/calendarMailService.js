const nodemailer = require('nodemailer');
const logger = require('./logger');

const SMTP_HOST = process.env.SMTP_HOST || 'mail.netiify.cloud';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SYSTEM_EMAIL = process.env.SYSTEM_EMAIL;
const SYSTEM_EMAIL_PASS = process.env.SYSTEM_EMAIL_PASS;

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

async function sendEventInvite({ to, organizerEmail, title, startAt, location, icsContent, isMeeting, meetingLink }) {
  const transporter = createTransporter();
  const when = new Date(startAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:14px;border:1px solid rgba(3,92,128,.2);">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#7dd3fc;font-weight:700;margin-bottom:10px;">Invitation${isMeeting ? ' — Réunion' : ''}</div>
      <h2 style="margin:0 0 14px;color:#fff;">${title}</h2>
      <p style="margin:0 0 6px;color:#94a3b8;">📅 ${when}</p>
      ${location ? `<p style="margin:0 0 6px;color:#94a3b8;">📍 ${location}</p>` : ''}
      ${meetingLink ? `<p style="margin:16px 0;"><a href="${meetingLink}" style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#035c80,#8b5cf6);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Rejoindre la réunion</a></p>` : ''}
      <p style="margin:16px 0 0;font-size:12px;color:#64748b;">Invité(e) par ${organizerEmail}. Ouvrez la pièce jointe pour ajouter cet événement à votre calendrier.</p>
    </div>`;

  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: `Invitation : ${title}`,
    html,
    icalEvent: {
      filename: 'invitation.ics',
      method: 'REQUEST',
      content: icsContent,
    },
  });
  logger.smtp(to, 'INFO', 'Invitation calendrier envoyée');
}

async function sendReminder({ to, title, startAt, meetingLink }) {
  const transporter = createTransporter();
  const when = new Date(startAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  await transporter.sendMail({
    from: `"TechSphere Webmail" <${SYSTEM_EMAIL}>`,
    to,
    subject: `⏰ Rappel : ${title}`,
    html: `<div style="font-family:Arial,sans-serif;padding:20px;">
      <h3>⏰ Rappel</h3>
      <p><b>${title}</b> commence à ${when}.</p>
      ${meetingLink ? `<p><a href="${meetingLink}">Rejoindre la réunion</a></p>` : ''}
    </div>`,
  });
  logger.smtp(to, 'INFO', 'Rappel calendrier envoyé');
}

module.exports = { sendEventInvite, sendReminder };
