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
 ), facts AS MATERIALIZED (
  -- Country/platform/kind equality + timestamp bounds retain use of the existing
  -- per-scope applied_at indexes. Do not cast/filter the indexed time column.
  SELECT s.country,s.platform,s.platform_key,a.applied_at::date data_date,
   coalesce(a.status,'') status,
   -- Explicit Python str.strip whitespace set; POSIX space depends on DB locale.
   btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') account,
   CASE WHEN a.completed_at>a.applied_at THEN trunc(extract(epoch FROM a.completed_at-a.applied_at)) END seconds,
   a.observed_at,a.updated_at
  FROM scopes s JOIN public.ar_collected_orders a ON a.source_system='AR' AND a.country_code=s.code
   AND a.platform=ANY(s.aliases) AND a.order_kind='withdraw'
   AND a.applied_at>=TIMESTAMP '2026-10-10'
   AND a.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp AND a.applied_at<(p_end+1)::timestamp
 ), classified AS MATERIALIZED (
  SELECT f.*,
   (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
    OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
    OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0) is_success,
   (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
    OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0) is_rejected,
   CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM facts f
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
  FROM classified f WHERE f.method='manual' GROUP BY f.data_date,f.country,f.platform_key,f.account
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
$function$

