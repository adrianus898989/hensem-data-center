CREATE OR REPLACE FUNCTION private.withdraw_reason_parent_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(md5(p.prosrc)IN('4dcc9f7eb3d7b7501122cb39458dcc92','dc1a598304d20fff2d8db32b47709a29','ca80e97796cd780b93e77f6e5dcb02dd')
 AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proparallel='u'AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.provolatile=CASE WHEN md5(p.prosrc)='4dcc9f7eb3d7b7501122cb39458dcc92'THEN's'::"char"ELSE'v'::"char"END
 AND p.proconfig=ARRAY['search_path=""','plan_cache_mode=force_custom_plan']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND pg_get_function_arguments(p.oid)='p_request jsonb'AND pg_get_function_result(p.oid)='jsonb'
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'),false)
 FROM pg_proc p WHERE p.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
$function$

