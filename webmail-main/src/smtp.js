const nodemailer = require('nodemailer');
const logger     = require('./logger');

function createTransporter(credentials) {
  return nodemailer.createTransport({
    host:       'mail.netiify.cloud',
    port:       587,
    secure:     false,
    requireTLS: true,
    auth:       { user: credentials.email, pass: credentials.password },
    tls:        { rejectUnauthorized: false },
  });
}

async function sendEmail(credentials, { to, cc, bcc, subject, body }) {
  logger.smtp(credentials.email, 'INFO', `Envoi email à "${to}" sujet="${subject}"`);
  const transporter = createTransporter(credentials);
  const info = await transporter.sendMail({
    from:    credentials.email,
    to, cc: cc || undefined, bcc: bcc || undefined, subject,
    html:    body.replace(/\n/g, '<br>'),
    text:    body,
  });
  logger.smtp(credentials.email, 'INFO', `Email envoyé messageId=${info.messageId}`);
  return info;
}

module.exports = { sendEmail };
