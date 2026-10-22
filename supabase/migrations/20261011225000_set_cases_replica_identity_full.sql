-- Enable full replica identity so UPDATE events in realtime include old column values
-- (needed for detecting case reassignment from old.assigned_doctor_id)
ALTER TABLE public.cases REPLICA IDENTITY FULL;
