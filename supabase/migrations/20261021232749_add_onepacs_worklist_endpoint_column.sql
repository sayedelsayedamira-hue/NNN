/*
# Add worklist_endpoint column to onepacs_config

1. Modified Tables
- `onepacs_config`: add `worklist_endpoint` (text, nullable) — configurable path to the OnePacs worklist AJAX endpoint.
  Defaults to null; the edge function falls back to a sensible default if not set.

2. Security
- No changes — column inherits existing admin-only RLS policies on the table.
*/

ALTER TABLE onepacs_config ADD COLUMN IF NOT EXISTS worklist_endpoint text;
