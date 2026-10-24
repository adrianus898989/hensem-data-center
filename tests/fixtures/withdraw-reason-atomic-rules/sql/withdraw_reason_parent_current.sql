CREATE OR REPLACE FUNCTION private.withdraw_reason_parent_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(md5(p.prosrc)='4084247b43b1a5034697c028fd7c7743'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proparallel='u'AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.provolatile='v'
 AND p.proconfig=ARRAY['search_path=""','plan_cache_mode=force_custom_plan']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND pg_get_function_arguments(p.oid)='p_request jsonb'AND pg_get_function_result(p.oid)='jsonb'
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'),false)
 FROM pg_proc p WHERE p.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
$function$

