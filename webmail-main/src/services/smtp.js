const nodemailer    = require('nodemailer');
const logger        = require('./logger');
const { getSignature } = require('./signature');
const imapService   = require('./imap');

function createTransporter(credentials) {
  return nodemailer.createTransport({
    host: 'mail.netiify.cloud', port: 587, secure: false, requireTLS: true,
    auth: { user: credentials.email, pass: credentials.password },
    tls:  { rejectUnauthorized: false },
  });
}

async function sendEmail(credentials, { to, cc, bcc, subject, body, attachments, dsr, inReplyTo, references } = {}) {
  const options = { dsr, inReplyTo, references };
  logger.smtp(credentials.email, 'INFO', `Envoi à "${to}" sujet="${subject}" att=${(attachments||[]).length}`);

  // Injecter header + footer personnalisés depuis la BDD
  let htmlBody = body.replace(/\n/g, '<br>');
  try {
    const sig = await getSignature(credentials.email);
    if (sig.header_html) htmlBody = sig.header_html + '<br><br>' + htmlBody;
    if (sig.footer_html) htmlBody = htmlBody + '<br><br>' + sig.footer_html;
  } catch (e) {
    logger.smtp(credentials.email, 'WARN', `Signature non chargée: ${e.message}`);
  }

  const mailOptions = {
    from: credentials.email, to,
    cc: cc || undefined, bcc: bcc || undefined,
    subject, html: htmlBody, text: body,
  };

  // Accusé de réception
  if (options.dsr) {
    mailOptions.headers = {
      'Disposition-Notification-To': credentials.email,
      'Return-Receipt-To': credentials.email,
    };
  }

  // Réponse à un thread (In-Reply-To + References)
  if (options.inReplyTo) {
    mailOptions.inReplyTo  = options.inReplyTo;
    mailOptions.references = options.references || options.inReplyTo;
  }

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map(f => ({
      filename: f.originalname, content: f.buffer, contentType: f.mimetype,
    }));
  }

  const info = await createTransporter(credentials).sendMail(mailOptions);
  logger.smtp(credentials.email, 'INFO', `Envoyé messageId=${info.messageId}`);

  // ── Sauvegarder dans Sent via IMAP ────────────────────────────────────────
  try {
    await imapService.saveToSent(credentials, {
      to, cc, bcc, subject,
      htmlBody,
      textBody: body,
      attachments: attachments || [],
      messageId: info.messageId,
    });
    logger.smtp(credentials.email, 'INFO', `Copie sauvegardée dans Sent (${info.messageId})`);
  } catch (e) {
    // Non bloquant : l'email est déjà parti, on logue juste l'erreur
    logger.smtp(credentials.email, 'WARN', `Échec sauvegarde Sent: ${e.message}`);
  }

  return info;
}

module.exports = { sendEmail };