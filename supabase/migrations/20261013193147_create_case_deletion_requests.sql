/*
# Create case_deletion_requests table

1. New Tables
- `case_deletion_requests`
  - `id` (uuid, primary key)
  - `case_id` (uuid, foreign key to cases.id ON DELETE CASCADE)
  - `requested_by` (uuid, foreign key to users.id)
  - `requester_name` (text, denormalized for display)
  - `patient_name` (text, denormalized for display)
  - `patient_code` (text, denormalized for display)
  - `reason` (text, optional reason for deletion)
  - `status` (text: 'pending', 'approved', 'rejected'; default 'pending')
  - `reviewed_by` (uuid, foreign key to users.id, nullable)
  - `reviewer_name` (text, nullable, denormalized)
  - `review_note` (text, nullable)
  - `created_at` (timestamptz, default now())
  - `reviewed_at` (timestamptz, nullable)

2. Security
- Enable RLS on case_deletion_requests.
- Admins and coordinators can SELECT (see all requests).
- Coordinators can INSERT (create requests).
- Admins can UPDATE (approve/reject requests).
- No direct DELETE policy — requests are kept for audit trail.
3. Indexes
- Index on case_id for lookups.
- Index on status for filtering pending requests.
*/

CREATE TABLE IF NOT EXISTS case_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_name text NOT NULL,
  patient_name text NOT NULL,
  patient_code text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name text,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE case_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cdr_case_id ON case_deletion_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_cdr_status ON case_deletion_requests(status);

-- Helper function to get custom user id from JWT
CREATE OR REPLACE FUNCTION get_custom_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'custom_user_id')::uuid;
$$;

-- Helper function to get role from JWT
CREATE OR REPLACE FUNCTION get_jwt_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

-- SELECT: admins and coordinators can see all requests
DROP POLICY IF EXISTS "select_deletion_requests" ON case_deletion_requests;
CREATE POLICY "select_deletion_requests"
ON case_deletion_requests FOR SELECT
TO authenticated
USING (
  get_jwt_role() IN ('admin', 'coordinator')
);

-- INSERT: coordinators and admins can create requests
DROP POLICY IF EXISTS "insert_deletion_requests" ON case_deletion_requests;
CREATE POLICY "insert_deletion_requests"
ON case_deletion_requests FOR INSERT
TO authenticated
WITH CHECK (
  get_jwt_role() IN ('admin', 'coordinator')
  AND requested_by = get_custom_user_id()
);

-- UPDATE: only admins can approve/reject
DROP POLICY IF EXISTS "update_deletion_requests" ON case_deletion_requests;
CREATE POLICY "update_deletion_requests"
ON case_deletion_requests FOR UPDATE
TO authenticated
USING (get_jwt_role() = 'admin')
WITH CHECK (get_jwt_role() = 'admin');
