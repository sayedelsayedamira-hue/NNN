/*
# Add exam_name column and drop machine column from cases

1. Changes
- Add `exam_name` column (text, nullable) to `cases` table for storing the exam name.
- Drop `machine` column from `cases` table (no longer needed).
2. Notes
- The `machine` column is dropped because the application no longer uses it.
- The `exam_name` is optional and can be null.
*/

ALTER TABLE cases ADD COLUMN IF NOT EXISTS exam_name text;
ALTER TABLE cases DROP COLUMN IF EXISTS machine;