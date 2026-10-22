-- VAPID keys config (only service role can read private key — no RLS policies for anon/authenticated)
CREATE TABLE IF NOT EXISTS notification_config (
  id integer PRIMARY KEY DEFAULT 1,
  vapid_public_key text NOT NULL,
  vapid_private_key text NOT NULL,
  vapid_subject text NOT NULL DEFAULT 'mailto:admin@radiology.local',
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies: only service role can access (bypasses RLS)

INSERT INTO notification_config (id, vapid_public_key, vapid_private_key)
VALUES (
  1,
  'BHooX6-hWC0imy8tYkPTRG5Rr0hbq1eqmvp8rXRsMll3bslJ-oud6wyRjp-4Oj4Zzi7gX5NwcsZNylwkP3TQgqY',
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgVDrVv8IQUJXBrH2L-q5JYHXB3MNIQoFd5N5X64efMdqhRANCAAR6KF-voVgtIpsvLWJD00RuUa9IW6tXqpr6fK10bDJZd27JSfqLnesMkY6fuDo-Gc4u4F-TcHLGTcpcJD900IKm'
)
ON CONFLICT (id) DO UPDATE
SET vapid_public_key = EXCLUDED.vapid_public_key,
    vapid_private_key = EXCLUDED.vapid_private_key;

-- Push subscriptions table
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

CREATE POLICY "select_own_push_subs" ON push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "insert_own_push_subs" ON push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "update_own_push_subs" ON push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'))
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "delete_own_push_subs" ON push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  notify_new_case boolean NOT NULL DEFAULT true,
  notify_reassigned boolean NOT NULL DEFAULT true,
  notify_status_change boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_notif_prefs" ON notification_preferences
  FOR SELECT TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "insert_own_notif_prefs" ON notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "update_own_notif_prefs" ON notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'))
  WITH CHECK (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

CREATE POLICY "delete_own_notif_prefs" ON notification_preferences
  FOR DELETE TO authenticated
  USING (user_id::text = (auth.jwt() -> 'app_metadata' ->> 'custom_user_id'));

-- Notification log for idempotency (prevent duplicate notifications)
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  case_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('new_case', 'reassigned', 'status_change')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Only service role accesses notification_log (no policies for anon/authenticated)