begin;
-- These authorization helpers expose no unauthenticated application feature.
-- Keep authenticated RLS/function callers and service jobs; close default PUBLIC execution.
revoke execute on function public.dashboard_has_permission(text),public.dashboard_third_party_sync_status(date,date) from public,anon;
grant execute on function public.dashboard_has_permission(text),public.dashboard_third_party_sync_status(date,date) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
