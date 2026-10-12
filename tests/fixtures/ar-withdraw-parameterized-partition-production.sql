-- Code-only current b8b reader and historical cache validator; no business rows.
CREATE OR REPLACE FUNCTION private.dashboard_admin_ar_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
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
   CROSS JOIN generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d) CROSS JOIN generation g
 ), raw_facts AS NOT MATERIALIZED (
  SELECT q.country,q.platform,q.platform_key,a.applied_at::date data_date,
   coalesce(a.status,'') status,
   -- Explicit Python str.strip whitespace set; POSIX space depends on DB locale.
   btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') account,
   CASE WHEN a.completed_at>a.applied_at THEN trunc(extract(epoch FROM a.completed_at-a.applied_at)) END seconds,
   a.observed_at,a.updated_at
  FROM partitions q JOIN public.ar_collected_orders a ON a.source_system='AR' AND a.country_code=q.code
   AND a.platform=q.native_alias AND a.order_kind='withdraw'
   AND a.applied_at>=TIMESTAMP '2026-10-10'
   AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   WHERE NOT q.projected
 ), classified AS MATERIALIZED (
  SELECT f.*,
   (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
    OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
    OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) is_success,
   (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
    OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) is_rejected,
   CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN
    CASE WHEN (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0 OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) AND NOT (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0 OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0) OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) THEN 'manual' ELSE 'unknown' END
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM raw_facts f

  UNION ALL
  SELECT q.country,q.platform,q.platform_key,q.data_date,f.status,f.account,f.seconds,f.observed_at,f.updated_at,f.is_success,f.is_rejected,
   CASE WHEN f.method='unknown' AND f.is_rejected AND NOT f.is_success THEN 'manual' ELSE f.method END
  FROM partitions q JOIN private.ar_withdraw_facts f ON f.country_code=q.code AND f.platform=q.native_alias
   AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
  WHERE q.projected
   AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
   AND f.applied_at<(p_end+1)::timestamp
 ), days AS (
  SELECT f.data_date,f.country,f.platform,f.platform_key,count(*)::bigint total,
   count(*) FILTER(WHERE f.is_success)::bigint success,
   count(*) FILTER(WHERE NOT f.is_success AND f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE f.method='auto')::bigint auto_count,count(*) FILTER(WHERE f.method='manual')::bigint manual_count,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified f GROUP BY f.data_date,f.country,f.platform,f.platform_key
 ), operators AS MATERIALIZED (
  SELECT f.data_date,f.country,f.platform_key,f.account,count(*)::bigint processed,
   count(*) FILTER(WHERE f.is_rejected)::bigint rejected,
   count(*) FILTER(WHERE NOT f.is_rejected)::bigint success,
   sum(f.seconds) FILTER(WHERE f.seconds>0)/nullif(count(*) FILTER(WHERE f.seconds>0),0) avg_seconds,
   count(*) FILTER(WHERE f.seconds>0)::bigint duration_sample_count,
   coalesce(sum(f.seconds) FILTER(WHERE f.seconds>0),0) duration_total_seconds,
   max(f.observed_at) source_updated_at,max(f.updated_at) updated_at
  FROM classified f WHERE f.method='manual' AND coalesce(p_request->>'view','auto')='operators'
  GROUP BY f.data_date,f.country,f.platform_key,f.account
 ), operator_days AS MATERIALIZED (
  SELECT o.data_date,o.country,o.platform_key,
   jsonb_agg(to_jsonb(o)-ARRAY['data_date','country','platform_key'] ORDER BY o.account) operator_rows
  FROM operators o GROUP BY o.data_date,o.country,o.platform_key
 )
 SELECT dt.d::date,s.country,s.platform,s.platform_key,d.total,d.success,d.rejected,d.auto_count,d.manual_count,
  d.avg_seconds,d.duration_sample_count,d.duration_total_seconds,d.source_updated_at,d.updated_at,false,
 coalesce(op.operator_rows,'[]'::jsonb),s.alias_keys
 FROM scopes s CROSS JOIN generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)
 LEFT JOIN days d ON d.data_date=dt.d::date AND d.country=s.country AND d.platform_key=s.platform_key
 LEFT JOIN operator_days op ON op.data_date=dt.d::date AND op.country=s.country AND op.platform_key=s.platform_key;
END;
$function$;

CREATE OR REPLACE FUNCTION private.ar_historical_duration_generation()
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
   and md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471') and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
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
$function$;

revoke all on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;
revoke all on function private.ar_historical_duration_generation() from public,anon,authenticated,service_role;
-- Exact already-installed production source cover index, created locally without CONCURRENTLY.
create index if not exists ar_collected_withdraw_report_cover_idx
 on public.ar_collected_orders(country_code,platform,applied_at)
 include(status,operator,completed_at,observed_at,updated_at)
 where source_system='AR' and order_kind='withdraw' and applied_at>=timestamp '2026-10-10';
