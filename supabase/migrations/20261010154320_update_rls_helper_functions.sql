/*
# Update RLS helper functions to use app_metadata from JWT

## Changes
- get_current_user_role and get_current_user_id now read from JWT app_metadata
- app_metadata is set by admin only (user-immutable), safe for authorization
- Shadow auth users store custom_user_id and role in app_metadata

## Security
- app_metadata cannot be modified by the user (unlike user_metadata)
- RLS policies remain the same, only the helper functions change
*/

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'custom_user_id')::uuid;
$$;
