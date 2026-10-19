BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='500ms';
DO $priority_new_cas$DECLARE p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_claim_priority_owner_only';END IF;
 -- Serialize only the existing brief claim operation; do not hold the heavy
 -- compute lock or interrupt the worker which already owns a valid lease.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_claim_priority_claim_busy';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.withdraw_prepared_claim()'::regprocedure;
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM'02c040bd8fa12439d40f1db81537ab68'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM'1ea9cd72f48234cfd1f0ffaabbb9629b'
 OR pg_get_userbyid(p.proowner)<>'postgres'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM'{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb
 THEN RAISE EXCEPTION'withdraw_claim_priority_function_drift';END IF;
END;$priority_new_cas$;
DO $priority_before$DECLARE f text;d jsonb;reason_dep text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),md5(pg_get_functiondef(p.oid)))ORDER BY p.oid),'[]')::text)INTO f FROM pg_proc p
 WHERE p.pronamespace='private'::regnamespace AND p.oid<>'private.withdraw_prepared_claim()'::regprocedure;
 PERFORM set_config('audit.withdraw_claim_priority_other_functions',f,true);
 IF to_regprocedure('private.withdraw_reason_dependency()')IS NOT NULL THEN EXECUTE'SELECT private.withdraw_reason_dependency()'INTO reason_dep;END IF;
 SELECT jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),'reason',reason_dep,
 'providerIN',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))ORDER BY n.id),'[]')::text)FROM private.prepared_aggregate_native_catalog()n WHERE n.country='印度'AND n.source IN('ar','newar')))INTO d;
 PERFORM set_config('audit.withdraw_claim_priority_dependencies',d::text,true);
END;$priority_before$;
CREATE OR REPLACE FUNCTION private.withdraw_prepared_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;started timestamptz;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error='lease_expired',not_before=clock_timestamp()+interval'1minute'WHERE status='running'AND lease_until<=clock_timestamp();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()ORDER BY not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 UPDATE private.withdraw_prepared_jobs SET status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started WHERE id=j.id RETURNING *INTO j;
 RETURN jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
END;$function$;
DO $priority_old_cas$DECLARE p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_claim_priority_owner_only';END IF;
 -- Serialize only the existing brief claim operation; do not hold the heavy
 -- compute lock or interrupt the worker which already owns a valid lease.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_claim_priority_claim_busy';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.withdraw_prepared_claim()'::regprocedure;
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM'a6bdc64a4137efd9dc613687fd17c310'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM'663b251082638a7ffe4156643ee3e433'
 OR pg_get_userbyid(p.proowner)<>'postgres'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM'{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb
 THEN RAISE EXCEPTION'withdraw_claim_priority_function_drift';END IF;
END;$priority_old_cas$;
DO $priority_after$DECLARE f text;d jsonb;reason_dep text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),md5(pg_get_functiondef(p.oid)))ORDER BY p.oid),'[]')::text)INTO f FROM pg_proc p
 WHERE p.pronamespace='private'::regnamespace AND p.oid<>'private.withdraw_prepared_claim()'::regprocedure;
 IF f IS DISTINCT FROM current_setting('audit.withdraw_claim_priority_other_functions')THEN RAISE EXCEPTION'withdraw_claim_priority_unrelated_function_changed';END IF;
 IF to_regprocedure('private.withdraw_reason_dependency()')IS NOT NULL THEN EXECUTE'SELECT private.withdraw_reason_dependency()'INTO reason_dep;END IF;
 SELECT jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),'reason',reason_dep,
 'providerIN',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))ORDER BY n.id),'[]')::text)FROM private.prepared_aggregate_native_catalog()n WHERE n.country='印度'AND n.source IN('ar','newar')))INTO d;
 IF d::text IS DISTINCT FROM current_setting('audit.withdraw_claim_priority_dependencies')THEN RAISE EXCEPTION'withdraw_claim_priority_dependency_changed';END IF;
END;$priority_after$;
COMMIT;
