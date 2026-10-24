CREATE OR REPLACE FUNCTION private.withdraw_prepared_dependency()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH base(token)AS(-- Exact GAME66 join-only equivalence: preserve valid published results.
 -- No wildcard, fallback or exemption for unknown code/security metadata.
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN p.oid=to_regprocedure('private.withdraw_window_legacy(jsonb)') AND jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"dc68f18087ff76da7545036688a0efae","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false}'::jsonb
 AND EXISTS(SELECT 1 FROM pg_proc guard WHERE guard.oid=to_regprocedure('private.withdraw_prepared_canonical(jsonb)') AND jsonb_build_object('bodyMd5',md5(guard.prosrc),'owner',pg_get_userbyid(guard.proowner),'acl',guard.proacl::text,'config',guard.proconfig,'securityDefiner',guard.prosecdef,'volatility',guard.provolatile,'strict',guard.proisstrict,'parallel',guard.proparallel,'leakproof',guard.proleakproof,'cost',guard.procost,'rows',guard.prorows,'language',(select lanname from pg_language where oid=guard.prolang),'args',pg_get_function_arguments(guard.oid),'result',pg_get_function_result(guard.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"10d7041b097c97ef64012904d33cb627","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false}'::jsonb)
 THEN 'e70d03bdcae6260ac16a525c93629864' 
 WHEN p.oid=to_regprocedure('private.withdraw_window_secondary(jsonb,jsonb,jsonb)') AND jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb, s jsonb, c jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"bf772d6317517c293f365a77a2946b24","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb
 AND EXISTS(SELECT 1 FROM pg_proc guard WHERE guard.oid=to_regprocedure('private.withdraw_prepared_canonical(jsonb)') AND jsonb_build_object('bodyMd5',md5(guard.prosrc),'owner',pg_get_userbyid(guard.proowner),'acl',guard.proacl::text,'config',guard.proconfig,'securityDefiner',guard.prosecdef,'volatility',guard.provolatile,'strict',guard.proisstrict,'parallel',guard.proparallel,'leakproof',guard.proleakproof,'cost',guard.procost,'rows',guard.prorows,'language',(select lanname from pg_language where oid=guard.prolang),'args',pg_get_function_arguments(guard.oid),'result',pg_get_function_result(guard.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"10d7041b097c97ef64012904d33cb627","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false}'::jsonb)
 THEN 'e5a24a3bb6b9efe020a06d32f76f2975' 
 WHEN p.oid=to_regprocedure('private.withdraw_window_result(jsonb,jsonb,jsonb)') AND jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb, v jsonb, b jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"f5097173ef6236c708c1199d7507fd27","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb
 AND EXISTS(SELECT 1 FROM pg_proc guard WHERE guard.oid=to_regprocedure('private.withdraw_prepared_canonical(jsonb)') AND jsonb_build_object('bodyMd5',md5(guard.prosrc),'owner',pg_get_userbyid(guard.proowner),'acl',guard.proacl::text,'config',guard.proconfig,'securityDefiner',guard.prosecdef,'volatility',guard.provolatile,'strict',guard.proisstrict,'parallel',guard.proparallel,'leakproof',guard.proleakproof,'cost',guard.procost,'rows',guard.prorows,'language',(select lanname from pg_language where oid=guard.prolang),'args',pg_get_function_arguments(guard.oid),'result',pg_get_function_result(guard.oid))='{"acl":"{postgres=X/postgres}","args":"q jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"10d7041b097c97ef64012904d33cb627","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false}'::jsonb)
 THEN '5399e6d1730498e5ab35099ed0e369ea' 
 WHEN p.oid=to_regprocedure('private.withdraw_prepared_native_game66(date,date,text,text[],jsonb,jsonb,jsonb)')
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

