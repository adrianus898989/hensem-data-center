-- Transitional rollout through the existing RPC. No new endpoint or grant.
-- Apply after prepared runtime installation, before deploying the v2 UI.
-- The final cutover replaces this complete main body and deletes the legacy branch.
BEGIN;SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='500ms';
DO $before$DECLARE p record;w record;d text;b text;target jsonb;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION 'withdraw_transition_owner_only';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(p.prosrc)NOT IN('12fe721956fb291f2c2b93a5d5187fbd','283677c316396e9c7b85aa21566eac1a','e84cb272d9f9a417e5106169249a7b86')OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_transition_main_drift';END IF;
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'THEN RAISE EXCEPTION 'withdraw_transition_public_drift';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='private.withdraw_prepared_cutover(text[])'::regprocedure)NOT IN('8d78d16e83578815fa707efdf6c1953a','4b0fbbe7dd50cd5679c001775dc9280c')THEN RAISE EXCEPTION 'withdraw_transition_cutover_drift';END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_release WHERE singleton AND(cutover_at IS NOT NULL OR capture_ends_at>clock_timestamp()))OR NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_transition_capture_active_or_source_changed';END IF;
 PERFORM set_config('withdraw_transition.main_metadata',(to_jsonb(p)-ARRAY['prosrc','provolatile'])::text,true);
 PERFORM set_config('withdraw_transition.public_metadata',(to_jsonb(w)-'provolatile')::text,true);
 PERFORM set_config('withdraw_transition.cutover_metadata',(SELECT(to_jsonb(x)-'prosrc')::text FROM pg_proc x WHERE oid='private.withdraw_prepared_cutover(text[])'::regprocedure),true);
 PERFORM set_config('withdraw_transition.private_others',(SELECT md5(coalesce(jsonb_agg(to_jsonb(x)ORDER BY x.oid),'[]')::text)FROM pg_proc x WHERE x.pronamespace='private'::regnamespace AND x.oid<>ALL(ARRAY['private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'private.withdraw_prepared_cutover(text[])'::regprocedure])),true);
 PERFORM set_config('withdraw_transition.public_others',(SELECT md5(coalesce(jsonb_agg(to_jsonb(x)ORDER BY x.oid),'[]')::text)FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.oid<>'public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure),true);
 SELECT to_jsonb(x)INTO target FROM private.prepared_aggregate_native_catalog()x ORDER BY(x.name='91CLUB'AND x.source='ar')DESC,x.id LIMIT 1;
 IF target IS NULL THEN RAISE EXCEPTION 'withdraw_transition_no_native_target';END IF;
 PERFORM set_config('withdraw_transition.token_target',target::text,true);
 PERFORM set_config('withdraw_transition.withdraw_token',private.withdraw_prepared_dependency(),true);
 PERFORM set_config('withdraw_transition.provider_token',private.provider_snapshot_dependency_token(target),true);
 PERFORM set_config('withdraw_transition.payment_token',private.prepared_aggregate_dependency(target),true);
 IF md5(p.prosrc)<>'e84cb272d9f9a417e5106169249a7b86'THEN
  -- Restore the exact original main/public STABLE lifecycle first, atomically.
  PERFORM private.withdraw_prepared_abort_capture();
  SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
  IF md5(p.prosrc)<>'12fe721956fb291f2c2b93a5d5187fbd'OR p.provolatile<>'s'THEN RAISE EXCEPTION 'withdraw_transition_legacy_restore_failed';END IF;
  b:=replace(p.prosrc,E'\nbegin\n if p_request is null',E'\nbegin\n -- withdraw_prepared_version_dispatch_v1: legacy and v2 each take exactly one path.\n IF p_request->''windowVersion''=''2''::jsonb THEN RETURN private.withdraw_prepared_read(p_request);END IF;\n if p_request is null');
  IF md5(b)<>'e84cb272d9f9a417e5106169249a7b86'THEN RAISE EXCEPTION 'withdraw_transition_dispatch_hash';END IF;
  d:=pg_get_functiondef(p.oid);EXECUTE replace(d,p.prosrc,b);
 END IF;
 ALTER FUNCTION private.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;
 ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;
 IF md5(p.prosrc)<>'e84cb272d9f9a417e5106169249a7b86'OR w.provolatile<>'v'THEN PERFORM pg_notify('pgrst','reload schema');END IF;
END;$before$;
CREATE OR REPLACE FUNCTION private.withdraw_prepared_cutover(p_expected_templates text[])RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $cutover$
DECLARE p record;w record;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_changed';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF(md5(p.prosrc)NOT IN('12fe721956fb291f2c2b93a5d5187fbd','e84cb272d9f9a417e5106169249a7b86')AND md5(p.prosrc)IS DISTINCT FROM(SELECT capture_hash FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL))OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_cutover_drift';END IF;
 IF p_expected_templates IS NULL OR cardinality(p_expected_templates)<2 OR(SELECT array_agg(fingerprint ORDER BY fingerprint)FROM private.withdraw_prepared_templates WHERE enabled)IS DISTINCT FROM(SELECT array_agg(DISTINCT x ORDER BY x)FROM unnest(p_expected_templates)x)THEN RAISE EXCEPTION 'withdraw_prepared_release_manifest_mismatch';END IF;
 IF (SELECT count(DISTINCT request->>'view')FROM private.withdraw_prepared_templates WHERE enabled)<2 THEN RAISE EXCEPTION 'withdraw_prepared_defaults_not_registered';END IF;
 IF EXISTS(WITH expected AS(
   SELECT jsonb_build_array('withdraw-independent-windows-v2',t.scope,t.catalog,private.withdraw_window_default_day(t.request,(clock_timestamp()AT TIME ZONE t.timezone)::date-n))k,t.catalog
   FROM private.withdraw_prepared_templates t CROSS JOIN generate_series(0,1)n WHERE t.enabled)
  SELECT 1 FROM expected e LEFT JOIN private.withdraw_prepared_jobs j ON j.fingerprint=md5(e.k::text)AND j.request_key=e.k
   LEFT JOIN private.withdraw_prepared_heads h ON h.job_id=j.id LEFT JOIN private.withdraw_prepared_artifacts a ON a.id=h.artifact_id
   WHERE j.id IS NULL OR j.status<>'ready'OR a.id IS NULL OR a.revision<>j.revision OR a.dependency<>private.withdraw_prepared_dependency()OR a.expires_at<=clock_timestamp()OR NOT private.withdraw_prepared_catalog_current(e.catalog))THEN RAISE EXCEPTION 'withdraw_prepared_not_warmed';END IF;
 EXECUTE $ddl$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $body$BEGIN RETURN private.withdraw_prepared_read(p_request);END;$body$$ddl$;
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET cutover_at=clock_timestamp(),capture_ends_at=null WHERE singleton;
 DROP FUNCTION private.withdraw_prepared_begin_capture();
 DROP FUNCTION private.withdraw_prepared_abort_capture();
 DROP FUNCTION private.withdraw_prepared_capture(jsonb);
END;$cutover$;
DO $after$DECLARE p record;w record;insertion text:=E' -- withdraw_prepared_version_dispatch_v1: legacy and v2 each take exactly one path.\n IF p_request->''windowVersion''=''2''::jsonb THEN RETURN private.withdraw_prepared_read(p_request);END IF;\n';target jsonb:=current_setting('withdraw_transition.token_target')::jsonb;BEGIN
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(p.prosrc)<>'e84cb272d9f9a417e5106169249a7b86'OR md5(replace(p.prosrc,insertion,''))<>'12fe721956fb291f2c2b93a5d5187fbd'OR p.provolatile<>'v'OR w.provolatile<>'v'
  OR(to_jsonb(p)-ARRAY['prosrc','provolatile'])IS DISTINCT FROM current_setting('withdraw_transition.main_metadata')::jsonb OR(to_jsonb(w)-'provolatile')IS DISTINCT FROM current_setting('withdraw_transition.public_metadata')::jsonb THEN RAISE EXCEPTION 'withdraw_transition_after_main_or_permissions';END IF;
 IF (SELECT md5(prosrc)FROM pg_proc WHERE oid='private.withdraw_prepared_cutover(text[])'::regprocedure)<>'4b0fbbe7dd50cd5679c001775dc9280c'OR(SELECT to_jsonb(x)-'prosrc'FROM pg_proc x WHERE oid='private.withdraw_prepared_cutover(text[])'::regprocedure)IS DISTINCT FROM current_setting('withdraw_transition.cutover_metadata')::jsonb THEN RAISE EXCEPTION 'withdraw_transition_after_cutover';END IF;
 IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(x)ORDER BY x.oid),'[]')::text)FROM pg_proc x WHERE x.pronamespace='private'::regnamespace AND x.oid<>ALL(ARRAY['private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'private.withdraw_prepared_cutover(text[])'::regprocedure]))IS DISTINCT FROM current_setting('withdraw_transition.private_others')OR(SELECT md5(coalesce(jsonb_agg(to_jsonb(x)ORDER BY x.oid),'[]')::text)FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.oid<>'public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure)IS DISTINCT FROM current_setting('withdraw_transition.public_others')THEN RAISE EXCEPTION 'withdraw_transition_unrelated_function_changed';END IF;
 IF private.withdraw_prepared_dependency()IS DISTINCT FROM current_setting('withdraw_transition.withdraw_token')OR private.provider_snapshot_dependency_token(target)IS DISTINCT FROM current_setting('withdraw_transition.provider_token')OR private.prepared_aggregate_dependency(target)IS DISTINCT FROM current_setting('withdraw_transition.payment_token')THEN RAISE EXCEPTION 'withdraw_transition_dependency_changed';END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_release WHERE singleton AND capture_ends_at IS NOT NULL)THEN RAISE EXCEPTION 'withdraw_transition_capture_not_stopped';END IF;
END;$after$;
COMMIT;
