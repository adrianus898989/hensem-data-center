CREATE OR REPLACE FUNCTION private.dashboard_withdraw_status_dependency_md5(p pg_proc)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE actual jsonb; expected jsonb; callsite text; self_hash text;
BEGIN
 IF NOT coalesce(p.oid=ANY(ARRAY[to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'),to_regprocedure('private.prepared_aggregate_dependency_common(text)'),to_regprocedure('private.provider_snapshot_dependency_token(jsonb)')]),false)THEN RETURN md5(p.prosrc);END IF;
 actual:=jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid));
 -- This AR daily reader is not a generic/prepared/provider computation consumer.
 IF p.oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)')
  AND actual='{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"43f204f10037840a839c9890d127e274","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN '173bf1a012f07d69942571724ff8f658';END IF;
 -- Normalize only one exact, pinned call-site in these two complete original bodies.
 -- Other routines, unexpected source, signature or metadata always retain actual MD5.
 SELECT value INTO expected FROM jsonb_each('{"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"36966b6e1e434eb6d5990e551f816b8e","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"ccf807a978ba7f0d3cb9f527dad6c5d4","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}'::jsonb)WHERE to_regprocedure(key)=p.oid;
 IF expected IS NULL OR (actual-'bodyMd5') IS DISTINCT FROM(expected-'bodyMd5')THEN RETURN md5(p.prosrc);END IF;
 SELECT md5(h.prosrc)INTO self_hash FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)');
 callsite:=replace($callsite$CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='__HELPER_BODY__' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END$callsite$,'__HELPER_BODY__',self_hash);
 IF self_hash IS NULL OR length(p.prosrc)-length(replace(p.prosrc,callsite,''))<>length(callsite)
  OR md5(replace(p.prosrc,callsite,'md5(p.prosrc)'))IS DISTINCT FROM expected->>'bodyMd5'
 THEN RETURN md5(p.prosrc);END IF;
 RETURN expected->>'bodyMd5';
END;$function$
