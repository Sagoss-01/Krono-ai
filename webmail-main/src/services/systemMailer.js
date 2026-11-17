/**
 * src/services/systemMailer.js
 * Envoi d'e-mails « système » (compte SYSTEM_EMAIL du .env) : compte-rendu automatique de réunion, etc.
 * Même configuration SMTP que calendarMailService.
 */
const nodemailer = require('nodemailer');
const logger = require('./logger');

function createTransporter() {
  const { SYSTEM_EMAIL, SYSTEM_EMAIL_PASS } = process.env;
  if (!SYSTEM_EMAIL || !SYSTEM_EMAIL_PASS) throw new Error('SYSTEM_EMAIL ou SYSTEM_EMAIL_PASS manquant dans .env');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.netiify.cloud',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: SYSTEM_EMAIL, pass: SYSTEM_EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function sendSystemMail({ to, subject, text, html }) {
  await createTransporter().sendMail({
    from: `"TechSphere Webmail" <${process.env.SYSTEM_EMAIL}>`,
    to, subject, text, html,
  });
  logger.smtp(to, 'INFO', `E-mail système envoyé : ${subject}`);
}

module.exports = { sendSystemMail };
