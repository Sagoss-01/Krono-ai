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
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
