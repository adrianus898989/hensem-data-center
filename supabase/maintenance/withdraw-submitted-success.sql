-- Correct only submitted/pending success counts. No source/projection/job/head writes.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $migration$
declare e record;actual jsonb;before_deps jsonb;after_deps jsonb;before_provider jsonb;after_provider jsonb;before_duration text;before_facts text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_submitted_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('withdraw_submitted_success_v1',0))then raise exception'withdraw_submitted_install_busy';end if;
 for e in select key signature,value metadata from jsonb_each($expected${"private.ar_historical_duration_generation()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"43aa54260f120584133e30a78d01e0ba","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)":{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"173bf1a012f07d69942571724ff8f658","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"36966b6e1e434eb6d5990e551f816b8e","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"ccf807a978ba7f0d3cb9f527dad6c5d4","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_dependency()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"e339a7838ee2782a91efc72d69d6eb47","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_native_ar(jsonb,jsonb,date,date,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date, p_catalog jsonb","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"eb2be91b34d27eb1b611c06a006fd058","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_source_contract_current()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"boolean","strict":false,"bodyMd5":"5f5e4ed0f515b109bcfc1883f64c82e9","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"315bcfda95d986d8ccb9d6888ae6d5b3","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'withdraw_submitted_contract_drift:%',e.signature;end if;end loop;
 if to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)')is not null then raise exception'withdraw_submitted_helper_exists';end if;
 if private.withdraw_prepared_source_contract_current()is distinct from true then raise exception'withdraw_submitted_source_contract';end if;
 before_duration:=private.ar_historical_duration_generation();before_facts:=private.ar_withdraw_fact_generation();
 if before_duration is null or before_facts is null then raise exception'withdraw_submitted_projection_proof_missing';end if;
with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency()) select jsonb_object_agg(k,v order by k)into before_deps from tokens;
 if before_deps is null or (select count(*)from jsonb_each(before_deps)where key like 'scope:%')<6 or (select count(*)from jsonb_each(before_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(before_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'withdraw_submitted_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into before_provider;
 if before_provider is null or exists(select 1 from jsonb_each(before_provider)x where x.value->>'token'is null)then raise exception'withdraw_submitted_provider_proof_missing';end if;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_withdraw_status_dependency_md5(p pg_catalog.pg_proc)
 RETURNS text LANGUAGE plpgsql STABLE SET search_path TO ''
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
END;$function$;
$definition$;
 alter function private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc) owner to postgres;
 revoke all on function private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_ar_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>61 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_ar_report_range';
 END IF;
 RETURN QUERY
 WITH supported(code,name) AS (VALUES
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
 ), targets AS MATERIALIZED (
  SELECT t->>'country' country,CASE WHEN jsonb_typeof(t->'platforms')='array'
    THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(t->'platforms')x) END platforms
  FROM jsonb_array_elements(CASE WHEN p_request?'scopeTargets' THEN p_request->'scopeTargets'
    ELSE jsonb_build_array(jsonb_build_object('country',p_request->>'country','platforms',null)) END)t
 ), requested AS (
  SELECT CASE WHEN nullif(p_request->>'platform','') IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(p_request->>'platform')]
   WHEN p_request?'platforms' AND jsonb_array_length(p_request->'platforms')>0 THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(p_request->'platforms')x) END platforms
 ), catalog AS MATERIALIZED (
  SELECT m.*,s.name canonical_name,
   ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) aliases,
   ARRAY(SELECT DISTINCT private.dashboard_admin_live_withdraw_key(x)
    FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) alias_keys
  FROM private.dashboard_admin_live_platforms()m
  JOIN supported s ON s.code=m.scope_group AND private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(m.source_name)
  WHERE m.source='ar'
 ), scopes AS MATERIALIZED (
  -- The existing catalog already checks authentication and independent grants.
  -- Keep its source name and country identity; never infer a country from a label.
  SELECT DISTINCT ON(m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name))
   m.scope_group code,m.country,m.name platform,private.dashboard_admin_live_withdraw_key(m.source_name) platform_key,
   m.aliases,m.alias_keys
  FROM catalog m
  JOIN targets t ON t.country=m.country AND (t.platforms IS NULL OR m.alias_keys&&t.platforms)
  CROSS JOIN requested r
  WHERE (r.platforms IS NULL OR m.alias_keys&&r.platforms)
   AND private.dashboard_scope_allows(p_scope,m.country,m.name)
  ORDER BY m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name),m.name,m.source_name
 ), generation AS MATERIALIZED (
  SELECT private.ar_withdraw_fact_generation() id
 ), partitions AS MATERIALIZED (
  SELECT s.*,n.native_alias,dt.d::date data_date,
   (s.code='IN' AND g.id IS NOT NULL AND
    (EXISTS(SELECT 1 FROM private.ar_withdraw_fact_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND r.data_date=dt.d::date AND r.generation=g.id)
     OR EXISTS(SELECT 1 FROM private.ar_withdraw_fact_future_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND dt.d::date>=r.future_from AND r.generation=g.id))) projected
  FROM scopes s CROSS JOIN LATERAL unnest(s.aliases)n(native_alias)
   CROSS JOIN (SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt CROSS JOIN generation g
 ), detail_generation AS MATERIALIZED (
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
 ), detail_evidence AS MATERIALIZED (
  SELECT e.* FROM private.ar_withdraw_detail_operator_evidence e CROSS JOIN detail_generation g
  WHERE e.evidence_generation=g.id AND e.source_applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp AND e.source_applied_at<(p_end+1)::timestamp
 ), raw_facts AS NOT MATERIALIZED (
  SELECT q.country,q.platform,q.platform_key,a.applied_at::date data_date,
   coalesce(a.status,'') status,
   -- Explicit Python str.strip whitespace set; POSIX space depends on DB locale.
   CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN coalesce(e.manual_submit_actor,'') ELSE btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') END account,
   CASE WHEN a.completed_at>a.applied_at THEN trunc(extract(epoch FROM a.completed_at-a.applied_at)) END seconds,
   a.observed_at,a.updated_at,(e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='') detail_manual
  FROM partitions q CROSS JOIN LATERAL (
   SELECT a.* FROM public.ar_collected_orders a
   WHERE NOT q.projected AND a.source_system='AR' AND a.country_code=q.code
    AND a.platform=q.native_alias AND a.order_kind='withdraw'
    AND a.applied_at>=TIMESTAMP '2026-10-10'
    AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   OFFSET 0
  ) a LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
 ), classified AS NOT MATERIALIZED (
  SELECT f.*,
   (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
    OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
    OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) is_success,
   (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
    OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) is_rejected,
   CASE WHEN f.detail_manual THEN 'manual' WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN
    CASE WHEN (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0 OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) AND NOT (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0 OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0) OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) THEN 'manual' ELSE 'unknown' END
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM raw_facts f

  UNION ALL
  SELECT q.country,q.platform,q.platform_key,q.data_date,f.status,CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN coalesce(e.manual_submit_actor,'') ELSE f.account END,f.seconds,f.observed_at,f.updated_at,(e.order_no IS NOT NULL AND f.account=''),f.is_success,f.is_rejected,
   CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN 'manual' WHEN f.method='unknown' AND f.is_rejected AND NOT f.is_success THEN 'manual' ELSE f.method END
  FROM partitions q CROSS JOIN LATERAL (
   SELECT f.* FROM private.ar_withdraw_facts f
   WHERE q.projected AND f.country_code=q.code AND f.platform=q.native_alias
    AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
    AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
    AND f.applied_at<(p_end+1)::timestamp
   OFFSET 0
  ) f LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at)
 ), classified_operator AS MATERIALIZED (
  -- Auto consumes only daily totals. Operators reuse one full fact stream.
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')='operators'
 ), classified_input AS NOT MATERIALIZED (
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')<>'operators'
  UNION ALL
  SELECT * FROM classified_operator
 ), days AS (
  SELECT f.data_date,f.country,f.platform,f.platform_key,count(*)::bigint total,
   count(*) FILTER(WHERE f.is_success AND lower(btrim(f.status)) NOT IN ('已提交','submitted'))::bigint success,
   count(*) FILTER(WHERE NOT f.is_success AND f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE f.method='auto')::bigint auto_count,count(*) FILTER(WHERE f.method='manual')::bigint manual_count,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified_input f GROUP BY f.data_date,f.country,f.platform,f.platform_key
 ), operators AS MATERIALIZED (
  SELECT f.data_date,f.country,f.platform_key,f.account,count(*)::bigint processed,
   count(*) FILTER(WHERE f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE NOT f.is_rejected AND lower(btrim(f.status)) NOT IN ('已提交','submitted'))::bigint success,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified_input f WHERE f.method='manual' AND coalesce(p_request->>'view','auto')='operators'
  GROUP BY f.data_date,f.country,f.platform_key,f.account
 ), operator_days AS MATERIALIZED (
  SELECT o.data_date,o.country,o.platform_key,
   jsonb_agg(to_jsonb(o)-ARRAY['data_date','country','platform_key'] ORDER BY o.account) operator_rows
  FROM operators o GROUP BY o.data_date,o.country,o.platform_key
 )
 SELECT dt.d::date,s.country,s.platform,s.platform_key,d.total,d.success,d.rejected,d.auto_count,d.manual_count,
  d.avg_seconds,d.duration_sample_count,d.duration_total_seconds,d.source_updated_at,d.updated_at,false,
 coalesce(op.operator_rows,'[]'::jsonb),s.alias_keys
 FROM scopes s CROSS JOIN (SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt
 LEFT JOIN days d ON d.data_date=dt.d::date AND d.country=s.country AND d.platform_key=s.platform_key
 LEFT JOIN operator_days op ON op.data_date=dt.d::date AND op.country=s.country AND op.platform_key=s.platform_key;
END;
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.withdraw_prepared_native_ar(p_request jsonb, p_scope jsonb, p_start date, p_end date, p_catalog jsonb)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>61 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_ar_report_range';
 END IF;
 RETURN QUERY
 WITH supported(code,name) AS (VALUES
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
 ), targets AS MATERIALIZED (
  SELECT t->>'country' country,CASE WHEN jsonb_typeof(t->'platforms')='array'
    THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(t->'platforms')x) END platforms
  FROM jsonb_array_elements(CASE WHEN p_request?'scopeTargets' THEN p_request->'scopeTargets'
    ELSE jsonb_build_array(jsonb_build_object('country',p_request->>'country','platforms',null)) END)t
 ), requested AS (
  SELECT CASE WHEN nullif(p_request->>'platform','') IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(p_request->>'platform')]
   WHEN p_request?'platforms' AND jsonb_array_length(p_request->'platforms')>0 THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(p_request->'platforms')x) END platforms
 ), catalog AS MATERIALIZED (
  SELECT m.*,s.name canonical_name,
   ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) aliases,
   ARRAY(SELECT DISTINCT private.dashboard_admin_live_withdraw_key(x)
    FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) alias_keys
  FROM private.withdraw_prepared_platforms(p_catalog)m
  JOIN supported s ON s.code=m.scope_group AND private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(m.source_name)
  WHERE m.source='ar'
 ), scopes AS MATERIALIZED (
  -- The existing catalog already checks authentication and independent grants.
  -- Keep its source name and country identity; never infer a country from a label.
  SELECT DISTINCT ON(m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name))
   m.scope_group code,m.country,m.name platform,private.dashboard_admin_live_withdraw_key(m.source_name) platform_key,
   m.aliases,m.alias_keys
  FROM catalog m
  JOIN targets t ON t.country=m.country AND (t.platforms IS NULL OR m.alias_keys&&t.platforms)
  CROSS JOIN requested r
  WHERE (r.platforms IS NULL OR m.alias_keys&&r.platforms)
   AND private.dashboard_scope_allows(p_scope,m.country,m.name)
  ORDER BY m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name),m.name,m.source_name
 ), generation AS MATERIALIZED (
  SELECT private.ar_withdraw_fact_generation() id
 ), partitions AS MATERIALIZED (
  SELECT s.*,n.native_alias,dt.d::date data_date,
   (s.code='IN' AND g.id IS NOT NULL AND
    (EXISTS(SELECT 1 FROM private.ar_withdraw_fact_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND r.data_date=dt.d::date AND r.generation=g.id)
     OR EXISTS(SELECT 1 FROM private.ar_withdraw_fact_future_ready r WHERE r.country_code='IN' AND r.platform=n.native_alias AND dt.d::date>=r.future_from AND r.generation=g.id))) projected
  FROM scopes s CROSS JOIN LATERAL unnest(s.aliases)n(native_alias)
   CROSS JOIN (SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt CROSS JOIN generation g
 ), detail_generation AS MATERIALIZED (
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
 ), detail_evidence AS MATERIALIZED (
  SELECT e.* FROM private.ar_withdraw_detail_operator_evidence e CROSS JOIN detail_generation g
  WHERE e.evidence_generation=g.id AND e.source_applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp AND e.source_applied_at<(p_end+1)::timestamp
 ), raw_facts AS NOT MATERIALIZED (
  SELECT q.country,q.platform,q.platform_key,a.applied_at::date data_date,
   coalesce(a.status,'') status,
   -- Explicit Python str.strip whitespace set; POSIX space depends on DB locale.
   CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN coalesce(e.manual_submit_actor,'') ELSE btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') END account,
   CASE WHEN a.completed_at>a.applied_at THEN trunc(extract(epoch FROM a.completed_at-a.applied_at)) END seconds,
   a.observed_at,a.updated_at,(e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='') detail_manual
  FROM partitions q CROSS JOIN LATERAL (
   SELECT a.* FROM public.ar_collected_orders a
   WHERE NOT q.projected AND a.source_system='AR' AND a.country_code=q.code
    AND a.platform=q.native_alias AND a.order_kind='withdraw'
    AND a.applied_at>=TIMESTAMP '2026-10-10'
    AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp AND (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created_local(p_request,a.applied_at))
   OFFSET 0
  ) a LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
 ), classified AS NOT MATERIALIZED (
  SELECT f.*,
   (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
    OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
    OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) is_success,
   (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
    OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) is_rejected,
   CASE WHEN f.detail_manual THEN 'manual' WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN
    CASE WHEN (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0 OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) AND NOT (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0 OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0) OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) THEN 'manual' ELSE 'unknown' END
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM raw_facts f

  UNION ALL
  SELECT q.country,q.platform,q.platform_key,q.data_date,f.status,CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN coalesce(e.manual_submit_actor,'') ELSE f.account END,f.seconds,f.observed_at,f.updated_at,(e.order_no IS NOT NULL AND f.account=''),f.is_success,f.is_rejected,
   CASE WHEN f.account='' AND e.order_no IS NOT NULL THEN 'manual' WHEN f.method='unknown' AND f.is_rejected AND NOT f.is_success THEN 'manual' ELSE f.method END
  FROM partitions q CROSS JOIN LATERAL (
   SELECT f.* FROM private.ar_withdraw_facts f
   WHERE q.projected AND f.country_code=q.code AND f.platform=q.native_alias
    AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp AND (private.withdraw_window_whole_days(p_request) OR private.withdraw_window_created_local(p_request,f.applied_at))
    AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
    AND f.applied_at<(p_end+1)::timestamp
   OFFSET 0
  ) f LEFT JOIN detail_evidence e ON (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=
   (f.source_system,f.country_code,f.platform,f.order_kind,f.order_no,f.applied_at)
 ), classified_operator AS MATERIALIZED (
  -- Auto consumes only daily totals. Operators reuse one full fact stream.
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')='operators'
 ), classified_input AS NOT MATERIALIZED (
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')<>'operators'
  UNION ALL
  SELECT * FROM classified_operator
 ), days AS (
  SELECT f.data_date,f.country,f.platform,f.platform_key,count(*)::bigint total,
   count(*) FILTER(WHERE f.is_success AND lower(btrim(f.status)) NOT IN ('已提交','submitted'))::bigint success,
   count(*) FILTER(WHERE NOT f.is_success AND f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE f.method='auto')::bigint auto_count,count(*) FILTER(WHERE f.method='manual')::bigint manual_count,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified_input f GROUP BY f.data_date,f.country,f.platform,f.platform_key
 ), operators AS MATERIALIZED (
  SELECT f.data_date,f.country,f.platform_key,f.account,count(*)::bigint processed,
   count(*) FILTER(WHERE f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE NOT f.is_rejected AND lower(btrim(f.status)) NOT IN ('已提交','submitted'))::bigint success,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified_input f WHERE f.method='manual' AND coalesce(p_request->>'view','auto')='operators'
  GROUP BY f.data_date,f.country,f.platform_key,f.account
 ), operator_days AS MATERIALIZED (
  SELECT o.data_date,o.country,o.platform_key,
   jsonb_agg(to_jsonb(o)-ARRAY['data_date','country','platform_key'] ORDER BY o.account) operator_rows
  FROM operators o GROUP BY o.data_date,o.country,o.platform_key
 )
 SELECT dt.d::date,s.country,s.platform,s.platform_key,d.total,d.success,d.rejected,d.auto_count,d.manual_count,
  d.avg_seconds,d.duration_sample_count,d.duration_total_seconds,d.source_updated_at,d.updated_at,false,
 coalesce(op.operator_rows,'[]'::jsonb),s.alias_keys
 FROM scopes s CROSS JOIN (SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt
 LEFT JOIN days d ON d.data_date=dt.d::date AND d.country=s.country AND d.platform_key=s.platform_key
 LEFT JOIN operator_days op ON op.data_date=dt.d::date AND op.country=s.country AND op.platform_key=s.platform_key;
END;
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.withdraw_prepared_source_contract_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(E'[{"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "e7a568feac2f1e3496ef7f6de2d13151", "procost": 100, "prokind": "f", "prolang": "14", "proname": "dashboard_admin_wg_withdraw_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": true, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform", "platform_key", "total", "success", "rejected", "auto_count", "manual_count", "avg_seconds", "source_updated_at", "updated_at", "complete", "operator_rows", "paying_count", "forced_count", "unknown_count"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "25", "20", "20", "20", "20", "20", "1700", "1184", "1184", "16", "3802", "20", "20", "20"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "1e9eda16514b65889295810e6bf1d742", "procost": 100, "prokind": "f", "prolang": "14", "proname": "dashboard_admin_yash_withdraw_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": false, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform", "platform_key", "total", "success", "rejected", "pending_count", "failed_count", "unknown_count", "avg_seconds", "duration_sample_count", "duration_total_seconds", "source_updated_at", "updated_at", "complete", "operator_rows"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "25", "20", "20", "20", "20", "20", "20", "1700", "20", "1700", "1184", "1184", "16", "3802"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_yash_withdraw_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "3046cba0a3d11b7de9494bf629f4a002", "procost": 100, "prokind": "f", "prolang": "14", "proname": "dashboard_admin_newar_withdraw_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": false, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform", "platform_key", "total", "success", "rejected", "auto_count", "manual_count", "pending_count", "unknown_count", "unclassified_count", "avg_seconds", "duration_sample_count", "duration_total_seconds", "source_updated_at", "updated_at", "complete", "operator_rows", "currencies", "currency_unknown_count"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "25", "20", "20", "20", "20", "20", "20", "20", "20", "1700", "20", "1700", "1184", "1184", "16", "3802", "3802", "20"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "43f204f10037840a839c9890d127e274", "procost": 100, "prokind": "f", "prolang": "13619", "proname": "dashboard_admin_ar_withdraw_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": false, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform", "platform_key", "total", "success", "rejected", "auto_count", "manual_count", "avg_seconds", "duration_sample_count", "duration_total_seconds", "source_updated_at", "updated_at", "complete", "operator_rows", "alias_keys"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "25", "20", "20", "20", "20", "20", "1700", "20", "1700", "1184", "1184", "16", "3802", "1009"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "53ecaffec7eae57a4bec29334e43eda8", "procost": 100, "prokind": "f", "prolang": "14", "proname": "dashboard_admin_duoli_withdraw_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": false, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform", "platform_key", "total", "success", "rejected", "pending_count", "unknown_count", "avg_seconds", "duration_sample_count", "duration_total_seconds", "source_updated_at", "updated_at", "operator_rows"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "25", "20", "20", "20", "20", "20", "1700", "20", "1700", "1184", "1184", "3802"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "9a7bba61d4cdb9b185c7fb7a07c8dc03", "procost": 100, "prokind": "f", "prolang": "13619", "proname": "dashboard_admin_ar_historical_duration_days", "prorows": 1000, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": true, "prosecdef": false, "prorettype": "2249", "prosqlbody": null, "prosupport": "-", "proargmodes": ["i", "i", "i", "i", "t", "t", "t", "t", "t", "t", "t"], "proargnames": ["p_request", "p_scope", "p_start", "p_end", "data_date", "country", "platform_key", "alias_keys", "duration_sample_count", "duration_total_seconds", "generated_at"], "proargtypes": ["3802", "3802", "1082", "1082"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": ["3802", "3802", "1082", "1082", "1082", "25", "25", "1009", "20", "1700", "1184"], "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date)"}, {"metadata": {"proacl": ["postgres=X/postgres"], "probin": null, "bodyMd5": "df9722109e2b1443531c017a3bcf7d5f", "procost": 100, "prokind": "f", "prolang": "13619", "proname": "dashboard_admin_live_game66_withdraw", "prorows": 0, "pronargs": 4, "proowner": "16388", "proconfig": ["search_path=\\"\\""], "proretset": false, "prosecdef": true, "prorettype": "3802", "prosqlbody": null, "prosupport": "-", "proargmodes": null, "proargnames": ["p_start", "p_end", "p_country", "p_platforms"], "proargtypes": ["1082", "1082", "25", "1009"], "proisstrict": false, "proparallel": "u", "protrftypes": null, "provariadic": "0", "provolatile": "s", "proleakproof": false, "pronamespace": "30796", "proallargtypes": null, "proargdefaults": null, "pronargdefaults": 0}, "signature": "private.dashboard_admin_live_game66_withdraw(date,date,text,text[])"}]'::jsonb)e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e->>'signature') WHERE p.oid IS NULL OR(to_jsonb(p)-ARRAY['oid','prosrc']||jsonb_build_object('bodyMd5',md5(p.prosrc)))IS DISTINCT FROM e->'metadata')$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.ar_historical_duration_generation()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='d9542829c2bb82345f27d5b00080d7c0')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='bc6b303925ab3eda045c3f3725220c89' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc) IN('43f204f10037840a839c9890d127e274','3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471','1bfc6398524bc3194b91f1d411960425','3645bf1a24efd1ae7b89897616172fa5','d372cd30224f4e1a6ff2e962d4df12b3','173bf1a012f07d69942571724ff8f658') and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='d8fc73594da699c74c13afddd8d9ed70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='17811807bf452cd1675d7ce54487c145' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:d8fc73594da699c74c13afddd8d9ed70:17811807bf452cd1675d7ce54487c145:d9542829c2bb82345f27d5b00080d7c0:bc6b303925ab3eda045c3f3725220c89:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency_common(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='3493a92bd119432165cc8587ee18e3a6' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')=p_scope) categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')=p_scope) blockers)
  )
 )::text);
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_token(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='3493a92bd119432165cc8587ee18e3a6' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')='IN') categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')='IN') blockers)
  ),
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_batch(p_targets jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH shared AS MATERIALIZED (
 SELECT jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='3493a92bd119432165cc8587ee18e3a6' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')='IN') categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')='IN') blockers)
  )
 ) value
), targets AS MATERIALIZED (SELECT value target FROM jsonb_array_elements(p_targets)), dependencies AS MATERIALIZED (
 SELECT t.target,md5((s.value||jsonb_build_object(
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and t.target->>'source'='ar'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where t.target->>'source'='ar'and source_system='AR'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name')
 
 ))::text) token
 FROM targets t CROSS JOIN shared s
)
SELECT jsonb_object_agg(target->>'id',jsonb_build_object('target',target,'token',token)) FROM dependencies;
$function$
$definition$;
 for e in select key signature,value metadata from jsonb_each($expected${"private.ar_historical_duration_generation()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"da51c8881e0b00322119d39bb20195e7","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)":{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"43f204f10037840a839c9890d127e274","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"91f691832a3ae3037e9e3a45f72a0ec8","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"61ee836c04220a9253be224e57e1753b","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_dependency()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"e339a7838ee2782a91efc72d69d6eb47","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_native_ar(jsonb,jsonb,date,date,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date, p_catalog jsonb","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"59fdd3dff2438c282de328ea5055eb6e","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.withdraw_prepared_source_contract_current()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"boolean","strict":false,"bodyMd5":"43ffae0a7d81144cc71e12ffc4928f4a","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"4db4f03172830c0ba7d80e8a4de8c448","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)":{"acl":"{postgres=X/postgres}","args":"p pg_proc","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"3493a92bd119432165cc8587ee18e3a6","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'withdraw_submitted_contract_drift:%',e.signature;end if;end loop;
with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency()) select jsonb_object_agg(k,v order by k)into after_deps from tokens;
 if after_deps is null or (select count(*)from jsonb_each(after_deps)where key like 'scope:%')<6 or (select count(*)from jsonb_each(after_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(after_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'withdraw_submitted_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into after_provider;
 if after_provider is null or exists(select 1 from jsonb_each(after_provider)x where x.value->>'token'is null)then raise exception'withdraw_submitted_provider_proof_missing';end if;
 if (before_deps-'withdraw')is distinct from(after_deps-'withdraw')or before_provider is distinct from after_provider then raise exception'withdraw_submitted_unrelated_dependency_changed';end if;
 if before_deps->>'withdraw'is not distinct from after_deps->>'withdraw'then raise exception'withdraw_submitted_dependency_not_advanced';end if;
 if private.withdraw_prepared_source_contract_current()is distinct from true or before_duration is distinct from private.ar_historical_duration_generation()or before_facts is distinct from private.ar_withdraw_fact_generation()then raise exception'withdraw_submitted_proof_drift';end if;
 perform set_config('audit.withdraw_submitted_success',jsonb_build_object('contract','withdraw-submitted-success-v1','withdrawBefore',before_deps->>'withdraw','withdrawAfter',after_deps->>'withdraw','unchangedOtherTokens',(select count(*)from jsonb_each(after_deps))-1,'providerTargets',(select count(*)from jsonb_each(after_provider)),'sourceContract',true,'durationAndFactProofUnchanged',true)::text,true);
end;$migration$;
select current_setting('audit.withdraw_submitted_success')::jsonb receipt;
commit;
