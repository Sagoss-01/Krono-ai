/**
 * src/services/scheduledEmailService.js
 * Envoi programmé PERSISTANT : l'envoi survit au redémarrage du serveur et à la déconnexion de l'utilisateur.
 *
 * Sécurité :
 *  - le mot de passe de la boîte, le message et les pièces jointes sont chiffrés au repos (AES-256-GCM, clé
 *    CHAT_ENCRYPTION_KEY via messageCrypto). Sans cette clé, la programmation persistante est REFUSÉE
 *    (on ne stocke jamais un mot de passe en clair) ;
 *  - dès que l'envoi est terminé, annulé ou définitivement échoué, mot de passe, contenu et fichiers sont EFFACÉS ;
 *  - 20 envois en attente maximum par compte, 30 jours maximum, 3 tentatives espacées de 5 minutes.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const messageCrypto = require('./messageCrypto');

const DIR = process.env.SCHEDULED_MAIL_DIR || path.join(__dirname, '..', '..', 'storage', 'scheduled');
const MAX_PENDING = 20;
const MAX_DELAY_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 5 * 60 * 1000;
const STUCK_MS = 10 * 60 * 1000;
const KEEP_DAYS = 7;

class ScheduleError extends Error {}

const utc = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const enc = (v) => messageCrypto.encryptContent(JSON.stringify(v));
const dec = (v) => JSON.parse(messageCrypto.decryptContent(v));
const dirOf = (id) => path.join(DIR, String(Number(id)));
const wipeFiles = (id) => { try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch (_) { /* déjà supprimé */ } };

/** Programme un envoi. @returns {Promise<number>} identifiant */
async function create({ owner, creds, mail, files = [], sendAt }) {
  if (!messageCrypto.isConfigured) throw new ScheduleError('Envoi programmé indisponible : la clé de chiffrement du serveur n\'est pas configurée.');
  const when = new Date(sendAt);
  const delay = when - Date.now();
  if (isNaN(delay) || delay < 30000) throw new ScheduleError("La date d'envoi doit être dans le futur.");
  if (delay > MAX_DELAY_MS) throw new ScheduleError("L'envoi ne peut pas être programmé à plus de 30 jours.");

  const [[row]] = await pool.execute(`SELECT COUNT(*) AS n FROM scheduled_emails WHERE owner_email = ? AND status IN ('pending','sending')`, [owner]);
  if (Number(row.n) >= MAX_PENDING) throw new ScheduleError(`Vous avez déjà ${MAX_PENDING} envois en attente. Annulez-en un ou attendez qu'il parte.`);

  const attachments = files.map((f, i) => ({ index: i, name: String(f.originalname || `fichier-${i}`).slice(0, 180), type: String(f.mimetype || 'application/octet-stream').slice(0, 100) }));
  const [r] = await pool.execute(
    `INSERT INTO scheduled_emails (owner_email, send_at, status, creds_enc, payload_enc) VALUES (?, ?, 'pending', ?, ?)`,
    [owner, utc(when), enc({ email: creds.email, password: creds.password }), enc({ ...mail, attachments })]
  );
  const id = r.insertId;
  try {
    if (files.length) {
      fs.mkdirSync(dirOf(id), { recursive: true, mode: 0o700 });
      files.forEach((f, i) => fs.writeFileSync(path.join(dirOf(id), `${i}.bin`), messageCrypto.encryptContent(f.buffer.toString('base64')), { mode: 0o600 }));
    }
  } catch (e) {
    await pool.execute(`DELETE FROM scheduled_emails WHERE id = ?`, [id]);
    wipeFiles(id);
    throw new ScheduleError("Les pièces jointes n'ont pas pu être enregistrées pour l'envoi différé.");
  }
  return id;
}

const wipe = async (id) => { await pool.execute(`UPDATE scheduled_emails SET creds_enc = '', payload_enc = '' WHERE id = ?`, [id]); wipeFiles(id); };

/** Annule un envoi en attente (propriétaire uniquement). */
async function cancel(owner, id) {
  const [r] = await pool.execute(`UPDATE scheduled_emails SET status = 'cancelled', finished_at = ? WHERE id = ? AND owner_email = ? AND status = 'pending'`, [utc(Date.now()), id, owner]);
  if (!r.affectedRows) return false;
  await wipe(id);
  return true;
}

/** Envois en attente du propriétaire. */
async function listPending(owner) {
  const [rows] = await pool.execute(`SELECT id, DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%sZ') AS send_iso, payload_enc FROM scheduled_emails WHERE owner_email = ? AND status = 'pending' ORDER BY send_at LIMIT ${MAX_PENDING}`, [owner]);
  return rows.map(r => { let p = {}; try { p = dec(r.payload_enc); } catch (_) { /* illisible : on n'affiche que la date */ } return { id: r.id, sendAt: r.send_iso, subject: p.subject || '(sans objet)', to: p.to || '' }; });
}

async function notifyFailure(owner, subject, reason) {
  try {
    await require('./systemMailer').sendSystemMail({
      to: owner, subject: `Envoi programmé échoué : ${String(subject).slice(0, 80)}`,
      text: `Votre message programmé « ${subject} » n'a pas pu être envoyé (${reason}).\nIl a été abandonné après ${MAX_ATTEMPTS} tentatives et son contenu a été effacé du serveur. Vous pouvez le renvoyer manuellement.`,
    });
  } catch (_) { /* notification de courtoisie : jamais bloquante */ }
}

/** Traite un envoi déjà « réservé » (status = sending). */
async function processOne(id, sendMail) {
  const [[row]] = await pool.execute(`SELECT id, owner_email, attempts, creds_enc, payload_enc FROM scheduled_emails WHERE id = ?`, [id]);
  if (!row) return;
  let mail = {};
  try {
    const creds = dec(row.creds_enc);
    mail = dec(row.payload_enc);
    const attachments = (mail.attachments || []).map(a => ({
      originalname: a.name, mimetype: a.type,
      buffer: Buffer.from(messageCrypto.decryptContent(fs.readFileSync(path.join(dirOf(id), `${a.index}.bin`), 'utf8')), 'base64'),
    }));
    await sendMail(creds, { ...mail, attachments });
    await pool.execute(`UPDATE scheduled_emails SET status = 'sent', finished_at = ?, last_error = NULL WHERE id = ?`, [utc(Date.now()), id]);
    await wipe(id);
    console.log(`[Programmation] message #${id} envoyé`);
  } catch (e) {
    const reason = String(e.message || 'erreur inconnue').slice(0, 200);
    console.error(`[Programmation] échec #${id} (essai ${row.attempts}) :`, reason);
    if (row.attempts < MAX_ATTEMPTS) {
      await pool.execute(`UPDATE scheduled_emails SET status = 'pending', send_at = ?, last_error = ?, claimed_at = NULL WHERE id = ?`, [utc(Date.now() + RETRY_MS), reason.slice(0, 250), id]);
    } else {
      await pool.execute(`UPDATE scheduled_emails SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?`, [utc(Date.now()), reason.slice(0, 250), id]);
      await wipe(id);
      await notifyFailure(row.owner_email, mail.subject || '(sans objet)', reason);
    }
  }
}

/** Envoie ce qui est dû. Chaque ligne est réservée de façon atomique : jamais d'envoi en double, même à plusieurs processus. */
async function runDue(sendMail = (creds, mail) => require('./smtp').sendEmail(creds, mail)) {
  const [rows] = await pool.execute(`SELECT id FROM scheduled_emails WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20`, [utc(Date.now())]);
  let done = 0;
  for (const { id } of rows) {
    const [claim] = await pool.execute(`UPDATE scheduled_emails SET status = 'sending', attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = 'pending'`, [utc(Date.now()), id]);
    if (!claim.affectedRows) continue;
    await processOne(id, sendMail);
    done++;
  }
  return done;
}

/** Reprise après un arrêt brutal : un envoi « en cours » depuis trop longtemps repasse en attente. */
async function recoverStuck() {
  const [r] = await pool.execute(`UPDATE scheduled_emails SET status = 'pending' WHERE status = 'sending' AND claimed_at < ?`, [utc(Date.now() - STUCK_MS)]);
  return r.affectedRows || 0;
}

/** Supprime les lignes terminées depuis plus de 7 jours (elles ne contiennent déjà plus de secret). */
async function purgeOld() {
  await pool.execute(`DELETE FROM scheduled_emails WHERE status IN ('sent','failed','cancelled') AND finished_at < ?`, [utc(Date.now() - KEEP_DAYS * 86400000)]);
}

/** RGPD : supprime tout ce qui appartient à un compte. */
async function deleteAllFor(owner) {
  const [rows] = await pool.execute(`SELECT id FROM scheduled_emails WHERE owner_email = ?`, [owner]);
  rows.forEach(r => wipeFiles(r.id));
  await pool.execute(`DELETE FROM scheduled_emails WHERE owner_email = ?`, [owner]);
}

module.exports = { create, cancel, listPending, runDue, recoverStuck, purgeOld, deleteAllFor, ScheduleError, MAX_PENDING, MAX_ATTEMPTS };
