/**
 * src/services/gdprService.js
 *
 * Droit d'accès (export) et droit à l'effacement (suppression de compte).
 *
 * Principe de suppression retenu, volontairement pas un simple "DELETE
 * partout" :
 *  - Les données strictement PERSONNELLES (contacts, calendrier, appareils,
 *    2FA, etc.) sont supprimées intégralement.
 *  - Les messages envoyés à D'AUTRES personnes (chat, chat de réunion) sont
 *    ANONYMISÉS (contenu remplacé) plutôt que supprimés en dur — sinon on
 *    supprime aussi, de facto, une partie de la conversation de la personne
 *    en face, qui n'a rien demandé.
 *  - Les réunions dont la personne était l'HÔTE ne sont pas supprimées :
 *    d'autres participants y ont pris part et leur historique en dépend.
 */
const { pool } = require('./db');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const TOMBSTONE = '[Message supprimé — compte utilisateur effacé]';

// ── Export (droit d'accès / portabilité) ───────────────────────────────────

async function exportUserData(email) {
  const [[profile]] = await pool.query(
    `SELECT email, first_name, last_name, gender, birth_date, recovery_email, recovery_verified
     FROM app_users WHERE email = ?`, [email]
  );

  const [contacts] = await pool.query(
    `SELECT name, email, phone, favorite, created_at FROM contacts WHERE owner_email = ?`, [email]
  );

  const [calendarEvents] = await pool.query(
    `SELECT id, title, description, start_at, end_at, created_at FROM calendar_events WHERE owner_email = ?`, [email]
  );

  const [chatConversations] = await pool.query(
    `SELECT peer_email, last_at, unread_count FROM chat_conversations WHERE email = ?`, [email]
  );

  const [sentMessages] = await pool.query(
    `SELECT room, content, media_type, created_at FROM chat_messages WHERE sender = ? ORDER BY created_at ASC`, [email]
  );
  const messageCrypto = require('./messageCrypto');
  sentMessages.forEach(m => { if (m.content) m.content = messageCrypto.decryptContent(m.content); });

  const [meetingsHosted] = await pool.query(
    `SELECT id, title, created_at, started_at, ended_at FROM meetings WHERE host = ?`, [email]
  );

  const [meetingsAttended] = await pool.query(
    `SELECT meeting_id, joined_at, left_at FROM meeting_participants WHERE email = ?`, [email]
  );

  const [devices] = await pool.query(
    `SELECT browser_id, device_label, ip, trusted, first_seen, last_seen FROM user_devices WHERE email = ? AND revoked_at IS NULL`, [email]
  );

  const [activityLog] = await pool.query(
    `SELECT event, ip, detail, created_at FROM activity_log WHERE email = ? ORDER BY created_at DESC LIMIT 500`, [email]
  );

  const [has2fa] = await pool.query(`SELECT email FROM user_2fa WHERE email = ?`, [email]);

  // Conversations avec l'assistant IA (déchiffrées pour l'export)
  const aiConversations = await require('./aiChatService').exportAll(email);
  const aiPreferences = await require('./aiPreferencesService').get(email);
  const [aiFeedbackRows] = await pool.query(`SELECT ts, feature, note FROM ai_feedback WHERE user_key = ?`, [email]);
  const [aiAuditRows] = await pool.query(`SELECT ts, action, detail FROM ai_audit WHERE user_key = ? ORDER BY id DESC LIMIT 1000`, [email]);
  const [aiUsageRows] = await pool.query(`SELECT COUNT(*) AS calls, MIN(ts) AS first_call, MAX(ts) AS last_call FROM ai_usage WHERE user_key = ?`, [email]);
  const [scheduledRows] = await pool.query(`SELECT id, send_at, status FROM scheduled_emails WHERE owner_email = ?`, [email]);
  const [aiSummaryRows] = await pool.query(`SELECT meeting_id, summary, created_at FROM meeting_ai_summaries WHERE host_email = ?`, [email]);
  const meetingAiSummaries = aiSummaryRows.map(r => ({ meetingId: r.meeting_id, createdAt: r.created_at, summary: require('./messageCrypto').decryptContent(r.summary) }));

  return {
    exportedAt: new Date().toISOString(),
    profile,
    contacts,
    calendarEvents,
    chat: { conversations: chatConversations, sentMessages },
    meetings: { hosted: meetingsHosted, attended: meetingsAttended },
    devices,
    twoFactorEnabled: has2fa.length > 0,
    aiConversations,
    aiPreferences,
    aiFeedback: aiFeedbackRows, aiAuditLog: aiAuditRows, aiUsageSummary: aiUsageRows[0] || {}, scheduledEmails: scheduledRows,
    meetingAiSummaries,
    activityLog,
  };
}

// ── Suppression de compte (droit à l'effacement) ──────────────────────────

async function deleteMailbox(email) {
  // ⚠️ À vérifier côté serveur, même logique que create_mailbox.py /
  // set_mailbox_password.py : ce script existe déjà sur le serveur mail
  // (vu dans /opt/netiify/bin/), mais je n'ai pas eu son contenu exact —
  // si l'interface réelle diffère (nom des arguments, etc.), ajuster
  // uniquement l'appel ci-dessous.
  try {
    await execFileAsync('sudo', ['/opt/netiify/bin/delete_mailbox.py', '--email', email], { timeout: 40000 });
  } catch (err) {
    throw new Error('Échec suppression boîte mail côté serveur : ' + (err.stderr || err.message));
  }
}

async function deleteUserAccount(email) {
  // Les envois programmés (mot de passe chiffré, contenu, fichiers sur disque) sont effacés AVANT la transaction
  await require('./scheduledEmailService').deleteAllFor(email);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Anonymiser (pas supprimer) le contenu envoyé à d'autres personnes
    await conn.execute(`UPDATE chat_messages SET content = ? WHERE sender = ?`, [TOMBSTONE, email]);
    await conn.execute(`UPDATE meeting_chat_messages SET content = ? WHERE sender = ?`, [TOMBSTONE, email]);

    // 2. Supprimer les données strictement personnelles
    await conn.execute(`DELETE FROM chat_conversations WHERE email = ? OR peer_email = ?`, [email, email]);
    await conn.execute(`DELETE FROM contacts WHERE owner_email = ?`, [email]);
    await conn.execute(`DELETE FROM ai_conversations WHERE owner_email = ?`, [email]); // ai_messages supprimés en cascade
    await conn.execute(`DELETE FROM ai_preferences WHERE owner_email = ?`, [email]);
    await conn.execute(`DELETE FROM ai_feedback WHERE user_key = ?`, [email]);
    await conn.execute(`DELETE FROM ai_audit WHERE user_key = ?`, [email]);
    await conn.execute(`DELETE FROM ai_usage WHERE user_key = ?`, [email]);
    await conn.execute(`DELETE FROM scheduled_emails WHERE owner_email = ?`, [email]);
    await conn.execute(`DELETE FROM meeting_ai_summaries WHERE host_email = ?`, [email]);
    await conn.execute(`DELETE FROM calendar_event_attendees WHERE email = ?`, [email]);
    await conn.execute(
      `DELETE cea FROM calendar_event_attendees cea
       JOIN calendar_events ce ON ce.id = cea.event_id
       WHERE ce.owner_email = ?`, [email]
    );
    await conn.execute(`DELETE FROM calendar_events WHERE owner_email = ?`, [email]);
    await conn.execute(`DELETE FROM user_signatures WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM user_2fa WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM user_2fa_backup_codes WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM user_devices WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM blocked_devices WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM browser_accounts WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM password_reset_codes WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM meeting_reviews WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM meeting_participants WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM activity_log WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM account_status WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM admins WHERE email = ?`, [email]);
    await conn.execute(`DELETE FROM quick_connect_tokens WHERE email = ?`, [email]);

    // 3. Le compte lui-même, en dernier
    await conn.execute(`DELETE FROM app_users WHERE email = ?`, [email]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // 4. La vraie boîte mail (IMAP/SMTP), hors transaction SQL — si ça échoue,
  // les données applicatives sont déjà supprimées ; on remonte l'erreur pour
  // que l'administrateur sache qu'un nettoyage manuel du serveur mail reste
  // nécessaire, plutôt que d'échouer silencieusement.
  await deleteMailbox(email);
}

module.exports = { exportUserData, deleteUserAccount };
