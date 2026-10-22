/*
# OnePacs Configuration Table

1. New Tables
- `onepacs_config` — single-row config table storing OnePacs credentials and base URL.
  - `id` (int2, primary key, always 1)
  - `base_url` (text, default https://my.onepacs.com)
  - `username` (text, not null)
  - `password` (text, not null) — stored as plain text because OnePacs requires the original password for session-based login. Only admins can read/update it.
  - `enabled` (boolean, default true)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `onepacs_config`.
- Only admin role can SELECT, INSERT, UPDATE, DELETE.
- Uses auth.jwt() -> app_metadata.role check for admin.
*/

CREATE TABLE IF NOT EXISTS onepacs_config (
  id smallint PRIMARY KEY DEFAULT 1,
  base_url text NOT NULL DEFAULT 'https://my.onepacs.com',
  username text NOT NULL,
  password text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE onepacs_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_onepacs_config" ON onepacs_config;
CREATE POLICY "admin_select_onepacs_config"
  ON onepacs_config FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "admin_insert_onepacs_config" ON onepacs_config;
CREATE POLICY "admin_insert_onepacs_config"
  ON onepacs_config FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "admin_update_onepacs_config" ON onepacs_config;
CREATE POLICY "admin_update_onepacs_config"
  ON onepacs_config FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "admin_delete_onepacs_config" ON onepacs_config;
CREATE POLICY "admin_delete_onepacs_config"
  ON onepacs_config FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
