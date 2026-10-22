/*
# Restore Notification Tables and Realtime

This migration restores the notification infrastructure that was accidentally removed:
1. notification_config — VAPID keys for web push
2. push_subscriptions — per-device push subscriptions
3. notification_preferences — per-user notification toggles (with notify_status_change now defaulting to true)
4. notification_log — deduplication log for push notifications
5. Re-enables Supabase Realtime on the `cases` and `case_deletion_requests` tables
6. Sets `cases` replica identity to FULL so UPDATE/DELETE events carry full row data

## Tables Created
- notification_config (single-row, service-role only)
- push_subscriptions (user-scoped, RLS-protected)
- notification_preferences (user-scoped, RLS-protected, notify_status_change defaults to true)
- notification_log (service-role only, deduplication)

## Realtime
- Adds `cases` and `case_deletion_requests` to supabase_realtime publication
- Sets cases replica identity to FULL
*/

-- 1. notification_config (VAPID keys)
CREATE TABLE IF NOT EXISTS notification_config (
  id integer PRIMARY KEY DEFAULT 1,
  vapid_public_key text NOT NULL,
  vapid_private_key text NOT NULL,
  vapid_subject text NOT NULL DEFAULT 'mailto:admin@radiology.local',
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;

INSERT INTO notification_config (id, vapid_public_key, vapid_private_key)
VALUES (
  1,
  'BHooX6-hWC0imy8tYkPTRG5Rr0hbq1eqmvp8rXRsMll3bslJ-oud6wyRjp-4Oj4Zzi7gX5NwcsZNylwkP3TQgqY',
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgVDrVv8IQUJXBrH2L-q5JYHXB3MNIQoFd5N5X64efMdqhRANCAAR6KF-voVgtIpsvLWJD00RuUa9IW6tXqpr6fK10bDJZd27JSfqLnesMkY6fuDo-Gc4u4F-TcHLGTcpcJD900IKm'
)
ON CONFLICT (id) DO UPDATE
SET vapid_public_key = EXCLUDED.vapid_public_key,
    vapid_private_key = EXCLUDED.vapid_private_key;

-- 2. push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  expiration_time bigint,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_subs" ON push_subscriptions;
CREATE POLICY "select_own_push_subs" ON push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "insert_own_push_subs" ON push_subscriptions;
CREATE POLICY "insert_own_push_subs" ON push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "update_own_push_subs" ON push_subscriptions;
CREATE POLICY "update_own_push_subs" ON push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'))
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "delete_own_push_subs" ON push_subscriptions;
CREATE POLICY "delete_own_push_subs" ON push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

-- 3. notification_preferences (notify_status_change now defaults to true)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  notify_new_case boolean NOT NULL DEFAULT true,
  notify_reassigned boolean NOT NULL DEFAULT true,
  notify_status_change boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notif_prefs" ON notification_preferences;
CREATE POLICY "select_own_notif_prefs" ON notification_preferences
  FOR SELECT TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "insert_own_notif_prefs" ON notification_preferences;
CREATE POLICY "insert_own_notif_prefs" ON notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "update_own_notif_prefs" ON notification_preferences;
CREATE POLICY "update_own_notif_prefs" ON notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'))
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

DROP POLICY IF EXISTS "delete_own_notif_prefs" ON notification_preferences;
CREATE POLICY "delete_own_notif_prefs" ON notification_preferences
  FOR DELETE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

-- 4. notification_log (deduplication)
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  case_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('new_case', 'reassigned', 'status_change')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- 5. Re-enable realtime on cases and case_deletion_requests
DO $$
BEGIN
  -- Add cases to realtime publication if not already there
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cases'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cases;
  END IF;

  -- Add case_deletion_requests to realtime publication if not already there
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'case_deletion_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_deletion_requests;
  END IF;
END $$;

-- 6. Set cases replica identity to FULL so UPDATE/DELETE events carry full row data
ALTER TABLE public.cases REPLICA IDENTITY FULL;
