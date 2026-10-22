/*
# OnePacs Field Mapping and Auto-Sync Configuration

1. New Tables
- `onepacs_field_mapping`: stores the mapping between OnePacs record fields and local `cases` table columns.
  - `id` (int, primary key, always 1 — singleton config row)
  - `case_patient_name` (text): which OnePacs field maps to cases.patient_name
  - `case_patient_code` (text): which OnePacs field maps to cases.patient_code
  - `case_exam_type` (text): which OnePacs field maps to cases.exam_type
  - `case_exam_name` (text): which OnePacs field maps to cases.exam_name
  - `case_status` (text): which OnePacs field maps to cases.status
  - `case_priority` (text): which OnePacs field maps to cases.priority
  - `case_notes` (text): which OnePacs field maps to cases.notes
  - `case_onepacs_study_uid` (text): which OnePacs field maps to cases.onepacs_study_uid
  - `case_onepacs_link` (text): which OnePacs field maps to cases.onepacs_link
  - `auto_sync_enabled` (boolean, default false): whether to auto-sync OnePacs records to cases
  - `sync_interval_minutes` (int, default 5): how often to sync in minutes
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `onepacs_field_mapping`.
- Only authenticated users with admin role can read/write (enforced via app_metadata role check).
- Coordinator and viewer roles can read but not write.
*/

CREATE TABLE IF NOT EXISTS onepacs_field_mapping (
  id int PRIMARY KEY DEFAULT 1,
  case_patient_name text DEFAULT 'name',
  case_patient_code text DEFAULT 'patientId',
  case_exam_type text DEFAULT 'modalitiesInStudy',
  case_exam_name text DEFAULT 'studyDescription',
  case_status text DEFAULT 'status',
  case_priority text DEFAULT 'stat',
  case_notes text DEFAULT 'patientNotes',
  case_onepacs_study_uid text DEFAULT 'studyIuid',
  case_onepacs_link text DEFAULT 'studyPk',
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  sync_interval_minutes int NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE onepacs_field_mapping ENABLE ROW LEVEL SECURITY;

-- All authenticated users (admin, coordinator, viewer) can read
DROP POLICY IF EXISTS "select_field_mapping" ON onepacs_field_mapping;
CREATE POLICY "select_field_mapping" ON onepacs_field_mapping
  FOR SELECT TO authenticated USING (true);

-- Only admin can insert/update/delete
DROP POLICY IF EXISTS "admin_insert_field_mapping" ON onepacs_field_mapping;
CREATE POLICY "admin_insert_field_mapping" ON onepacs_field_mapping
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_field_mapping" ON onepacs_field_mapping;
CREATE POLICY "admin_update_field_mapping" ON onepacs_field_mapping
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin')
  );

DROP POLICY IF EXISTS "admin_delete_field_mapping" ON onepacs_field_mapping;
CREATE POLICY "admin_delete_field_mapping" ON onepacs_field_mapping
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_app_meta_data->>'role') = 'admin')
  );

-- Seed default row
INSERT INTO onepacs_field_mapping (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
