BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='500ms';
DO $last_stage1_cas$DECLARE r jsonb;p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_installer_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_reason_last_complete_claim_busy';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements('[{"signature":"private.dashboard_admin_live_withdraw_reasons(jsonb)","body":"dc1a598304d20fff2d8db32b47709a29","definition":"fcbd5a2744c7c06586bf68f50b116e76","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\"","plan_cache_mode=force_custom_plan"],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_reason_parent_current()","body":"d6c264201bb30c736568ca01c985982b","definition":"dcccff4894e58aea8e60f98316210069","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_reason_parent_current","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.dashboard_admin_live_withdraw_reasons(jsonb)","body":"def823ac54ece8b4ea74213daacabd40","definition":"c956c41ac0b0f250915237f10cd4d653","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]'::jsonb)LOOP
 SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>'signature');
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM r->>'body'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM r->>'definition'
 OR pg_get_userbyid(p.proowner)IS DISTINCT FROM r->>'owner'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r->>'language')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM r->'metadata'
 THEN RAISE EXCEPTION'withdraw_reason_last_complete_function_drift: %',r->>'signature';END IF;END LOOP;
END;$last_stage1_cas$;
DO $last_absent$BEGIN IF to_regclass('private.withdraw_prepared_reason_compat')IS NOT NULL OR to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')IS NOT NULL THEN RAISE EXCEPTION'withdraw_reason_last_complete_already_installed';END IF;END;$last_absent$;
DO $last_generations$DECLARE value text;BEGIN IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NULL OR to_regprocedure('private.ar_historical_duration_generation()')IS NULL THEN RAISE EXCEPTION'withdraw_reason_last_complete_generation_missing';END IF;IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_withdraw_fact_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_facts',coalesce(value,'<NULL>'),true);END IF;IF to_regprocedure('private.ar_historical_duration_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_historical_duration_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_history',coalesce(value,'<NULL>'),true);END IF;END;$last_generations$;
DO $last_before$DECLARE f text;s text;d text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY p.oid),'[]')::text)INTO f
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.oid<>ALL(ARRAY[coalesce(to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')::oid,0::oid)]::oid[]);
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(c.oid,to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'],
 (SELECT jsonb_agg(to_jsonb(a)ORDER BY a.attnum)FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0),
 (SELECT jsonb_agg(jsonb_build_array(t.oid,to_jsonb(t),pg_get_triggerdef(t.oid),to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY t.oid)FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 (SELECT jsonb_agg(jsonb_build_array(x.oid,to_jsonb(x),pg_get_constraintdef(x.oid))ORDER BY x.oid)FROM pg_constraint x WHERE x.conrelid=c.oid),
 (SELECT jsonb_agg(jsonb_build_array(i.indexrelid,to_jsonb(i),pg_get_indexdef(i.indexrelid))ORDER BY i.indexrelid)FROM pg_index i WHERE i.indrelid=c.oid))ORDER BY c.oid),'[]')::text)INTO s
 FROM pg_class c WHERE c.oid=ANY(ARRAY['public.ar_collected_orders','public.auto_withdraw_daily','public.newar_detail_platforms','public.newar_detail_records','private.ar_withdraw_detail_operator_evidence','private.newar_detail_coverage_runs','private.newar_withdraw_facts','private.newar_withdraw_reason_facts']::regclass[]);
 SELECT jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),
 'providerIN',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))ORDER BY n.id),'[]')::text)FROM private.prepared_aggregate_native_catalog()n WHERE n.country='印度'AND n.source IN('ar','newar')),
 'arEvidence',private.ar_withdraw_detail_evidence_generation(),
 'arFacts',(SELECT current_setting('audit.last_complete_ar_facts',true)),
 'arHistory',(SELECT current_setting('audit.last_complete_ar_history',true)))::text INTO d;
 PERFORM set_config('audit.last_complete_functions',f,true);PERFORM set_config('audit.last_complete_sources',s,true);PERFORM set_config('audit.last_complete_financial',d,true);
END;$last_before$;
create table private.withdraw_prepared_reason_compat(singleton boolean primary key default true check(singleton),old_token text not null,new_token text,enabled boolean not null default false);alter table private.withdraw_prepared_reason_compat owner to postgres;alter table private.withdraw_prepared_reason_compat enable row level security;revoke all on private.withdraw_prepared_reason_compat from public,anon,authenticated,service_role;
INSERT INTO private.withdraw_prepared_reason_compat(singleton,old_token)VALUES(true,private.withdraw_reason_dependency());
-- Owner-only immutable last-complete lookup. No financial/source kernel runs.
CREATE FUNCTION private.withdraw_prepared_reason_last_complete(p_request jsonb,p_scope jsonb,p_native jsonb,p_aliases jsonb,p_raw_only boolean,p_preparing jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE q jsonb;c jsonb;v jsonb;old_v jsonb;token text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;
 compat private.withdraw_prepared_reason_compat%rowtype;publication jsonb;error_code text;key jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_owner_only';END IF;
 SELECT *INTO compat FROM private.withdraw_prepared_reason_compat WHERE singleton;
 IF NOT FOUND OR NOT compat.enabled OR compat.new_token IS NULL THEN RETURN NULL;END IF;
 -- This is reached only after the unchanged ordinary read authorized the exact
 -- native and attempted admission. Do not reinterpret unknown/future states.
 IF p_preparing->'prepared'->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'
 OR coalesce(p_preparing->'prepared'->>'status','')NOT IN('building','failed')OR p_preparing->'available'IS DISTINCT FROM'false'::jsonb
 OR p_preparing->'rows'IS DISTINCT FROM'null'::jsonb OR p_preparing->'total'IS DISTINCT FROM'null'::jsonb OR p_preparing->'summary'IS DISTINCT FROM'null'::jsonb
 OR coalesce(p_request->>'kind','blocking')<>'blocking'OR nullif(p_request->>'category','')IS NOT NULL OR nullif(p_request->>'reasonKey','')IS NOT NULL
 OR nullif(p_request->>'operatorKey','')IS NOT NULL OR nullif(btrim(p_request->>'query'),'')IS NOT NULL
 OR coalesce(p_native->>'source','')NOT IN('ar','newar')OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))THEN RETURN NULL;END IF;
 IF private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',(p_request->>'date')::date,'kind','blocking','offset',0,'limit',500);
 IF p_preparing->'country'IS DISTINCT FROM q->'country'OR p_preparing->'platform'IS DISTINCT FROM q->'platform'OR p_preparing->'date'IS DISTINCT FROM q->'date'OR p_preparing->>'kind'IS DISTINCT FROM'blocking'THEN RETURN NULL;END IF;
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));key:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(key::text)AND request_key=key AND request=q;
 IF j.id IS NULL OR j.status NOT IN('queued','running','failed')OR j.scope->'context'IS DISTINCT FROM c OR j.catalog IS DISTINCT FROM jsonb_build_array(p_native)THEN RETURN NULL;END IF;
 -- Reuse the vector created by the ordinary read; match invokes the original
 -- ensure once and rejects poison, broken hooks, future gates or source races.
 v:=j.scope->'version';token:=private.withdraw_reason_dependency();
 IF v->'native'IS DISTINCT FROM(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)))
 OR v->'day'IS DISTINCT FROM q->'date'OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR j.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,v)::text)THEN RETURN NULL;END IF;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id AND x.job_id=j.id;
 IF a.id IS NULL OR a.revision>j.revision OR a.fence>j.fence OR a.bytes>4194304 OR a.computed_at>statement_timestamp()
 OR a.payload->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'OR a.payload->'request'IS DISTINCT FROM q OR a.payload->'context'IS DISTINCT FROM c
 OR jsonb_typeof(a.payload->'version')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'version'->'keys')IS DISTINCT FROM'array'OR jsonb_typeof(a.payload->'result'->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(a.payload->'result'->'total')IS DISTINCT FROM'number'OR coalesce(a.payload->'result'->>'total','')!~'^[0-9]+$'
 OR(a.payload->'result'->>'total')::numeric<>jsonb_array_length(a.payload->'result'->'rows')
 OR jsonb_typeof(a.payload->'result'->'summary')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'result'->'coverage')IS DISTINCT FROM'object'
 OR a.payload->'result'->'available'IS DISTINCT FROM'true'::jsonb THEN RETURN NULL;END IF;
 old_v:=a.payload->'version';
 -- Only source revisions/fingerprints may be older. Native, local date, schema,
 -- install identity, configuration and evidence semantics must still agree.
 IF old_v->'version'IS DISTINCT FROM v->'version'OR old_v->'native'IS DISTINCT FROM v->'native'OR old_v->'day'IS DISTINCT FROM v->'day'
 OR old_v->'installation'IS DISTINCT FROM v->'installation'OR old_v->'config'IS DISTINCT FROM v->'config'
 OR old_v->'evidence'->'generation'IS DISTINCT FROM v->'evidence'->'generation'
 OR(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(old_v->'keys')WITH ORDINALITY e(x,n))
 IS DISTINCT FROM(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(v->'keys')WITH ORDINALITY e(x,n))THEN RETURN NULL;END IF;
 IF a.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,old_v)::text)THEN
  -- Exact sealed compatibility is for this audited guard-only routing release.
  -- ANY later module code/metadata change invalidates the legacy allowance.
  IF compat.new_token IS NULL OR token IS DISTINCT FROM compat.new_token
  OR a.dependency IS DISTINCT FROM md5(jsonb_build_array(compat.old_token,c,old_v)::text)THEN RETURN NULL;END IF;
 END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_dependency()IS DISTINCT FROM token THEN RETURN NULL;END IF;
 publication:=jsonb_build_object('contract','withdraw-reasons-last-complete-v1','status','ready','servedLastComplete',true,'freshness','refresh_due',
  'computedAt',a.computed_at,'updatedAt',a.payload->'result'->'updatedAt','refreshState',j.status);
 error_code:=j.last_error;IF error_code~'^[a-z][a-z0-9_]{0,79}$'THEN publication:=publication||jsonb_build_object('refreshError',error_code);END IF;
 RETURN private.withdraw_reason_page(a.payload->'result',p_request)||jsonb_build_object('publication',publication);
END;$function$;
ALTER FUNCTION private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)OWNER TO postgres;
REVOKE ALL ON FUNCTION private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)FROM PUBLIC,anon,authenticated,service_role;
DO $last_stage1_after$DECLARE r jsonb;p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_installer_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_reason_last_complete_claim_busy';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements('[{"signature":"private.dashboard_admin_live_withdraw_reasons(jsonb)","body":"dc1a598304d20fff2d8db32b47709a29","definition":"fcbd5a2744c7c06586bf68f50b116e76","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\"","plan_cache_mode=force_custom_plan"],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_reason_parent_current()","body":"d6c264201bb30c736568ca01c985982b","definition":"dcccff4894e58aea8e60f98316210069","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_reason_parent_current","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.dashboard_admin_live_withdraw_reasons(jsonb)","body":"def823ac54ece8b4ea74213daacabd40","definition":"c956c41ac0b0f250915237f10cd4d653","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)","body":"711fa5703bc8b69f0f18da34c6666efb","definition":"e2441a94c890ebd285869718dabfc317","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_reason_last_complete","prorows":0,"pronargs":6,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request","p_scope","p_native","p_aliases","p_raw_only","p_preparing"],"proargtypes":["3802","3802","3802","3802","16","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]'::jsonb)LOOP
 SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>'signature');
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM r->>'body'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM r->>'definition'
 OR pg_get_userbyid(p.proowner)IS DISTINCT FROM r->>'owner'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r->>'language')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM r->'metadata'
 THEN RAISE EXCEPTION'withdraw_reason_last_complete_function_drift: %',r->>'signature';END IF;END LOOP;
END;$last_stage1_after$;
DO $last_table_guard$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='private.withdraw_prepared_reason_compat'::regclass AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE a.grantee<>c.relowner))THEN RAISE EXCEPTION'withdraw_reason_last_complete_state_permission_drift';END IF;END;$last_table_guard$;
DO $last_old_token$BEGIN IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_reason_compat WHERE singleton AND NOT enabled AND new_token IS NULL AND old_token=private.withdraw_reason_dependency())THEN RAISE EXCEPTION'withdraw_reason_last_complete_old_token_drift';END IF;END;$last_old_token$;
DO $last_generations$DECLARE value text;BEGIN IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NULL OR to_regprocedure('private.ar_historical_duration_generation()')IS NULL THEN RAISE EXCEPTION'withdraw_reason_last_complete_generation_missing';END IF;IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_withdraw_fact_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_facts',coalesce(value,'<NULL>'),true);END IF;IF to_regprocedure('private.ar_historical_duration_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_historical_duration_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_history',coalesce(value,'<NULL>'),true);END IF;END;$last_generations$;
DO $last_after$DECLARE f text;s text;d text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY p.oid),'[]')::text)INTO f
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.oid<>ALL(ARRAY[coalesce(to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')::oid,0::oid)]::oid[]);
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(c.oid,to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'],
 (SELECT jsonb_agg(to_jsonb(a)ORDER BY a.attnum)FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0),
 (SELECT jsonb_agg(jsonb_build_array(t.oid,to_jsonb(t),pg_get_triggerdef(t.oid),to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY t.oid)FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 (SELECT jsonb_agg(jsonb_build_array(x.oid,to_jsonb(x),pg_get_constraintdef(x.oid))ORDER BY x.oid)FROM pg_constraint x WHERE x.conrelid=c.oid),
 (SELECT jsonb_agg(jsonb_build_array(i.indexrelid,to_jsonb(i),pg_get_indexdef(i.indexrelid))ORDER BY i.indexrelid)FROM pg_index i WHERE i.indrelid=c.oid))ORDER BY c.oid),'[]')::text)INTO s
 FROM pg_class c WHERE c.oid=ANY(ARRAY['public.ar_collected_orders','public.auto_withdraw_daily','public.newar_detail_platforms','public.newar_detail_records','private.ar_withdraw_detail_operator_evidence','private.newar_detail_coverage_runs','private.newar_withdraw_facts','private.newar_withdraw_reason_facts']::regclass[]);
 SELECT jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),
 'providerIN',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(n),private.provider_snapshot_dependency_token(to_jsonb(n)))ORDER BY n.id),'[]')::text)FROM private.prepared_aggregate_native_catalog()n WHERE n.country='印度'AND n.source IN('ar','newar')),
 'arEvidence',private.ar_withdraw_detail_evidence_generation(),
 'arFacts',(SELECT current_setting('audit.last_complete_ar_facts',true)),
 'arHistory',(SELECT current_setting('audit.last_complete_ar_history',true)))::text INTO d;
 IF f IS DISTINCT FROM current_setting('audit.last_complete_functions')OR s IS DISTINCT FROM current_setting('audit.last_complete_sources')OR d IS DISTINCT FROM current_setting('audit.last_complete_financial')THEN RAISE EXCEPTION'withdraw_reason_last_complete_unrelated_change';END IF;
END;$last_after$;
COMMIT;
