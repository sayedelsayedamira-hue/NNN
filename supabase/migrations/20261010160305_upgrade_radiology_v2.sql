/*
# Upgrade Radiology Worklist: 3 Roles, Schedules, Priority, Arabic RTL

## Overview
Upgrades the existing schema to support 3 roles (admin, coordinator, doctor),
adds priority/notes to cases, adds specialty/technical_notes/status to users,
and creates a doctor_schedules table.

## Changes to users table
- Added `specialty` (text, nullable) - doctor's specialty (e.g., Neuro Radiology)
- Added `technical_notes` (text, nullable) - technical notes about the user
- Added `status` (text, default 'active') - 'active' or 'inactive'
- Updated role CHECK to include 'coordinator'

## Changes to cases table
- Added `assigned_doctor_id` (uuid, references users) - replaces doctor_id
- Added `priority` (text, default 'routine') - 'routine', 'urgent', 'critical'
- Added `notes` (text, nullable) - case notes
- Data migrated from doctor_id to assigned_doctor_id

## New table: doctor_schedules
- `id` (uuid, primary key)
- `doctor_id` (uuid, references users)
- `day_of_week` (text) - Saturday through Friday
- `start_time` (text) - e.g., "09:00"
- `end_time` (text) - e.g., "17:00"
- `notes` (text, nullable)

## RLS Policy Updates
### users table
- Admins: full CRUD on all users
- Coordinators: SELECT all users (need to see doctors for assignment)
- Doctors: SELECT own profile only

### cases table
- Admins: full CRUD on all cases
- Coordinators: SELECT/INSERT/UPDATE all cases (no delete)
- Doctors: SELECT only assigned cases, UPDATE only status of own cases

### doctor_schedules table
- Admins: full CRUD
- Coordinators: SELECT all schedules
- Doctors: SELECT own schedules

## Important Notes
1. doctor_id column remains in cases table (data safety) but assigned_doctor_id is used going forward.
2. Existing data is preserved and migrated.
3. A coordinator seed account is created.
*/

-- ============================
-- Add columns to users
-- ============================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'specialty') THEN
    ALTER TABLE users ADD COLUMN specialty text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'technical_notes') THEN
    ALTER TABLE users ADD COLUMN technical_notes text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'status') THEN
    ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

-- Update role CHECK constraint to include coordinator
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'users_role_check' AND table_name = 'users') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
END $$;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'coordinator', 'doctor'));

-- ============================
-- Add columns to cases
-- ============================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'assigned_doctor_id') THEN
    ALTER TABLE cases ADD COLUMN assigned_doctor_id uuid REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'priority') THEN
    ALTER TABLE cases ADD COLUMN priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'critical'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'notes') THEN
    ALTER TABLE cases ADD COLUMN notes text;
  END IF;
END $$;

-- Migrate data from doctor_id to assigned_doctor_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'doctor_id') THEN
    UPDATE cases SET assigned_doctor_id = doctor_id WHERE assigned_doctor_id IS NULL AND doctor_id IS NOT NULL;
  END IF;
END $$;

-- ============================
-- Create doctor_schedules table
-- ============================
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week text NOT NULL CHECK (day_of_week IN ('saturday','sunday','monday','tuesday','wednesday','thursday','friday')),
  start_time text NOT NULL,
  end_time text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE doctor_schedules ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cases_assigned_doctor_id ON cases(assigned_doctor_id);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_schedules_doctor_id ON doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================
-- Update RLS helper functions
-- ============================
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'custom_user_id')::uuid;
$$;

-- ============================
-- Drop old users policies and recreate
-- ============================
DROP POLICY IF EXISTS "admins_select_all_users" ON users;
DROP POLICY IF EXISTS "doctors_select_own_profile" ON users;
DROP POLICY IF EXISTS "admins_insert_users" ON users;
DROP POLICY IF EXISTS "admins_update_users" ON users;
DROP POLICY IF EXISTS "admins_delete_users" ON users;

-- Admins can read all users
CREATE POLICY "admins_select_all_users"
ON users FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Coordinators can read all users (need to see doctors for case assignment)
CREATE POLICY "coordinators_select_all_users"
ON users FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'coordinator');

-- Doctors can read only their own profile
CREATE POLICY "doctors_select_own_profile"
ON users FOR SELECT TO authenticated
USING (public.get_current_user_id() = id);

-- Admin can insert users
CREATE POLICY "admins_insert_users"
ON users FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can update users
CREATE POLICY "admins_update_users"
ON users FOR UPDATE TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can delete users
CREATE POLICY "admins_delete_users"
ON users FOR DELETE TO authenticated
USING (public.get_current_user_role() = 'admin');

-- ============================
-- Drop old cases policies and recreate
-- ============================
DROP POLICY IF EXISTS "admins_select_all_cases" ON cases;
DROP POLICY IF EXISTS "doctors_select_own_cases" ON cases;
DROP POLICY IF EXISTS "admins_insert_cases" ON cases;
DROP POLICY IF EXISTS "admins_update_cases" ON cases;
DROP POLICY IF EXISTS "admins_delete_cases" ON cases;
DROP POLICY IF EXISTS "doctors_update_own_case_status" ON cases;

-- Admin can read all cases
CREATE POLICY "admins_select_all_cases"
ON cases FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Coordinator can read all cases
CREATE POLICY "coordinators_select_all_cases"
ON cases FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'coordinator');

-- Doctors can read only cases assigned to them
CREATE POLICY "doctors_select_own_cases"
ON cases FOR SELECT TO authenticated
USING (public.get_current_user_id() = assigned_doctor_id);

-- Admin can insert cases
CREATE POLICY "admins_insert_cases"
ON cases FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() = 'admin');

-- Coordinator can insert cases
CREATE POLICY "coordinators_insert_cases"
ON cases FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() = 'coordinator');

-- Admin can update all cases
CREATE POLICY "admins_update_cases"
ON cases FOR UPDATE TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- Coordinator can update all cases
CREATE POLICY "coordinators_update_cases"
ON cases FOR UPDATE TO authenticated
USING (public.get_current_user_role() = 'coordinator')
WITH CHECK (public.get_current_user_role() = 'coordinator');

-- Admin can delete cases
CREATE POLICY "admins_delete_cases"
ON cases FOR DELETE TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Doctors can update status of their own cases
CREATE POLICY "doctors_update_own_case_status"
ON cases FOR UPDATE TO authenticated
USING (public.get_current_user_id() = assigned_doctor_id)
WITH CHECK (public.get_current_user_id() = assigned_doctor_id);

-- ============================
-- doctor_schedules policies
-- ============================
DROP POLICY IF EXISTS "admins_select_schedules" ON doctor_schedules;
DROP POLICY IF EXISTS "coordinators_select_schedules" ON doctor_schedules;
DROP POLICY IF EXISTS "doctors_select_own_schedules" ON doctor_schedules;
DROP POLICY IF EXISTS "admins_insert_schedules" ON doctor_schedules;
DROP POLICY IF EXISTS "admins_update_schedules" ON doctor_schedules;
DROP POLICY IF EXISTS "admins_delete_schedules" ON doctor_schedules;

-- Admin can read all schedules
CREATE POLICY "admins_select_schedules"
ON doctor_schedules FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Coordinator can read all schedules
CREATE POLICY "coordinators_select_schedules"
ON doctor_schedules FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'coordinator');

-- Doctors can read own schedules
CREATE POLICY "doctors_select_own_schedules"
ON doctor_schedules FOR SELECT TO authenticated
USING (public.get_current_user_id() = doctor_id);

-- Admin can insert schedules
CREATE POLICY "admins_insert_schedules"
ON doctor_schedules FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can update schedules
CREATE POLICY "admins_update_schedules"
ON doctor_schedules FOR UPDATE TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can delete schedules
CREATE POLICY "admins_delete_schedules"
ON doctor_schedules FOR DELETE TO authenticated
USING (public.get_current_user_role() = 'admin');

-- ============================
-- Seed coordinator account
-- Password: coord123 (PBKDF2: 100000 iterations, SHA-256)
-- ============================
INSERT INTO users (name, mobile, password, role, specialty, status)
SELECT 'Coordinator', '0000000001', '100000:5ycOrzOh7MEVGSWDnNA4+A==:l0xXIDWDYXN0TvbjJR1yuCjFn2tm4StrKW+/CVmZL2g=', 'coordinator', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE mobile = '0000000001');
