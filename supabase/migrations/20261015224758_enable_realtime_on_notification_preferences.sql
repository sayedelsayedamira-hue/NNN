/*
# Enable Realtime on notification_preferences

Adds notification_preferences to the supabase_realtime publication so the frontend
can subscribe to preference changes and apply them immediately without a page reload.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notification_preferences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences;
  END IF;
END $$;
