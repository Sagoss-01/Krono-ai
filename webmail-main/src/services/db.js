require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER || 'root',
  password:           process.env.DB_PASS || '',
  database:           process.env.DB_NAME || 'webmail_db',
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
});

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}






async function initDB() {
  const conn = await pool.getConnection();
  try {

    // Signatures
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_signatures (
        email       VARCHAR(255) NOT NULL PRIMARY KEY,
        header_html TEXT         NULL,
        footer_html TEXT         NULL,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // chat_messages — media_path au lieu de media_data
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
        room        VARCHAR(255)     NOT NULL,
        sender      VARCHAR(255)     NOT NULL,
        content     TEXT             NULL,
        media_type  ENUM('text','image','file') NOT NULL DEFAULT 'text',
        media_name  VARCHAR(500)     NULL,
        media_mime  VARCHAR(200)     NULL,
        media_size  INT UNSIGNED     NULL,
        media_path  VARCHAR(1000)    NULL,
        created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_room_date (room, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration : ajouter media_path si absent
    if (!(await columnExists(conn, 'chat_messages', 'media_path'))) {
      await conn.execute(`ALTER TABLE chat_messages ADD COLUMN media_path VARCHAR(1000) NULL AFTER media_size`);
      console.log('Migration: colonne media_path ajoutee');
    }
    // Migration : supprimer media_data si elle existe encore (ancienne version BLOB)
    if (await columnExists(conn, 'chat_messages', 'media_data')) {
      await conn.execute(`ALTER TABLE chat_messages DROP COLUMN media_data`);
      console.log('Migration: colonne media_data (BLOB) supprimee');
    }
    // Migration : ajouter les colonnes media_* si absentes (upgrade depuis version sans media)
    const mediaColumns = [
      { name: 'media_type', def: "ENUM('text','image','file') NOT NULL DEFAULT 'text' AFTER content" },
      { name: 'media_name', def: 'VARCHAR(500) NULL AFTER media_type' },
      { name: 'media_mime', def: 'VARCHAR(200) NULL AFTER media_name' },
      { name: 'media_size', def: 'INT UNSIGNED NULL AFTER media_mime' },
    ];
    for (const col of mediaColumns) {
      if (!(await columnExists(conn, 'chat_messages', col.name))) {
        await conn.execute(`ALTER TABLE chat_messages ADD COLUMN ${col.name} ${col.def}`);
        console.log(`Migration: colonne ${col.name} ajoutee`);
      }
    }

    // chat_conversations
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        email        VARCHAR(255) NOT NULL,
        peer_email   VARCHAR(255) NOT NULL,
        room         VARCHAR(255) NOT NULL,
        last_msg     TEXT         NULL,
        last_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        unread_count INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (email, peer_email),
        INDEX idx_email_last (email, last_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // browser_accounts
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS browser_accounts (
        browser_id  VARCHAR(64)  NOT NULL,
        email       VARCHAR(255) NOT NULL,
        added_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (browser_id, email),
        INDEX idx_browser (browser_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Purge automatique messages > 6 mois + fichiers disque
    const { purgeOldFiles } = require('./chat');
    await purgeOldFiles();
    const [purge] = await conn.execute(
      `DELETE FROM chat_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 6 MONTH)`
    );
    if (purge.affectedRows > 0) {
      console.log(`Purge: ${purge.affectedRows} message(s) de plus de 6 mois supprimes`);
    }

    // chat_reactions
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chat_reactions (
        id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        msg_id   BIGINT UNSIGNED NOT NULL,
        sender   VARCHAR(255)    NOT NULL,
        emoji    VARCHAR(10)     NOT NULL,
        UNIQUE KEY uniq_react (msg_id, sender, emoji),
        INDEX idx_msg (msg_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // msg_status (lu/livré style double coche)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chat_msg_status (
        msg_id   BIGINT UNSIGNED NOT NULL,
        reader   VARCHAR(255)    NOT NULL,
        read_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (msg_id, reader)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // colonne deleted_at sur chat_messages
    if (!(await columnExists(conn, 'chat_messages', 'deleted_at'))) {
      await conn.execute('ALTER TABLE chat_messages ADD COLUMN deleted_at DATETIME NULL AFTER created_at');
      console.log('Migration: deleted_at ajoutee');
    }

    console.log('DB initialisee');

    // ── MEETINGS ──────────────────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS meetings (
        id           VARCHAR(12)   NOT NULL PRIMARY KEY,
        title        VARCHAR(255)  NOT NULL DEFAULT 'Réunion',
        host         VARCHAR(255)  NOT NULL,
        access       ENUM('link','code','emails') NOT NULL DEFAULT 'link',
        code         VARCHAR(10)   NULL,
        allowed_emails TEXT        NULL,
        scheduled_at DATETIME      NULL,
        started_at   DATETIME      NULL,
        ended_at     DATETIME      NULL,
        status       ENUM('scheduled','live','ended') NOT NULL DEFAULT 'scheduled',
        created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        allow_guests TINYINT(1)    NOT NULL DEFAULT 0,
        INDEX idx_host   (host),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration : ajouter allow_guests si absent
    if (!(await columnExists(conn, 'meetings', 'allow_guests'))) {
      await conn.execute('ALTER TABLE meetings ADD COLUMN allow_guests TINYINT(1) NOT NULL DEFAULT 0 AFTER allowed_emails');
      console.log('Migration: allow_guests ajouté');
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS meeting_participants (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        meeting_id VARCHAR(12)  NOT NULL,
        email      VARCHAR(255) NOT NULL,
        joined_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        left_at    DATETIME     NULL,
        UNIQUE KEY uniq_part (meeting_id, email),
        INDEX idx_meeting (meeting_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);


    await conn.execute(`
      CREATE TABLE IF NOT EXISTS meeting_chat_messages (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        meeting_id VARCHAR(12)  NOT NULL,
        sender     VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NULL,
        anonymous  TINYINT(1)   NOT NULL DEFAULT 0,
        content    TEXT         NULL,
        file_id    VARCHAR(64)  NULL,
        file_name  VARCHAR(255) NULL,
        file_type  VARCHAR(255) NULL,
        file_size  BIGINT       NULL,
        file_url   TEXT         NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_meeting_created (meeting_id, created_at),
        INDEX idx_meeting_sender (meeting_id, sender)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── AVIS RÉUNIONS ──────────────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS meeting_reviews (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        meeting_id VARCHAR(12)  NOT NULL,
        email      VARCHAR(255) NOT NULL,
        rating     TINYINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment    TEXT         NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_review (meeting_id, email),
        INDEX idx_meeting_id (meeting_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB meetings initialisees');

    // ── RÉCUPÉRATION DE COMPTE (email de confiance) ─────────────────────────
    // app_users existe déjà (créée hors de ce script) — on ajoute juste les
    // colonnes si elles manquent, migration non destructive comme ailleurs.
    if (!(await columnExists(conn, 'app_users', 'recovery_email'))) {
      await conn.execute('ALTER TABLE app_users ADD COLUMN recovery_email VARCHAR(255) NULL AFTER password_hash');
      console.log('Migration: recovery_email ajoutee sur app_users');
    }
    if (!(await columnExists(conn, 'app_users', 'recovery_verified'))) {
      await conn.execute('ALTER TABLE app_users ADD COLUMN recovery_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER recovery_email');
      console.log('Migration: recovery_verified ajoutee sur app_users');
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        target     VARCHAR(255) NOT NULL,
        code_hash  VARCHAR(255) NOT NULL,
        purpose    ENUM('link_recovery','reset_password') NOT NULL,
        expires_at DATETIME     NOT NULL,
        used_at    DATETIME     NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_purpose (email, purpose),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Purge des codes expirés depuis plus de 24h (ménage, non bloquant)
    try {
      await conn.execute(`DELETE FROM password_reset_codes WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
    } catch (e) { /* non bloquant */ }

    console.log('DB recuperation de compte initialisee');

    // ── CARNET DE CONTACTS ───────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_email VARCHAR(255) NOT NULL,
        name        VARCHAR(255) NOT NULL,
        email       VARCHAR(255) NOT NULL,
        phone       VARCHAR(50)  NULL,
        company     VARCHAR(255) NULL,
        notes       TEXT         NULL,
        favorite    TINYINT(1)   NOT NULL DEFAULT 0,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_owner_email (owner_email, email),
        INDEX idx_owner (owner_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── CALENDRIER ───────────────────────────────────────────────────────────
    // meeting_id référence meetings.id (VARCHAR(12)) quand l'événement est une
    // réunion programmée — pas de FK stricte pour rester tolérant si une
    // réunion est purgée de son côté sans casser l'affichage du calendrier.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_email      VARCHAR(255) NOT NULL,
        title            VARCHAR(255) NOT NULL,
        description      TEXT         NULL,
        location         VARCHAR(255) NULL,
        start_at         DATETIME     NOT NULL,
        end_at           DATETIME     NOT NULL,
        all_day          TINYINT(1)   NOT NULL DEFAULT 0,
        meeting_id       VARCHAR(12)  NULL,
        reminder_minutes INT          NULL DEFAULT 10,
        reminder_sent_at DATETIME     NULL,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_owner_start (owner_email, start_at),
        INDEX idx_meeting (meeting_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await columnExists(conn, 'calendar_events', 'reminder_sent_at'))) {
      await conn.execute('ALTER TABLE calendar_events ADD COLUMN reminder_sent_at DATETIME NULL AFTER reminder_minutes');
      console.log('Migration: reminder_sent_at ajoutee sur calendar_events');
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS calendar_event_attendees (
        id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_id  BIGINT UNSIGNED NOT NULL,
        email     VARCHAR(255) NOT NULL,
        status    ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_event_email (event_id, email),
        INDEX idx_event (event_id),
        CONSTRAINT fk_cea_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB contacts + calendrier initialises');

    // ── AUTHENTIFICATION À DEUX FACTEURS (TOTP) ──────────────────────────────
    // Table dédiée (pas app_users) : app_users est incomplète — un compte
    // ajouté via "Ajouter un compte" n'y a jamais de ligne, alors qu'il peut
    // tout à fait activer la 2FA.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_2fa (
        email       VARCHAR(255) NOT NULL PRIMARY KEY,
        totp_secret VARCHAR(255) NULL,
        enabled     TINYINT(1)   NOT NULL DEFAULT 0,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_2fa_backup_codes (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        code_hash  VARCHAR(255) NOT NULL,
        used_at    DATETIME     NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB 2FA initialisee');

    // ── SALLES DE SOUS-GROUPES (breakout rooms) ─────────────────────────────
    // Une salle de sous-groupe est une réunion normale, juste rattachée à une
    // réunion parente — réutilise tout le moteur mediasoup existant tel quel.
    if (!(await columnExists(conn, 'meetings', 'parent_meeting_id'))) {
      await conn.execute("ALTER TABLE meetings ADD COLUMN parent_meeting_id VARCHAR(12) NULL AFTER host");
      console.log('Migration: parent_meeting_id ajoutee sur meetings');
    }
    if (!(await columnExists(conn, 'meetings', 'breakout_label'))) {
      await conn.execute("ALTER TABLE meetings ADD COLUMN breakout_label VARCHAR(100) NULL AFTER parent_meeting_id");
      console.log('Migration: breakout_label ajoutee sur meetings');
    }
    console.log('DB breakout rooms initialisee');

    // ── JOURNAL D'ACTIVITÉ (pour le tableau de bord admin) ──────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        event      VARCHAR(64)  NOT NULL,
        ip         VARCHAR(64)  NULL,
        detail     VARCHAR(255) NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_event (event),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('DB activity_log initialisee');

    // ── ADMINISTRATION (table BDD, pas de liste en .env) ─────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        email      VARCHAR(255) NOT NULL PRIMARY KEY,
        added_by   VARCHAR(255) NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed idempotent — ne s'exécute qu'une fois grâce à INSERT IGNORE
    // (clé primaire = email). Pas besoin de lancer un script séparé.
    await conn.execute(
      `INSERT IGNORE INTO admins (email, added_by) VALUES ('godwill@netiify.cloud', 'seed'), ('admin@netiify.cloud', 'seed')`
    );

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS account_status (
        email      VARCHAR(255) NOT NULL PRIMARY KEY,
        status     ENUM('active','suspended') NOT NULL DEFAULT 'active',
        reason     VARCHAR(255) NULL,
        changed_by VARCHAR(255) NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB administration initialisee');

    // ── Quiz programmés (correctif : tables manquantes malgré le contrôleur
    //    existant — quizSetController.js les utilisait sans qu'elles soient
    //    jamais créées) ─────────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS quiz_sets (
        id          VARCHAR(24)  NOT NULL PRIMARY KEY,
        owner_email VARCHAR(255) NOT NULL,
        title       VARCHAR(255) NOT NULL DEFAULT 'Quiz',
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_owner (owner_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS quiz_set_questions (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        quiz_set_id VARCHAR(24)  NOT NULL,
        position    INT UNSIGNED NOT NULL DEFAULT 0,
        question    TEXT         NOT NULL,
        options     JSON         NOT NULL,
        correct_idx TINYINT      NOT NULL DEFAULT 0,
        points      INT          NOT NULL DEFAULT 1,
        duration    INT          NOT NULL DEFAULT 30,
        is_bingo    TINYINT(1)   NOT NULL DEFAULT 0,
        speed_bonus TINYINT(1)   NOT NULL DEFAULT 0,
        INDEX idx_set (quiz_set_id, position)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB quiz sets initialisee (correctif tables manquantes)');

    // ── Appareils connectés / blacklist ──────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_devices (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email        VARCHAR(255) NOT NULL,
        browser_id   VARCHAR(64)  NOT NULL,
        session_id   VARCHAR(128) NOT NULL,
        user_agent   VARCHAR(500) NULL,
        device_label VARCHAR(150) NULL,
        ip           VARCHAR(64)  NULL,
        trusted      TINYINT(1)   NOT NULL DEFAULT 0,
        first_seen   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at   DATETIME     NULL,
        UNIQUE KEY uniq_device (email, browser_id),
        INDEX idx_email (email, revoked_at),
        INDEX idx_browser (browser_id),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration de sécurité pour une table déjà déployée avec l'ancien schéma
    // (clé unique sur session_id au lieu de (email, browser_id) — ça créait
    // une nouvelle ligne à chaque nouvelle session au lieu de reconnaître
    // l'appareil, ce qui cassait la détection "appareil de confiance").
    try {
      await conn.execute(`ALTER TABLE user_devices DROP INDEX uniq_session`);
      console.log('Migration: ancien index uniq_session supprime');
    } catch (e) { /* déjà absent, rien à faire */ }
    try {
      await conn.execute(`ALTER TABLE user_devices ADD UNIQUE KEY uniq_device (email, browser_id)`);
      console.log('Migration: nouvel index uniq_device (email, browser_id) ajoute');
    } catch (e) {
      if (!/Duplicate key name|duplicate entry/i.test(e.message)) {
        console.warn('Migration uniq_device: ' + e.message + ' (a verifier manuellement si des doublons existent)');
      }
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS blocked_devices (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        browser_id VARCHAR(64)  NOT NULL,
        reason     VARCHAR(255) NULL,
        blocked_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_block (email, browser_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB appareils/blacklist initialisee');

    // ── ASSISTANT IA (conversations persistées, contenu chiffré au repos) ─────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id          CHAR(36)     NOT NULL PRIMARY KEY,
        owner_email VARCHAR(255) NOT NULL,
        title       VARCHAR(255) NOT NULL DEFAULT 'Nouvelle conversation',
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ai_conv_owner (owner_email, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        conversation_id CHAR(36)        NOT NULL,
        role            ENUM('user','assistant') NOT NULL,
        content         MEDIUMTEXT      NOT NULL,
        cards           MEDIUMTEXT      NULL,
        created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ai_msg_conv (conversation_id, id),
        CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_preferences (
        owner_email      VARCHAR(255) NOT NULL PRIMARY KEY,
        tone             VARCHAR(20)  NOT NULL DEFAULT 'formel',
        language         VARCHAR(5)   NOT NULL DEFAULT 'fr',
        closing          VARCHAR(255) NOT NULL DEFAULT '',
        meeting_duration SMALLINT UNSIGNED NOT NULL DEFAULT 60,
        reminder_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
        work_start       TINYINT UNSIGNED NOT NULL DEFAULT 8,
        work_end         TINYINT UNSIGNED NOT NULL DEFAULT 18,
        weekends         TINYINT(1)   NOT NULL DEFAULT 0,
        retention_days   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await columnExists(conn, 'ai_preferences', 'retention_days'))) {
      await conn.execute('ALTER TABLE ai_preferences ADD COLUMN retention_days SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER weekends');
      console.log('Migration: ai_preferences.retention_days ajoutee');
    }
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS meeting_ai_summaries (
        meeting_id  VARCHAR(64)  NOT NULL PRIMARY KEY,
        host_email  VARCHAR(255) NOT NULL,
        summary     MEDIUMTEXT   NOT NULL,
        emailed_at  DATETIME     NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mas_host (host_email, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ts         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        user_key   VARCHAR(255) NOT NULL,
        feature    VARCHAR(40)  NOT NULL,
        model      VARCHAR(120) NOT NULL DEFAULT '',
        tier       VARCHAR(8)   NOT NULL DEFAULT 'main',
        ok         TINYINT(1)   NOT NULL,
        latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
        tokens     INT UNSIGNED NULL,
        error_code VARCHAR(40)  NULL,
        INDEX idx_ai_usage_ts (ts),
        INDEX idx_ai_usage_user (user_key, ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_settings (
        setting_key VARCHAR(50)  NOT NULL PRIMARY KEY,
        value       TEXT         NOT NULL,
        updated_by  VARCHAR(255) NULL,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_audit (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ts         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        user_key   VARCHAR(255) NOT NULL,
        action     VARCHAR(40)  NOT NULL,
        detail     VARCHAR(500) NOT NULL DEFAULT '',
        INDEX idx_ai_audit_ts (ts),
        INDEX idx_ai_audit_user (user_key, ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ts         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        user_key   VARCHAR(255) NOT NULL,
        feature    VARCHAR(40)  NOT NULL,
        prompt     MEDIUMTEXT   NULL,
        response   MEDIUMTEXT   NULL,
        note       VARCHAR(500) NOT NULL DEFAULT '',
        INDEX idx_ai_feedback_ts (ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_emails (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_email VARCHAR(255) NOT NULL,
        send_at     DATETIME     NOT NULL,
        status      ENUM('pending','sending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
        attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
        creds_enc   MEDIUMTEXT   NOT NULL,
        payload_enc MEDIUMTEXT   NOT NULL,
        last_error  VARCHAR(255) NULL,
        claimed_at  DATETIME     NULL,
        finished_at DATETIME     NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sched_due (status, send_at),
        INDEX idx_sched_owner (owner_email, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('DB assistant IA initialisee');

    // Migration de sécurité : si la table user_devices existait déjà (déployée
    // avant l'ajout de la colonne "trusted"), CREATE TABLE IF NOT EXISTS ne
    // l'aurait pas ajoutée — on le fait explicitement ici.
    if (!(await columnExists(conn, 'user_devices', 'trusted'))) {
      await conn.execute(`ALTER TABLE user_devices ADD COLUMN trusted TINYINT(1) NOT NULL DEFAULT 0 AFTER ip`);
      console.log('Migration: colonne user_devices.trusted ajoutee');
    }

    // ── Connexion rapide par QR (les deux sens) ──────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS quick_connect_tokens (
        token             VARCHAR(64) NOT NULL PRIMARY KEY,
        direction         ENUM('from_authenticated','from_new_device') NOT NULL,
        email             VARCHAR(255) NULL,
        status            ENUM('pending','approved','denied','used','expired') NOT NULL DEFAULT 'pending',
        password_enc      TEXT NULL,
        origin_session_id VARCHAR(128) NULL,
        requester_ua      VARCHAR(500) NULL,
        requester_ip      VARCHAR(64)  NULL,
        approver_ua       VARCHAR(500) NULL,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at        DATETIME NOT NULL,
        INDEX idx_status (status, expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('DB connexion rapide (QR) initialisee');

    // ── Migration : chiffrement au repos des messages déjà en base ──────────
    // Idempotent — ne retraite que ce qui n'est pas encore au format "v1:"
    // (donc rapide et sans effet aux prochains redémarrages une fois fait).
    const messageCrypto = require('./messageCrypto');
    if (messageCrypto.isConfigured) {
      const encryptById = async (table, idCol, contentCol) => {
        const [rows] = await conn.execute(
          `SELECT ${idCol} AS rowId, ${contentCol} AS content FROM ${table}
           WHERE ${contentCol} IS NOT NULL AND ${contentCol} <> '' AND ${contentCol} NOT LIKE 'v1:%'`
        );
        for (const row of rows) {
          const encrypted = messageCrypto.encryptContent(row.content);
          await conn.execute(`UPDATE ${table} SET ${contentCol} = ? WHERE ${idCol} = ?`, [encrypted, row.rowId]);
        }
        if (rows.length > 0) console.log(`Migration: ${rows.length} ligne(s) chiffrees dans ${table}.${contentCol}`);
      };

      await encryptById('chat_messages', 'id', 'content');
      await encryptById('meeting_chat_messages', 'id', 'content');

      // chat_conversations a une clé composite (email, peer_email), pas d'id simple
      const [convRows] = await conn.execute(
        `SELECT email, peer_email, last_msg FROM chat_conversations
         WHERE last_msg IS NOT NULL AND last_msg <> '' AND last_msg NOT LIKE 'v1:%'`
      );
      for (const row of convRows) {
        const encrypted = messageCrypto.encryptContent(row.last_msg);
        await conn.execute(
          `UPDATE chat_conversations SET last_msg = ? WHERE email = ? AND peer_email = ?`,
          [encrypted, row.email, row.peer_email]
        );
      }
      if (convRows.length > 0) console.log(`Migration: ${convRows.length} ligne(s) chiffrees dans chat_conversations.last_msg`);

      console.log('Migration chiffrement au repos terminee');
    } else {
      console.warn('[db] CHAT_ENCRYPTION_KEY absente — migration de chiffrement des messages ignoree, tout reste en clair.');
    }
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
