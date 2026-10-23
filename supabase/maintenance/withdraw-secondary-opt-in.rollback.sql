begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $install$
declare e record;actual jsonb;before_dep text;after_dep text;before_scopes jsonb;after_scopes jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_secondary_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('withdraw_secondary_opt_in_v1',0))then raise exception'withdraw_secondary_install_busy';end if;
 for e in select key signature,value metadata from jsonb_each($expected${"private.withdraw_prepared_canonical(jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"10d7041b097c97ef64012904d33cb627","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.withdraw_window_legacy(jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"dc68f18087ff76da7545036688a0efae","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.withdraw_window_secondary(jsonb,jsonb,jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb, s jsonb, c jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"bf772d6317517c293f365a77a2946b24","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_window_result(jsonb,jsonb,jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb, v jsonb, b jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"f5097173ef6236c708c1199d7507fd27","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_dependency()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"e339a7838ee2782a91efc72d69d6eb47","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$expected$::jsonb)loop
  select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
  if actual is distinct from e.metadata then raise exception'withdraw_secondary_contract_drift:%',e.signature;end if;
 end loop;
 if private.withdraw_prepared_source_contract_current()is distinct from true then raise exception'withdraw_secondary_source_contract';end if;
 before_dep:=private.withdraw_prepared_dependency();
 select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s))into before_scopes from unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s;
 if before_dep is null or before_scopes is null or(select count(*)from jsonb_each(before_scopes))<>6 or exists(select 1 from jsonb_each(before_scopes)where value='null'::jsonb)then raise exception'withdraw_secondary_dependency_missing';end if;
 -- Reverting while false-mode generations exist would silently recompute unwanted secondary work.
 if exists(select 1 from private.withdraw_prepared_jobs where request->'includeSecondary'='false'::jsonb)
  or exists(select 1 from private.withdraw_prepared_templates where request->'includeSecondary'='false'::jsonb)
 then raise exception'withdraw_secondary_rollback_in_use';end if;
 execute $definition$
CREATE OR REPLACE FUNCTION private.withdraw_prepared_canonical(q jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE r jsonb:=q-ARRAY['offset','limit','sort','ascending','daily'];k text;
BEGIN
 IF q?'windowVersion'OR q?'successStartAt'OR q?'successEndAt'OR q?'successBasis'THEN PERFORM private.withdraw_window_validate(q);END IF;
 r:=r||jsonb_build_object('startAt',left(q->>'startAt',19)||'.000Z','endAt',left(q->>'endAt',19)||'.000Z','successStartAt',left(coalesce(q->>'successStartAt',q->>'startAt'),19)||'.000Z','successEndAt',left(coalesce(q->>'successEndAt',q->>'endAt'),19)||'.000Z','successBasis',coalesce(q->>'successBasis','success'),'windowVersion',2,'view',coalesce(q->>'view','auto'));
 PERFORM private.withdraw_window_validate(r);
 IF q?'platforms'THEN r:=jsonb_set(r,'{platforms}',coalesce((SELECT jsonb_agg(x ORDER BY x)FROM(SELECT DISTINCT value x FROM jsonb_array_elements(q->'platforms'))a),'[]'));END IF;
 IF q?'scopeTargets'THEN r:=jsonb_set(r,'{scopeTargets}',(SELECT jsonb_agg(jsonb_build_object('country',t->>'country','platforms',(SELECT jsonb_agg(v ORDER BY v)FROM(SELECT DISTINCT value v FROM jsonb_array_elements(t->'platforms'))a)) ORDER BY t->>'country')FROM jsonb_array_elements(q->'scopeTargets')t));END IF;
 RETURN r;
END;$function$
$definition$;
 execute $definition$
CREATE OR REPLACE FUNCTION private.withdraw_window_legacy(q jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT q-ARRAY['windowVersion','successStartAt','successEndAt','successBasis'];
$function$
$definition$;
 execute $definition$
CREATE OR REPLACE FUNCTION private.withdraw_window_secondary(q jsonb, s jsonb, c jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE t record;cap jsonb;rows jsonb:='[]';ops jsonb;v jsonb;a timestamptz;b timestamptz;n bigint;v_amount numeric;account_filter text:=nullif(btrim(q->>'account'),'');
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 PERFORM private.withdraw_window_validate(q);
 FOR t IN SELECT *FROM private.withdraw_window_targets(q,s,c)ORDER BY country,name,id LOOP
  cap:=private.withdraw_window_capability(t.source,q->>'successBasis');n:=null;v_amount:=null;ops:='[]';
  IF (cap->>'available')::boolean THEN
   a:=left(q->>'successStartAt',19)::timestamp AT TIME ZONE t.timezone;b:=(left(q->>'successEndAt',19)::timestamp+interval'1second')AT TIME ZONE t.timezone;
   WITH facts AS MATERIALIZED(SELECT f.account,CASE WHEN f.amount::text NOT IN('NaN','Infinity','-Infinity')THEN f.amount END amount,f.operator_available FROM private.withdraw_window_success_rows(to_jsonb(t),q->>'successBasis',a,b)f),groups AS(
    SELECT account,count(*)count,CASE WHEN count(amount)=count(*)THEN sum(amount)END amount FROM facts WHERE operator_available AND(account_filter IS NULL OR position(lower(account_filter)IN lower(account))>0)GROUP BY account)
   SELECT (SELECT count(*)FROM facts),(SELECT CASE WHEN count(amount)=count(*)THEN sum(amount)END FROM facts),coalesce(jsonb_agg(jsonb_build_object('account',account,'count',count,'amount',amount)ORDER BY account),'[]')INTO n,v_amount,ops FROM groups;
  END IF;
  v:=jsonb_build_object('platform',t.name,'country',t.country,'source',t.source,'timezone',t.timezone,'currency',t.currency,'capability',cap,'count',CASE WHEN n>0 THEN n END,'amount',v_amount,'observedCount',n,'complete',false,'coverageVerified',false,'state',CASE WHEN NOT(cap->>'available')::boolean THEN'timestamp_unavailable'WHEN n=0 THEN'no_matching_observed_records'ELSE'observed_records'END,'operatorAttributionAvailable',t.source<>'lg','operatorRows',ops);
  rows:=rows||jsonb_build_array(v);
 END LOOP;
 RETURN jsonb_build_object('basis',q->>'successBasis','startAt',q->>'successStartAt','endAt',q->>'successEndAt','createdIntersection',false,'complete',false,'rows',rows);
END;$function$
$definition$;
 execute $definition$
CREATE OR REPLACE FUNCTION private.withdraw_window_result(q jsonb, v jsonb, b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE row jsonb;outrows jsonb:='[]';p record;unsupported boolean:=false;availability jsonb:='[]';ok boolean;mask jsonb:=jsonb_build_object('total',null,'processed',null,'success',null,'rejected',null,'autoCount',null,'manualCount',null,'unclassifiedCount',null,'avgSeconds',null,'durationSampleCount',null,'durationTotalSeconds',null,'complete',false,'comparisonComparable',false,'creationTimeAvailable',false,'creationTimeReason','source_daily_report_only');
BEGIN
 FOR p IN SELECT *FROM private.withdraw_window_targets(q,b->'scope',b->'catalog')LOOP
  ok:=private.withdraw_window_whole_days(q)OR(p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10'));
  availability:=availability||jsonb_build_array(jsonb_build_object('platform',p.name,'country',p.country,'available',ok,'reason',CASE WHEN NOT ok THEN'source_daily_report_only'END));
  IF NOT ok THEN unsupported:=true;END IF;
 END LOOP;
 IF NOT private.withdraw_window_whole_days(q)THEN
  FOR row IN SELECT value FROM jsonb_array_elements(coalesce(v->'rows','[]'))LOOP
   SELECT x.*INTO p FROM private.withdraw_prepared_platforms(b->'catalog')x WHERE x.country=row->>'country'AND private.dashboard_admin_live_withdraw_key(row->>'platform')IN(private.dashboard_admin_live_withdraw_key(x.name),private.dashboard_admin_live_withdraw_key(x.source_name))LIMIT 1;
   ok:=FOUND AND p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10');
   IF NOT ok THEN unsupported:=true;row:=row||mask;IF row?'previous'THEN row:=jsonb_set(row,'{previous}',coalesce(row->'previous','{}')||mask);END IF;END IF;
   outrows:=outrows||jsonb_build_array(row);
  END LOOP;
  v:=jsonb_set(v,'{rows}',outrows);
  IF unsupported THEN v:=jsonb_set(v,'{totals}',coalesce(v->'totals','{}')||mask);v:=jsonb_set(v,'{previousTotals}',coalesce(v->'previousTotals','{}')||mask);v:=jsonb_set(v,'{comparison}',coalesce(v->'comparison','{}')||jsonb_build_object('complete',false));END IF;
 END IF;
 RETURN v||jsonb_build_object('creationAvailability',availability,'windows',jsonb_build_object('version',2,'creationStartAt',q->>'startAt','creationEndAt',q->>'endAt','successStartAt',q->>'successStartAt','successEndAt',q->>'successEndAt','successBasis',q->>'successBasis','creationMetricBasis','created_orders_current_status','successMetricBasis','independent_successful_source_orders'),'secondary',b->'secondary');
END;$function$
$definition$;
 execute $definition$
CREATE OR REPLACE FUNCTION private.withdraw_prepared_dependency()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH base(token)AS(-- Exact GAME66 join-only equivalence: preserve valid published results.
 -- No wildcard, fallback or exemption for unknown code/security metadata.
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN p.oid=to_regprocedure('private.withdraw_prepared_native_game66(date,date,text,text[],jsonb,jsonb,jsonb)')
  AND md5(p.prosrc)='405f49c10a2f7509a6f7e45b61a18a99'
  AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
  AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
  AND p.prorows=0 AND NOT p.proretset AND p.prorettype='jsonb'::regtype
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  THEN 'a946fddefe1bb3f54e9f5bacc67b8927'WHEN p.oid=to_regprocedure('private.withdraw_prepared_render(jsonb,jsonb)')
  AND md5(p.prosrc)='2d93e90122124fb0c3139800e466211e'
  AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
  AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
  AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)')
   AND md5(h.prosrc)='4bff210f543ca27aabe118d34903070d'
  AND pg_get_userbyid(h.proowner)='postgres'AND h.proacl::text='{postgres=X/postgres}'
  AND h.proconfig=ARRAY['search_path=""']AND NOT h.prosecdef AND h.provolatile='s'
  AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u'AND h.procost=100
   AND h.proretset AND h.prorows=1000 AND h.prorettype='public.newar_business_snapshots'::regtype
   AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
  THEN 'e00e877d3b41ff84de16603986a95e8b'WHEN p.oid=to_regprocedure('private.withdraw_prepared_compute(jsonb,jsonb,jsonb)')
  AND md5(p.prosrc)='a1b0abedfc7e8a2fa0cae36ce805201f'AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
  AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
  AND p.prorows=0 AND NOT p.proretset AND p.prorettype='jsonb'::regtype
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND pg_get_function_arguments(p.oid)='q jsonb, s jsonb, c jsonb'
  AND EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.withdraw_prepared_creation_reuse(jsonb,jsonb,jsonb,jsonb)')
   AND md5(h.prosrc)='8417f91074b8a9e0775b2b574a495419'AND pg_get_userbyid(h.proowner)='postgres'AND h.proacl::text='{postgres=X/postgres}'
  AND h.proconfig=ARRAY['search_path=""']AND NOT h.prosecdef AND h.provolatile='s'
  AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u'AND h.procost=100
  AND h.prorows=0 AND NOT h.proretset AND h.prorettype='jsonb'::regtype
  AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND pg_get_function_arguments(h.oid)='q jsonb, s jsonb, c jsonb, proof jsonb DEFAULT NULL::jsonb')
  THEN '69ece140fb3b13ddf34e595843e6389b'
 WHEN p.oid=to_regprocedure('private.withdraw_prepared_compute(jsonb,jsonb,jsonb)')THEN
  md5(to_jsonb(p)::text||coalesce((SELECT to_jsonb(h)::text FROM pg_proc h
   WHERE h.oid=to_regprocedure('private.withdraw_prepared_creation_reuse(jsonb,jsonb,jsonb,jsonb)')),'missing'))
 ELSE md5(p.prosrc)END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,pg_get_function_result(p.oid))ORDER BY p.proname,p.oid),'[]')::text)
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND
 (p.proname LIKE 'withdraw_window_%' OR p.proname LIKE 'withdraw_prepared_native_%' OR p.proname IN('withdraw_prepared_render','withdraw_prepared_validate','withdraw_prepared_compute','withdraw_prepared_source_contract_current','withdraw_prepared_expiry','dashboard_admin_ar_withdraw_days','dashboard_admin_newar_withdraw_days','dashboard_admin_yash_withdraw_days','dashboard_admin_duoli_withdraw_days','dashboard_admin_wg_withdraw_days','dashboard_admin_ar_historical_duration_days','dashboard_admin_live_game66_withdraw','dashboard_admin_live_withdraw_key','dashboard_scope_allows','dashboard_admin_duoli_status','dashboard_admin_duoli_amount','dashboard_admin_wg_processing_seconds','dashboard_admin_wg_sites','dashboard_admin_yash_day_evidence','dashboard_admin_yash_status','ar_historical_duration_generation','ar_withdraw_detail_evidence_generation','ar_withdraw_fact_generation')))
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_run_claimed()')
 AND md5(p.prosrc)='5ff863116cf0c759254989a01f88a356'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='v'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_complete(jsonb,jsonb)')
 AND md5(p.prosrc)='44550e473ca53a2029871acee11b6469'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='v'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='claim jsonb, payload jsonb')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_stage_plan(jsonb)')
 AND md5(p.prosrc)='c0616ac572c26b26c5d34cd2b86bbb46'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='q jsonb')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_stage_compute(jsonb,jsonb,jsonb,jsonb)')
 AND md5(p.prosrc)='e84d06520f377af5379c2ad4c0a9bc9f'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='spec jsonb, q jsonb, s jsonb, c jsonb')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_stage_assemble(uuid)')
 AND md5(p.prosrc)='2d123befa5233bddbe6718988d6a2ecb'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='s'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='p_job uuid')
 AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.withdraw_prepared_stage_run(jsonb)')
 AND md5(p.prosrc)='7924243518d895644ab5dff8bc72e7d4'
 AND pg_get_userbyid(p.proowner)='postgres'AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""']AND NOT p.prosecdef AND p.provolatile='v'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'AND p.procost=100
 AND NOT p.proretset AND p.prorows=0 AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='claim jsonb')
 THEN base.token ELSE md5(base.token||coalesce((SELECT jsonb_agg(to_jsonb(p)ORDER BY p.proname,p.oid)::text
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.proname IN('withdraw_prepared_run_claimed','withdraw_prepared_complete','withdraw_prepared_stage_plan','withdraw_prepared_stage_compute','withdraw_prepared_stage_assemble','withdraw_prepared_stage_run')),'missing'))END FROM base;
$function$
$definition$;
 for e in select key signature,value metadata from jsonb_each($installed${"private.withdraw_prepared_canonical(jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"ce0c3372519f8534cd8222a6c5d9c985","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.withdraw_window_legacy(jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"e70d03bdcae6260ac16a525c93629864","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.withdraw_window_secondary(jsonb,jsonb,jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb, s jsonb, c jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"e5a24a3bb6b9efe020a06d32f76f2975","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_window_result(jsonb,jsonb,jsonb)":{"acl":"{postgres=X/postgres}","args":"q jsonb, v jsonb, b jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5399e6d1730498e5ab35099ed0e369ea","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_dependency()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"eb081445441cf09b9abac29548ef9092","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$installed$::jsonb)loop
  select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
  if actual is distinct from e.metadata then raise exception'withdraw_secondary_installed_contract:%',e.signature;end if;
 end loop;
 after_dep:=private.withdraw_prepared_dependency();
 select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s))into after_scopes from unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s;
 if before_dep is distinct from after_dep or before_scopes is distinct from after_scopes or private.withdraw_prepared_source_contract_current()is distinct from true then raise exception'withdraw_secondary_semantics_changed';end if;
end;$install$;
commit;
