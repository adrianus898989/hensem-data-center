BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='500ms';
DO $last_enable_cas$DECLARE r jsonb;p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_installer_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_reason_last_complete_claim_busy';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements('[{"signature":"private.dashboard_admin_live_withdraw_reasons(jsonb)","body":"dc1a598304d20fff2d8db32b47709a29","definition":"fcbd5a2744c7c06586bf68f50b116e76","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\"","plan_cache_mode=force_custom_plan"],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_reason_parent_current()","body":"d6c264201bb30c736568ca01c985982b","definition":"dcccff4894e58aea8e60f98316210069","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_reason_parent_current","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.dashboard_admin_live_withdraw_reasons(jsonb)","body":"def823ac54ece8b4ea74213daacabd40","definition":"c956c41ac0b0f250915237f10cd4d653","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)","body":"711fa5703bc8b69f0f18da34c6666efb","definition":"e2441a94c890ebd285869718dabfc317","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_reason_last_complete","prorows":0,"pronargs":6,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request","p_scope","p_native","p_aliases","p_raw_only","p_preparing"],"proargtypes":["3802","3802","3802","3802","16","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]'::jsonb)LOOP
 SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>'signature');
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM r->>'body'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM r->>'definition'
 OR pg_get_userbyid(p.proowner)IS DISTINCT FROM r->>'owner'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r->>'language')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM r->'metadata'
 THEN RAISE EXCEPTION'withdraw_reason_last_complete_function_drift: %',r->>'signature';END IF;END LOOP;
END;$last_enable_cas$;
DO $last_table_guard$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='private.withdraw_prepared_reason_compat'::regclass AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE a.grantee<>c.relowner))THEN RAISE EXCEPTION'withdraw_reason_last_complete_state_permission_drift';END IF;END;$last_table_guard$;
DO $last_old_token$BEGIN IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_reason_compat WHERE singleton AND NOT enabled AND new_token IS NULL AND old_token=private.withdraw_reason_dependency())THEN RAISE EXCEPTION'withdraw_reason_last_complete_old_token_drift';END IF;END;$last_old_token$;
DO $last_generations$DECLARE value text;BEGIN IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NULL OR to_regprocedure('private.ar_historical_duration_generation()')IS NULL THEN RAISE EXCEPTION'withdraw_reason_last_complete_generation_missing';END IF;IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_withdraw_fact_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_facts',coalesce(value,'<NULL>'),true);END IF;IF to_regprocedure('private.ar_historical_duration_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_historical_duration_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_history',coalesce(value,'<NULL>'),true);END IF;END;$last_generations$;
DO $last_before$DECLARE f text;s text;d text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY p.oid),'[]')::text)INTO f
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.oid<>ALL(ARRAY[coalesce(to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')::oid,0::oid),coalesce(to_regprocedure('private.dashboard_admin_live_withdraw_reasons(jsonb)')::oid,0::oid),coalesce(to_regprocedure('private.withdraw_reason_parent_current()')::oid,0::oid)]::oid[]);
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
CREATE OR REPLACE FUNCTION private.withdraw_reason_parent_current()RETURNS boolean LANGUAGE sql STABLE SET search_path=''AS $function$
 SELECT coalesce(md5(p.prosrc)IN('4dcc9f7eb3d7b7501122cb39458dcc92','dc1a598304d20fff2d8db32b47709a29','ca80e97796cd780b93e77f6e5dcb02dd')
 AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proparallel='u'AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.provolatile=CASE WHEN md5(p.prosrc)='4dcc9f7eb3d7b7501122cb39458dcc92'THEN's'::"char"ELSE'v'::"char"END
 AND p.proconfig=ARRAY['search_path=""','plan_cache_mode=force_custom_plan']::text[]
 AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
 AND pg_get_function_arguments(p.oid)='p_request jsonb'AND pg_get_function_result(p.oid)='jsonb'
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'),false)
 FROM pg_proc p WHERE p.oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;v_blocking boolean;v_grouped_snapshot jsonb;v_ar_raw_only boolean;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or p_request-array['date','country','platform','kind','offset','limit','category','reasonKey','operatorKey','query']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','kind','category','reasonKey','operatorKey','query'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if coalesce(p_request->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_time';end if;
 v_date:=(p_request->>'date')::date;v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_kind:=coalesce(p_request->>'kind','blocking');v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 v_blocking:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or (v_kind in('blockingOrders','blockingVariants') and (v_reason is null or v_category is not null or v_operator is not null))
  or (v_kind='blockingVariants' and v_query is not null)
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 -- Report-only metadata is resolved by the existing freshly scoped directory.
 -- Keep native AR precedence and the source-country identity used by snapshots.
 if not found then
  select * into v_meta from private.dashboard_admin_live_withdraw_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
    or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform))
   and (v_country<>'胖虎巴西' or p.scope_group='BR_PANGHU')
   order by p.source,p.id limit 1;
 end if;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 v_ar_raw_only:=v_meta.source='ar' and v_date>=DATE '2026-10-10' and exists(
  select 1 from (values
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
  )s(code,name) where s.code=v_code and private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(v_meta.source_name));
 if not coalesce(v_ar_raw_only,false) then
 select total into v_expected from public.auto_withdraw_daily where (country=v_country or (v_country='胖虎巴西' and upper(country) in ('巴西','BR','BR_PANGHU','PANGHU BRAZIL'))) and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 end if;
 -- Default blocking lookup is entered only after the original fresh authorization/native prefix.
 v_rows:=private.withdraw_reason_read(p_request,v_scope,to_jsonb(v_meta),to_jsonb(v_aliases),v_ar_raw_only);
 if v_rows is not null then
  if v_rows->'prepared'->>'contract'='withdraw-reasons-blocking-v1'and v_rows->'prepared'->>'status'in('building','failed')then
   v_rows:=coalesce(private.withdraw_prepared_reason_last_complete(p_request,v_scope,to_jsonb(v_meta),to_jsonb(v_aliases),v_ar_raw_only,v_rows),v_rows);
  end if;
  return v_rows;
 end if;
 -- newar_received_blocking_v1: validated request and fresh scoped native metadata.
 v_rows:=private.dashboard_admin_newar_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
 if v_rows is not null then return v_rows;end if;
 -- yash_received_source_notes_v1: validated request and fresh scoped native metadata.
 if v_meta.source='kb' then
  v_rows:=private.dashboard_admin_yash_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- game66_received_source_notes_v1: request, scope and native identity were checked above.
 if v_meta.source='game66' then
  v_rows:=private.dashboard_admin_game66_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- lg_business_notes_v1: original request, authorization and native catalog checks ran above.
 if v_meta.source='lg' then
  v_rows:=private.dashboard_admin_lg_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 -- duoli_source_notes_v1: validated request, live authorization and native directory above.
 if v_meta.source='duoli' then
  v_rows:=private.duoli_withdraw_source_notes(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then
  with detail_generation as materialized (
   select CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
  ), detail_evidence as materialized (
   select e.* from private.ar_withdraw_detail_operator_evidence e cross join detail_generation g
   where e.evidence_generation=g.id AND e.source_applied_at>=v_date::timestamp AND e.source_applied_at<(v_date+1)::timestamp
  ), source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then a.order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) end amount,
    case when v_kind in('orders','blockingOrders') then a.status end status,
    CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN e.manual_submit_actor ELSE nullif(btrim(a.operator),'') END operator,
    a.operator listing_operator,CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN 'detail_manual_submit' END detail_basis,
    case when v_kind in('orders','blockingOrders') then a.applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then a.completed_at end completed_at,
    nullif(btrim(a.manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(a.remark),'') else a.remark end end rejection_raw,
    a.updated_at,
    case when v_date>=DATE '2026-10-10' and e.order_no is not null and btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' then 'manual' when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(a.operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(a.operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(a.status,''))>0 OR position('驳回' IN coalesce(a.status,''))>0 OR position('拒绝' IN coalesce(a.status,''))>0 OR position('reject' IN lower(coalesce(a.status,'')))>0 OR position('failed' IN lower(coalesce(a.status,'')))>0) AND NOT (position('已通过' IN coalesce(a.status,''))>0 OR position('已提交' IN coalesce(a.status,''))>0 OR (position('通过' IN coalesce(a.status,''))>0 AND position('未通过' IN coalesce(a.status,''))=0) OR position('success' IN lower(coalesce(a.status,'')))>0 OR position('submitted' IN lower(coalesce(a.status,'')))>0 OR position('成功' IN coalesce(a.status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when a.status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (a.status in('失败','提现失败','出款失败') and coalesce(btrim(a.raw_channel),'') in ('','人工取消')) then 'rejected' when a.status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders a left join detail_evidence e ON
    (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
   where a.source_system='AR' and a.country_code=v_code and a.platform=any(v_aliases) and a.order_kind='withdraw'
     and a.applied_at>=v_date::timestamp and a.applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_rejection_exact_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then coalesce(clean_note,'（源备注为空）') end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,o.listing_operator,o.detail_basis,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,case when v_kind in('orders','blockingOrders') then c.blocking_details end blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as not materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note,note_key
  ), category_groups as (
   select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category,category_key
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category_key)::bigint "categoryCount",count(*) filter(where not v_blocking and rejection_note is null)::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end)||CASE WHEN detail_basis IS NOT NULL THEN jsonb_build_object('listingOperator',listing_operator,'operatorClassificationBasis',detail_basis) ELSE '{}'::jsonb END,0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_rejected_or_verified_detail_manual_submit' else 'current_operator' end) else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',case when v_ar_raw_only then null else v_expected end,'complete',case when v_ar_raw_only then false else v_count=v_expected end,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;end if;
  if v_ar_raw_only then
   -- Absence of received facts is not proof of zero; do not resurrect old reports.
   return jsonb_build_object('available',false,'source','AR 已采集订单','country',v_country,'platform',v_platform,
    'date',v_date,'kind',v_kind,'rows','[]'::jsonb,'total',0,'offset',v_offset,'limit',v_limit,
    'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
    'coverage',jsonb_build_object('collected',0,'expected',null,'complete',false,'state','no_received_facts'),
    'updatedAt',null,'latestSnapshotDate',null,'snapshotFallback',false,
    'message','所选日期尚无已入库提现明细；不能认定为零笔或已完整采集');
  end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 -- Rejection snapshots retain the complete source reason_label. A semantic grouped
 -- view cannot prove which original text a caller selected.
 if v_blocking and v_snapshot.source_system='PANDA' then
  select snapshot into v_grouped_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_snapshot.country_code and platform=v_snapshot.platform and stat_date=v_date and source_system=v_snapshot.source_system
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 end if;
 if v_snapshot.platform is null or v_kind in('orders','operators','blockingOrders') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (not v_blocking and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_blocking and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
   'message',case when v_kind='blockingOrders' then '当前来源只有原因汇总，可查看全部原文及笔数；没有逐笔订单编号' when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when not v_blocking then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with source_groups as materialized (
  -- Empty categories are included only when the snapshot explicitly records a manual group.
  -- Missing groups cannot be inferred from a source total or a different operator class.
  select g,case when v_blocking and g->>'operator_class'='manual' and g->>'classification' is distinct from 'empty'
   then case when g->>'classification'='truncated' then private.dashboard_admin_live_clean_note(g->>'reason_label')
    else private.dashboard_admin_live_blocking_category(g->>'reason_label') end end raw_category
  from jsonb_array_elements(v_snapshot.snapshot->'groups')g
 ), blocking_stats as (
  select coalesce(sum((g->>'count')::bigint),0)::bigint raw,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='manual'),0)::bigint manual,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='auto'),0)::bigint system,
   coalesce(sum((g->>'count')::bigint) filter(where coalesce(g->>'operator_class','unknown') not in('manual','auto')),0)::bigint unknown
  from source_groups where g->>'classification' is distinct from 'empty' and private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]'
 ), base_original_groups as materialized (
  select case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then null
    when not v_blocking then case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end source_reason,
   case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then '检测没备注'
    when v_blocking then raw_category
    else coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end reason,
   case when not v_blocking then coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from source_groups
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'='manual') group by 1,2,3
 ), original_groups as materialized (
  select b.*,case when v_blocking then md5(reason) else private.dashboard_admin_live_rejection_exact_key(source_reason) end note_key,
   case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(source_reason) end category_key
  from base_original_groups b
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',category_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category,category_key
  union all select jsonb_build_object('reason',reason,'reasonKey',note_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason,note_key
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',note_key,
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason,note_key
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,category_key "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category,category_key)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
   ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),
    -- Reason snapshots do not prove the complete operator universe. Never infer totals from note groups.
    'operatorCounts',jsonb_build_object('total',null,'manual',null,'system',null,'unknown',null,
      'manualWithReason',(select manual from blocking_stats),'manualWithoutReason',
       (select sum((g->>'count')::bigint) from source_groups where g->>'operator_class'='manual'
        and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)))),'operatorBasis','snapshot_classification') else '{}'::jsonb end
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;
end;
$function$;
UPDATE private.withdraw_prepared_reason_compat SET new_token=private.withdraw_reason_dependency(),enabled=true WHERE singleton;
DO $last_enable_after$DECLARE r jsonb;p pg_proc%rowtype;BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_installer_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RAISE EXCEPTION'withdraw_reason_last_complete_claim_busy';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements('[{"signature":"private.dashboard_admin_live_withdraw_reasons(jsonb)","body":"ca80e97796cd780b93e77f6e5dcb02dd","definition":"bdc6b04ccb3156d561190e25279c7dbc","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\"","plan_cache_mode=force_custom_plan"],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_reason_parent_current()","body":"e14416a8be1955d4c6ef143aec73ab64","definition":"1ddd99717a94b8300bde3deac1eeaa69","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_reason_parent_current","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.dashboard_admin_live_withdraw_reasons(jsonb)","body":"def823ac54ece8b4ea74213daacabd40","definition":"c956c41ac0b0f250915237f10cd4d653","owner":"postgres","language":"sql","metadata":{"proacl":["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_withdraw_reasons","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)","body":"711fa5703bc8b69f0f18da34c6666efb","definition":"e2441a94c890ebd285869718dabfc317","owner":"postgres","language":"plpgsql","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"withdraw_prepared_reason_last_complete","prorows":0,"pronargs":6,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request","p_scope","p_native","p_aliases","p_raw_only","p_preparing"],"proargtypes":["3802","3802","3802","3802","16","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]'::jsonb)LOOP
 SELECT *INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>'signature');
 IF p.oid IS NULL OR md5(p.prosrc)IS DISTINCT FROM r->>'body'OR md5(pg_get_functiondef(p.oid))IS DISTINCT FROM r->>'definition'
 OR pg_get_userbyid(p.proowner)IS DISTINCT FROM r->>'owner'OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r->>'language')
 OR(to_jsonb(p)-ARRAY['oid','prosrc','proowner','pronamespace','prolang'])IS DISTINCT FROM r->'metadata'
 THEN RAISE EXCEPTION'withdraw_reason_last_complete_function_drift: %',r->>'signature';END IF;END LOOP;
END;$last_enable_after$;
DO $last_table_guard$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='private.withdraw_prepared_reason_compat'::regclass AND c.relowner='postgres'::regrole AND c.relkind='r'AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE a.grantee<>c.relowner))THEN RAISE EXCEPTION'withdraw_reason_last_complete_state_permission_drift';END IF;END;$last_table_guard$;
DO $last_new_token$BEGIN IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_reason_compat WHERE singleton AND enabled AND new_token=private.withdraw_reason_dependency()AND old_token IS NOT NULL)THEN RAISE EXCEPTION'withdraw_reason_last_complete_new_token_drift';END IF;END;$last_new_token$;
DO $last_generations$DECLARE value text;BEGIN IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NULL OR to_regprocedure('private.ar_historical_duration_generation()')IS NULL THEN RAISE EXCEPTION'withdraw_reason_last_complete_generation_missing';END IF;IF to_regprocedure('private.ar_withdraw_fact_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_withdraw_fact_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_facts',coalesce(value,'<NULL>'),true);END IF;IF to_regprocedure('private.ar_historical_duration_generation()')IS NOT NULL THEN EXECUTE'SELECT private.ar_historical_duration_generation()'INTO value;PERFORM set_config('audit.last_complete_ar_history',coalesce(value,'<NULL>'),true);END IF;END;$last_generations$;
DO $last_after$DECLARE f text;s text;d text;BEGIN
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,to_jsonb(p),pg_get_functiondef(p.oid))ORDER BY p.oid),'[]')::text)INTO f
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND p.oid<>ALL(ARRAY[coalesce(to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')::oid,0::oid),coalesce(to_regprocedure('private.dashboard_admin_live_withdraw_reasons(jsonb)')::oid,0::oid),coalesce(to_regprocedure('private.withdraw_reason_parent_current()')::oid,0::oid)]::oid[]);
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
