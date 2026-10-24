CREATE OR REPLACE FUNCTION public.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.dashboard_lifecycle_withdraw_query(p_request)$function$
