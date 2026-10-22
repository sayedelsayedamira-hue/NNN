/*
# Allow coordinators to edit doctor schedules

## Overview
Coordinators need to edit schedules per the requirements. Currently only admins
can insert/update/delete doctor_schedules. This adds coordinator permissions.

## RLS Changes
- Add coordinator INSERT policy on doctor_schedules
- Add coordinator UPDATE policy on doctor_schedules
- Add coordinator DELETE policy on doctor_schedules
*/

DROP POLICY IF EXISTS "coordinators_insert_schedules" ON doctor_schedules;
CREATE POLICY "coordinators_insert_schedules"
ON doctor_schedules FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() = 'coordinator');

DROP POLICY IF EXISTS "coordinators_update_schedules" ON doctor_schedules;
CREATE POLICY "coordinators_update_schedules"
ON doctor_schedules FOR UPDATE TO authenticated
USING (public.get_current_user_role() = 'coordinator')
WITH CHECK (public.get_current_user_role() = 'coordinator');

DROP POLICY IF EXISTS "coordinators_delete_schedules" ON doctor_schedules;
CREATE POLICY "coordinators_delete_schedules"
ON doctor_schedules FOR DELETE TO authenticated
USING (public.get_current_user_role() = 'coordinator');
