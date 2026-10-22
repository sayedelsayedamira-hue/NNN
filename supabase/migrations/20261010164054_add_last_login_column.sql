/*
# Add last_login column to users table
## Overview
Track when a doctor last logged in for display on the schedule page.
*/
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- Allow users to see last_login
REVOKE ALL ON users FROM authenticated;
GRANT SELECT (id, name, mobile, role, specialty, technical_notes, status, created_at, last_login) ON users TO authenticated;
