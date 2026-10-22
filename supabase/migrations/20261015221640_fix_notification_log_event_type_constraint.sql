/*
# Fix notification_log event_type constraint

The send-push edge function logs deletion_request and deletion_reviewed events,
but the CHECK constraint only allowed new_case, reassigned, status_change.
This widens the constraint to include all event types used by the edge function.
*/

DO $$
BEGIN
  -- Drop the old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_log_event_type_check'
    AND conrelid = 'notification_log'::regclass
  ) THEN
    ALTER TABLE notification_log DROP CONSTRAINT notification_log_event_type_check;
  END IF;
END $$;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_event_type_check
  CHECK (event_type IN ('new_case', 'reassigned', 'status_change', 'deletion_request', 'deletion_reviewed'));
