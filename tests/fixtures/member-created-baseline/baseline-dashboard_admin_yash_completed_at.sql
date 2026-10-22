CREATE OR REPLACE FUNCTION private.dashboard_admin_yash_completed_at(p_kind text, p_status text, p_created timestamp with time zone, p_completed timestamp with time zone, p_asof timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when private.dashboard_admin_yash_status(p_kind,p_status)='success'
  and isfinite(p_created) and isfinite(p_completed) and isfinite(p_asof)
  and p_completed<=p_asof then p_completed end;
$function$
