CREATE TABLE IF NOT EXISTS thesis_summits (
  id VARCHAR(12) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  theme VARCHAR(255) NOT NULL,
  description TEXT NULL,
  principal_supervisor_email VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  status ENUM('active','paused','archived','finalized') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_principal_supervisor (principal_supervisor_email),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  participant_email VARCHAR(255) NOT NULL,
  role ENUM('maitre_memoire','etudiant','co_encadreur','observateur_jury','invite_externe') NOT NULL,
  permissions JSON NULL,
  invited_by VARCHAR(255) NOT NULL,
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_summit_participant (summit_id, participant_email),
  INDEX idx_participant_email (participant_email),
  CONSTRAINT fk_thesis_participants_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(150) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  version_note TEXT NULL,
  uploaded_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_summit_version (summit_id, version_number),
  INDEX idx_summit_versions (summit_id, created_at),
  CONSTRAINT fk_thesis_versions_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  version_id BIGINT UNSIGNED NULL,
  section_key ENUM('introduction','problematique','objectifs','hypotheses','methodologie','analyse','conclusion','bibliographie') NOT NULL,
  anchor_label VARCHAR(255) NULL,
  content TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  visibility ENUM('internal','shared') NOT NULL DEFAULT 'internal',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_summit_comments (summit_id, created_at),
  CONSTRAINT fk_thesis_comments_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE,
  CONSTRAINT fk_thesis_comments_version FOREIGN KEY (version_id) REFERENCES thesis_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  responsible_email VARCHAR(255) NULL,
  deadline DATETIME NULL,
  priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status ENUM('todo','in_progress','blocked','done') NOT NULL DEFAULT 'todo',
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_summit_tasks (summit_id, status, deadline),
  CONSTRAINT fk_thesis_tasks_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  session_at DATETIME NOT NULL,
  points_covered TEXT NULL,
  decisions TEXT NULL,
  corrections_requested TEXT NULL,
  assigned_tasks TEXT NULL,
  next_deadline DATETIME NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_summit_reports (summit_id, session_at),
  CONSTRAINT fk_thesis_reports_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_timeline_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  event_key VARCHAR(60) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_summit_timeline (summit_id, position),
  CONSTRAINT fk_thesis_timeline_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_section_status (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  section_key ENUM('introduction','problematique','objectifs','hypotheses','methodologie','analyse','conclusion','bibliographie') NOT NULL,
  status ENUM('green','orange','red') NOT NULL DEFAULT 'orange',
  note TEXT NULL,
  updated_by VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_summit_section (summit_id, section_key),
  CONSTRAINT fk_thesis_sections_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_guest_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  guest_email VARCHAR(255) NOT NULL,
  guest_name VARCHAR(255) NULL,
  role ENUM('invite_externe','observateur_jury','co_encadreur') NOT NULL DEFAULT 'invite_externe',
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  permissions_json JSON NULL,
  created_by VARCHAR(255) NOT NULL,
  status ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guest_summit (summit_id, guest_email),
  CONSTRAINT fk_thesis_guest_links_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thesis_evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summit_id VARCHAR(12) NOT NULL,
  evaluator_email VARCHAR(255) NOT NULL,
  stopwatch_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  remarks TEXT NULL,
  criteria_json JSON NULL,
  final_summary TEXT NULL,
  total_score DECIMAL(5,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_summit_evaluations (summit_id, created_at),
  CONSTRAINT fk_thesis_evaluations_summit FOREIGN KEY (summit_id) REFERENCES thesis_summits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
