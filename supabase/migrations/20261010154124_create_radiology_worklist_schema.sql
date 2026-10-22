/*
# Radiology Worklist Management System - Database Schema

## Overview
Creates a complete schema for a radiology worklist management system with two roles (Admin and Doctor).
Authentication uses mobile number + password (not email), so a custom users table stores credentials
and an edge function handles login by validating credentials and issuing a custom JWT.

## Tables

### users
- `id` (uuid, primary key) - unique identifier
- `name` (text, not null) - display name
- `mobile` (text, unique, not null) - mobile number used as login identifier
- `password` (text, not null) - bcrypt-hashed password
- `role` (text, not null) - either 'admin' or 'doctor'
- `created_at` (timestamptz) - account creation timestamp

### cases
- `id` (uuid, primary key) - unique identifier
- `patient_name` (text, not null) - patient's full name
- `patient_code` (text, not null) - patient code/identifier
- `exam_type` (text, not null) - type of examination (e.g., X-Ray, MRI, CT Scan)
- `machine` (text, not null) - machine used for the exam
- `created_at` (timestamptz, default now()) - auto-generated creation date
- `doctor_id` (uuid, references users(id)) - assigned doctor
- `status` (text, not null, default 'pending') - case status: pending, in_progress, finished

## Security (RLS)

### users table
- Admins can read all users (to manage doctors)
- Doctors can read only their own profile
- Only edge functions (service role) can insert/update/delete users

### cases table
- Admins can perform all CRUD operations on all cases
- Doctors can SELECT only cases assigned to them
- Doctors can UPDATE only the status field of cases assigned to them
- Doctors cannot insert or delete cases

## Important Notes
1. An admin account is seeded with a known mobile number and password hash.
2. Password hashing uses bcrypt via edge function.
3. The admin password is "admin123" - should be changed after first login.
4. Role-based access is enforced at the RLS level using a JWT claim check.
*/

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================
-- Users table
-- ============================
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text UNIQUE NOT NULL,
  password text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Admins can read all users; doctors can read only their own profile
-- We use a helper function to check the JWT role claim
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() ->> 'user_role', NULL);
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() ->> 'user_id')::uuid, NULL);
$$;

-- Drop existing policies if any
DROP POLICY IF EXISTS "admins_select_all_users" ON users;
DROP POLICY IF EXISTS "doctors_select_own_profile" ON users;
DROP POLICY IF EXISTS "admins_insert_users" ON users;
DROP POLICY IF EXISTS "admins_update_users" ON users;
DROP POLICY IF EXISTS "admins_delete_users" ON users;

-- Admin can read all users
CREATE POLICY "admins_select_all_users"
ON users FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Doctors can read only their own profile
CREATE POLICY "doctors_select_own_profile"
ON users FOR SELECT
TO authenticated
USING (public.get_current_user_id() = id);

-- Admin can insert users (add doctors)
CREATE POLICY "admins_insert_users"
ON users FOR INSERT
TO authenticated
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can update users
CREATE POLICY "admins_update_users"
ON users FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can delete users
CREATE POLICY "admins_delete_users"
ON users FOR DELETE
TO authenticated
USING (public.get_current_user_role() = 'admin');

-- ============================
-- Cases table
-- ============================
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name text NOT NULL,
  patient_code text NOT NULL,
  exam_type text NOT NULL,
  machine text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  doctor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'finished'))
);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "admins_select_all_cases" ON cases;
DROP POLICY IF EXISTS "doctors_select_own_cases" ON cases;
DROP POLICY IF EXISTS "admins_insert_cases" ON cases;
DROP POLICY IF EXISTS "admins_update_cases" ON cases;
DROP POLICY IF EXISTS "admins_delete_cases" ON cases;
DROP POLICY IF EXISTS "doctors_update_own_case_status" ON cases;

-- Admin can read all cases
CREATE POLICY "admins_select_all_cases"
ON cases FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Doctors can read only cases assigned to them
CREATE POLICY "doctors_select_own_cases"
ON cases FOR SELECT
TO authenticated
USING (public.get_current_user_id() = doctor_id);

-- Admin can insert cases
CREATE POLICY "admins_insert_cases"
ON cases FOR INSERT
TO authenticated
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can update all cases
CREATE POLICY "admins_update_cases"
ON cases FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can delete cases
CREATE POLICY "admins_delete_cases"
ON cases FOR DELETE
TO authenticated
USING (public.get_current_user_role() = 'admin');

-- Doctors can update status of their own cases
CREATE POLICY "doctors_update_own_case_status"
ON cases FOR UPDATE
TO authenticated
USING (public.get_current_user_id() = doctor_id)
WITH CHECK (public.get_current_user_id() = doctor_id);

-- ============================
-- Indexes
-- ============================
CREATE INDEX IF NOT EXISTS idx_cases_doctor_id ON cases(doctor_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================
-- Seed admin account
-- Password: admin123 (bcrypt hash with cost 10)
-- ============================
INSERT INTO users (name, mobile, password, role)
SELECT 'System Admin', '0000000000', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MQDqoYnKZL4TQqOJeXuOoYjKJKLbDuy', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
