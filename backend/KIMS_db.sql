-- MariaDB schema for XAMPP/phpMyAdmin.
-- This creates the database and tables only; the current Node API still uses PostgreSQL.

CREATE DATABASE IF NOT EXISTS KIMS_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE KIMS_db;

CREATE TABLE IF NOT EXISTS schools (
  id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  district VARCHAR(150) NOT NULL,
  address VARCHAR(500) NOT NULL DEFAULT '',
  telephone VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  motto VARCHAR(300) NOT NULL DEFAULT '',
  head_teacher VARCHAR(200) NOT NULL DEFAULT '',
  logo_data_url LONGTEXT NOT NULL,
  account_status ENUM('active', 'suspended', 'blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY roles_school_name_uq (school_id, name),
  UNIQUE KEY roles_id_school_uq (id, school_id),
  CONSTRAINT roles_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id CHAR(36) NOT NULL,
  permission_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_id)
    REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NULL,
  role_id CHAR(36) NULL,
  full_name VARCHAR(200) NOT NULL,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  account_type ENUM('system_owner', 'school_account', 'school_admin', 'subject_teacher', 'class_teacher') NOT NULL,
  status ENUM('active', 'suspended', 'blocked') NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_uq (username),
  UNIQUE KEY users_id_school_uq (id, school_id),
  KEY users_school_id_idx (school_id),
  CONSTRAINT users_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT users_role_school_fk FOREIGN KEY (role_id, school_id)
    REFERENCES roles (id, school_id),
  CONSTRAINT users_owner_school_ck CHECK (
    (account_type = 'system_owner' AND school_id IS NULL)
    OR (account_type <> 'system_owner' AND school_id IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_records (
  school_id CHAR(36) NOT NULL,
  data JSON NOT NULL DEFAULT ('{}'),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id),
  CONSTRAINT school_records_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_years (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY academic_years_school_name_uq (school_id, name),
  UNIQUE KEY academic_years_id_school_uq (id, school_id),
  CONSTRAINT academic_years_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS terms (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  academic_year_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  PRIMARY KEY (id),
  UNIQUE KEY terms_year_name_uq (academic_year_id, name),
  UNIQUE KEY terms_id_school_uq (id, school_id),
  CONSTRAINT terms_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT terms_year_school_fk FOREIGN KEY (academic_year_id, school_id)
    REFERENCES academic_years (id, school_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_classes (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  level VARCHAR(100) NOT NULL DEFAULT '',
  teacher_user_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY school_classes_school_name_uq (school_id, name),
  UNIQUE KEY school_classes_id_school_uq (id, school_id),
  KEY school_classes_teacher_idx (teacher_user_id),
  CONSTRAINT school_classes_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT school_classes_teacher_school_fk FOREIGN KEY (teacher_user_id, school_id)
    REFERENCES users (id, school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY subjects_school_name_uq (school_id, name),
  UNIQUE KEY subjects_id_school_uq (id, school_id),
  CONSTRAINT subjects_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  class_id CHAR(36) NULL,
  first_name VARCHAR(150) NOT NULL,
  last_name VARCHAR(150) NOT NULL,
  admission_number VARCHAR(100) NOT NULL,
  gender VARCHAR(30) NOT NULL DEFAULT '',
  date_of_birth DATE NULL,
  parent_name VARCHAR(200) NOT NULL DEFAULT '',
  parent_phone VARCHAR(50) NOT NULL DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY students_school_admission_uq (school_id, admission_number),
  UNIQUE KEY students_id_school_uq (id, school_id),
  KEY students_school_class_idx (school_id, class_id),
  CONSTRAINT students_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT students_class_school_fk FOREIGN KEY (class_id, school_id)
    REFERENCES school_classes (id, school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marks (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  subject_id CHAR(36) NOT NULL,
  term_id CHAR(36) NOT NULL,
  score DECIMAL(6,2) NOT NULL,
  grade VARCHAR(20) NOT NULL DEFAULT '',
  remark VARCHAR(500) NOT NULL DEFAULT '',
  recorded_by_user_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY marks_student_subject_term_uq (student_id, subject_id, term_id),
  KEY marks_school_term_idx (school_id, term_id),
  CONSTRAINT marks_score_ck CHECK (score >= 0 AND score <= 100),
  CONSTRAINT marks_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT marks_student_school_fk FOREIGN KEY (student_id, school_id)
    REFERENCES students (id, school_id) ON DELETE CASCADE,
  CONSTRAINT marks_subject_school_fk FOREIGN KEY (subject_id, school_id)
    REFERENCES subjects (id, school_id) ON DELETE CASCADE,
  CONSTRAINT marks_term_school_fk FOREIGN KEY (term_id, school_id)
    REFERENCES terms (id, school_id) ON DELETE CASCADE,
  CONSTRAINT marks_user_school_fk FOREIGN KEY (recorded_by_user_id, school_id)
    REFERENCES users (id, school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_cards (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  academic_year_id CHAR(36) NOT NULL,
  term_id CHAR(36) NOT NULL,
  report_type VARCHAR(100) NOT NULL,
  generated_by_user_id CHAR(36) NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  document_url VARCHAR(1000) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'generated',
  PRIMARY KEY (id),
  KEY report_cards_student_idx (student_id),
  CONSTRAINT report_cards_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT report_cards_student_school_fk FOREIGN KEY (student_id, school_id)
    REFERENCES students (id, school_id) ON DELETE CASCADE,
  CONSTRAINT report_cards_year_school_fk FOREIGN KEY (academic_year_id, school_id)
    REFERENCES academic_years (id, school_id) ON DELETE CASCADE,
  CONSTRAINT report_cards_term_school_fk FOREIGN KEY (term_id, school_id)
    REFERENCES terms (id, school_id) ON DELETE CASCADE,
  CONSTRAINT report_cards_user_school_fk FOREIGN KEY (generated_by_user_id, school_id)
    REFERENCES users (id, school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id CHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UGX',
  billing_period VARCHAR(50) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_plans_name_uq (name),
  CONSTRAINT subscription_plans_price_ck CHECK (price >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  start_date DATE NOT NULL,
  expiry_date DATE NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY school_subscriptions_school_idx (school_id),
  CONSTRAINT school_subscriptions_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT school_subscriptions_plan_fk FOREIGN KEY (plan_id)
    REFERENCES subscription_plans (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UGX',
  payment_category VARCHAR(50) NOT NULL DEFAULT 'subscription',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(50) NOT NULL DEFAULT '',
  transaction_reference VARCHAR(255) NULL,
  note VARCHAR(1000) NOT NULL DEFAULT '',
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY payments_school_created_idx (school_id, created_at),
  CONSTRAINT payments_amount_ck CHECK (amount >= 0),
  CONSTRAINT payments_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcements (
  id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY announcements_active_idx (status, starts_at, expires_at),
  CONSTRAINT announcements_expiry_ck CHECK (expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT announcements_creator_fk FOREIGN KEY (created_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcement_images (
  id CHAR(36) NOT NULL,
  announcement_id CHAR(36) NOT NULL,
  storage_key VARCHAR(1000) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY announcement_images_order_uq (announcement_id, display_order),
  CONSTRAINT announcement_images_announcement_fk FOREIGN KEY (announcement_id)
    REFERENCES announcements (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  seen_at TIMESTAMP NULL,
  dismissed_at TIMESTAMP NULL,
  PRIMARY KEY (announcement_id, user_id),
  CONSTRAINT announcement_views_announcement_fk FOREIGN KEY (announcement_id)
    REFERENCES announcements (id) ON DELETE CASCADE,
  CONSTRAINT announcement_views_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_tickets (
  id CHAR(36) NOT NULL,
  school_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  description TEXT NOT NULL,
  status ENUM('open', 'in_progress', 'waiting_school', 'resolved', 'closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY support_tickets_school_created_idx (school_id, created_at),
  CONSTRAINT support_tickets_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT support_tickets_creator_school_fk FOREIGN KEY (created_by_user_id, school_id)
    REFERENCES users (id, school_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY support_ticket_replies_ticket_idx (ticket_id, created_at),
  CONSTRAINT support_ticket_replies_ticket_fk FOREIGN KEY (ticket_id)
    REFERENCES support_tickets (id) ON DELETE CASCADE,
  CONSTRAINT support_ticket_replies_sender_fk FOREIGN KEY (sender_user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  school_id CHAR(36) NULL,
  action VARCHAR(150) NOT NULL,
  target_type VARCHAR(100) NOT NULL DEFAULT '',
  target_id VARCHAR(100) NULL,
  details JSON NOT NULL DEFAULT ('{}'),
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY audit_logs_school_created_idx (school_id, created_at),
  CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_user_id)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT audit_logs_school_fk FOREIGN KEY (school_id)
    REFERENCES schools (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_sessions_token_hash_uq (token_hash),
  KEY user_sessions_user_id_idx (user_id),
  CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO permissions (id, description) VALUES
  ('register_students', 'Register students'),
  ('enroll_students', 'Enroll students'),
  ('enter_marks', 'Enter marks'),
  ('edit_marks', 'Edit marks'),
  ('view_marks', 'View marks'),
  ('manage_grading_scale', 'Manage grading scale'),
  ('print_report_cards', 'Print report cards'),
  ('generate_reports', 'Generate reports'),
  ('manage_department_logins', 'Manage department logins'),
  ('compile_marks', 'Compile marks'),
  ('upload_to_admin', 'Upload marks to school admin'),
  ('manage_staff', 'Manage staff'),
  ('manage_classes', 'Manage classes')
ON DUPLICATE KEY UPDATE description = VALUES(description);
