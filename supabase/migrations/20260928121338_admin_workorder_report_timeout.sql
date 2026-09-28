-- Optimized whole-month original-order reports can still exceed the API role's
-- 8-second default on a cold cache. PostgREST hoists this bounded function setting
-- for these two read-only RPCs only; roles, grants, RLS and other endpoints stay intact.
-- https://supabase.com/docs/guides/database/postgres/timeouts#function-level
begin;
alter function public.dashboard_admin_live_workorders(jsonb) set statement_timeout='30s';
alter function public.dashboard_admin_live_workorder_records(jsonb) set statement_timeout='30s';
notify pgrst,'reload schema';
commit;
