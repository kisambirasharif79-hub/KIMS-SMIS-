CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  motto TEXT NOT NULL DEFAULT '',
  head_teacher TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schools_tenant_policy ON schools;
CREATE POLICY schools_tenant_policy ON schools
  USING (
    current_setting('app.is_system_owner', true) = 'true'
    OR id::text = current_setting('app.school_id', true)
  )
  WITH CHECK (
    current_setting('app.is_system_owner', true) = 'true'
    OR id::text = current_setting('app.school_id', true)
  );

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('system_owner', 'school_account', 'school_admin', 'subject_teacher', 'class_teacher')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'blocked')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((account_type = 'system_owner' AND school_id IS NULL) OR
         (account_type <> 'system_owner' AND school_id IS NOT NULL)),
  UNIQUE (id, school_id),
  FOREIGN KEY (role_id, school_id) REFERENCES roles(id, school_id)
);

CREATE INDEX IF NOT EXISTS users_school_id_idx ON users (school_id);

CREATE TABLE IF NOT EXISTS school_records (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (school_id, name),
  UNIQUE (id, school_id)
);

CREATE TABLE IF NOT EXISTS terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  UNIQUE (academic_year_id, name),
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS school_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT '',
  teacher_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id),
  FOREIGN KEY (teacher_user_id, school_id) REFERENCES users(id, school_id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id)
);

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  admission_number TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  date_of_birth DATE,
  parent_name TEXT NOT NULL DEFAULT '',
  parent_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_number),
  FOREIGN KEY (class_id, school_id) REFERENCES school_classes(id, school_id)
);

CREATE TABLE IF NOT EXISTS marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  score NUMERIC(6,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  grade TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id, term_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (term_id, school_id) REFERENCES terms(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by_user_id, school_id) REFERENCES users(id, school_id)
);

CREATE TABLE IF NOT EXISTS report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  document_url TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (term_id, school_id) REFERENCES terms(id, school_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'UGX',
  billing_period TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'UGX',
  payment_category TEXT NOT NULL DEFAULT 'subscription',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT '',
  transaction_reference TEXT,
  note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS announcement_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, display_order)
);

CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_school', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (created_by_user_id, school_id) REFERENCES users(id, school_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_school_created_idx ON audit_logs (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS students_school_class_idx ON students (school_id, class_id);
CREATE INDEX IF NOT EXISTS marks_school_term_idx ON marks (school_id, term_id);
CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements (starts_at, expires_at)
  WHERE status = 'published';

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
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

ALTER TABLE school_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_records_tenant_policy ON school_records;
CREATE POLICY school_records_tenant_policy ON school_records
  USING (
    current_setting('app.is_system_owner', true) = 'true'
    OR school_id::text = current_setting('app.school_id', true)
  )
  WITH CHECK (
    current_setting('app.is_system_owner', true) = 'true'
    OR school_id::text = current_setting('app.school_id', true)
  );

DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'roles', 'academic_years', 'terms', 'school_classes', 'subjects', 'students',
    'marks', 'report_cards', 'school_subscriptions', 'payments', 'support_tickets'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I USING (
        current_setting(''app.is_system_owner'', true) = ''true''
        OR school_id::text = current_setting(''app.school_id'', true)
      ) WITH CHECK (
        current_setting(''app.is_system_owner'', true) = ''true''
        OR school_id::text = current_setting(''app.school_id'', true)
      )',
      tenant_table
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kims_runtime') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kims_runtime';
    EXECUTE 'GRANT USAGE ON SCHEMA public TO kims_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON schools TO kims_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON users TO kims_runtime';
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON roles, role_permissions TO kims_runtime';
    EXECUTE 'GRANT SELECT ON permissions TO kims_runtime';
    EXECUTE 'GRANT SELECT, DELETE ON academic_years, terms, school_classes, subjects, students, marks, report_cards, school_subscriptions, payments, support_tickets, support_ticket_replies TO kims_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON school_records TO kims_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO kims_runtime';
    EXECUTE 'GRANT INSERT ON payments TO kims_runtime';
    EXECUTE 'GRANT INSERT ON audit_logs TO kims_runtime';
  END IF;
END $$;
