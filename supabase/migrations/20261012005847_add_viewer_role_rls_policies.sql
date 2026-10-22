-- Add SELECT policies for viewer role (read-only access to all data)

-- Viewer can SELECT all cases
CREATE POLICY "viewer_select_all_cases" ON public.cases
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'viewer');

-- Viewer can SELECT all users
CREATE POLICY "viewer_select_all_users" ON public.users
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'viewer');

-- Viewer can SELECT all doctor schedules
CREATE POLICY "viewer_select_all_schedules" ON public.doctor_schedules
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'viewer');
