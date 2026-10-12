-- Exact code-only production definitions, no source rows, credentials, sessions or screenshots.
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
  FROM partitions q CROSS JOIN LATERAL (
   SELECT a.* FROM public.ar_collected_orders a
   WHERE NOT q.projected AND a.source_system='AR' AND a.country_code=q.code
    AND a.platform=q.native_alias AND a.order_kind='withdraw'
    AND a.applied_at>=TIMESTAMP '2026-10-10'
    AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   OFFSET 0
  ) a
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
  FROM partitions q CROSS JOIN LATERAL (
   SELECT f.* FROM private.ar_withdraw_facts f
   WHERE q.projected AND f.country_code=q.code AND f.platform=q.native_alias
    AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
    AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
    AND f.applied_at<(p_end+1)::timestamp
   OFFSET 0
  ) f
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
$function$
;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
 -- newar_received_blocking_v1: validated request and fresh scoped native metadata.
 v_rows:=private.dashboard_admin_newar_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
 if v_rows is not null then return v_rows;end if;
 -- yash_received_source_notes_v1: validated request and fresh scoped native metadata.
 if v_meta.source='kb' then
  v_rows:=private.dashboard_admin_yash_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then
  with source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(country_code,order_kind,channel_type,money_format_version,amount_local,currency_local,money_issue_code,amount) end amount,
    case when v_kind in('orders','blockingOrders') then status end status,
    nullif(btrim(operator),'') operator,
    case when v_kind in('orders','blockingOrders') then applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then completed_at end completed_at,
    nullif(btrim(manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(remark),'') else remark end end rejection_raw,
    updated_at,
    case when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(status,''))>0 OR position('驳回' IN coalesce(status,''))>0 OR position('拒绝' IN coalesce(status,''))>0 OR position('reject' IN lower(coalesce(status,'')))>0 OR position('failed' IN lower(coalesce(status,'')))>0) AND NOT (position('已通过' IN coalesce(status,''))>0 OR position('已提交' IN coalesce(status,''))>0 OR (position('通过' IN coalesce(status,''))>0 AND position('未通过' IN coalesce(status,''))=0) OR position('success' IN lower(coalesce(status,'')))>0 OR position('submitted' IN lower(coalesce(status,'')))>0 OR position('成功' IN coalesce(status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (status in('失败','提现失败','出款失败') and coalesce(btrim(raw_channel),'') in ('','人工取消')) then 'rejected' when status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders where source_system='AR' and country_code=v_code and platform=any(v_aliases) and order_kind='withdraw'
     and applied_at>=v_date::timestamp and applied_at<(v_date+1)::timestamp
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
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,c.blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as materialized (
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
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end),0,order_no,applied_at
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
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_or_rejected_business_rule' else 'current_operator' end) else '{}'::jsonb end
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
$function$
;
CREATE OR REPLACE FUNCTION private.ar_withdraw_fact_generation()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with functions as materialized (
  select p.*,p.xmin,pg_get_userbyid(p.proowner) owner_name from pg_catalog.pg_proc p where p.oid in(
   'private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz)'::regprocedure,
   'private.sync_ar_withdraw_fact()'::regprocedure,'private.invalidate_ar_withdraw_ready()'::regprocedure)
 ), source_triggers as materialized (
  select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t
  where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal and t.tgenabled='O'
   and t.tgfoid='private.sync_ar_withdraw_fact()'::regprocedure and ((t.tgname='ar_withdraw_fact_sync_delete' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_delete AFTER DELETE ON public.ar_collected_orders FOR EACH ROW WHEN (((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()') OR (t.tgname='ar_withdraw_fact_sync_insert' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_insert AFTER INSERT ON public.ar_collected_orders FOR EACH ROW WHEN (((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()') OR (t.tgname='ar_withdraw_fact_sync_update' AND pg_get_triggerdef(t.oid)='CREATE TRIGGER ar_withdraw_fact_sync_update AFTER UPDATE ON public.ar_collected_orders FOR EACH ROW WHEN ((((old.source_system = ''AR''::text) AND (old.country_code = ''IN''::text) AND (old.order_kind = ''withdraw''::text) AND (old.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)) OR ((new.source_system = ''AR''::text) AND (new.country_code = ''IN''::text) AND (new.order_kind = ''withdraw''::text) AND (new.applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))) EXECUTE FUNCTION private.sync_ar_withdraw_fact()'))
 ), control_triggers as materialized (
  select t.oid,t.xmin::text epoch,pg_get_triggerdef(t.oid) definition from pg_catalog.pg_trigger t
  where t.tgrelid='private.ar_withdraw_facts'::regclass and not t.tgisinternal and t.tgenabled='O'
   and t.tgfoid='private.invalidate_ar_withdraw_ready()'::regprocedure and t.tgnargs=0 and t.tgattr::text='' and t.tgqual is null
   and ((t.tgname='ar_withdraw_fact_ready_change' and t.tgtype=29) or (t.tgname='ar_withdraw_fact_ready_truncate' and t.tgtype=32))
 )
 select case when
  (select count(*) from source_triggers)=3 and (select count(*) from control_triggers)=2
  and (select count(*) from functions)=3 and not exists(select 1 from functions p where
   p.owner_name<>'postgres' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres}'
   or case when p.proname='ar_withdraw_fact' then p.prosecdef or p.provolatile<>'i' or p.prolang<>(select oid from pg_language where lanname='sql') or md5(p.prosrc)<>'2ced394f03ebe7de5dbb8721c8f73304'
    when p.proname='sync_ar_withdraw_fact' then not p.prosecdef or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'fd2f53c73d864b0a6daa5c1016053894'
    else not p.prosecdef or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or md5(p.prosrc)<>'e38baf782d5ad203998661c79823e24f' end)
  and not exists(select 1 from pg_class c where c.oid in('private.ar_withdraw_facts'::regclass,
    'private.ar_withdraw_fact_ready'::regclass,'private.ar_withdraw_fact_future_ready'::regclass)
   and (pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity or
    exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner) or
    exists(select 1 from pg_policy p where p.polrelid=c.oid)))
 and (select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid='private.ar_withdraw_facts'::regclass and contype='c' and convalidated and not connoinherit)='["CHECK (((source_system = ''AR''::text) AND (country_code = ''IN''::text) AND (order_kind = ''withdraw''::text) AND (applied_at >= ''2026-10-10 00:00:00''::timestamp without time zone)))", "CHECK ((method = ANY (ARRAY[''auto''::text, ''manual''::text, ''unknown''::text])))"]'::jsonb
 then md5(jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_array(oid,xmin::text,md5(prosrc),proowner,prosecdef,provolatile,proparallel,proconfig,proacl::text) order by oid) from functions),
  'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from (select * from source_triggers union all select * from control_triggers)t))::text) end;
$function$
;
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
   and md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471','1bfc6398524bc3194b91f1d411960425') and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
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
;
CREATE OR REPLACE FUNCTION public.publish_ar_collected_orders(p_token_hash text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 cred jsonb; scope_count integer; allowed constant jsonb := '[{"country_code":"PK","platform":"92PKR"},{"country_code":"PK","platform":"92R"},{"country_code":"PK","platform":"92DADU"},{"country_code":"PK","platform":"92GO"},{"country_code":"PK","platform":"92COCO"},{"country_code":"PK","platform":"92GLORY"},{"country_code":"PK","platform":"92STRIKE"},{"country_code":"PK","platform":"92STAR"},{"country_code":"PK","platform":"92.GAME"},{"country_code":"PK","platform":"YAYWIN"},{"country_code":"BR","platform":"POPBRA"},{"country_code":"BR","platform":"POPPG"},{"country_code":"BR","platform":"POP555"},{"country_code":"BR","platform":"POP678"},{"country_code":"BR","platform":"POP888"},{"country_code":"BR","platform":"POPLUA"},{"country_code":"BR","platform":"POPBEM"},{"country_code":"BR","platform":"POPCEU"},{"country_code":"VN","platform":"92LOTTERY"},{"country_code":"VN","platform":"VN168"},{"country_code":"VN","platform":"66CLUB"},{"country_code":"VN","platform":"82VN"},{"country_code":"ID","platform":"55FIVE"},{"country_code":"MY","platform":"MZPLAY"},{"country_code":"MM","platform":"6LOTTERY"},{"country_code":"NG","platform":"FB999"},{"country_code":"IN","platform":"91CLUB"},{"country_code":"IN","platform":"55CLUB"},{"country_code":"IN","platform":"IN999"},{"country_code":"IN","platform":"OKWIN"},{"country_code":"IN","platform":"JALWA"},{"country_code":"IN","platform":"BIGMUMBAI"},{"country_code":"IN","platform":"82LOTTERY"},{"country_code":"IN","platform":"LOTTERY7"},{"country_code":"IN","platform":"51GAME"},{"country_code":"IN","platform":"6CLUB"},{"country_code":"IN","platform":"TPPLAY"},{"country_code":"IN","platform":"RAJA"},{"country_code":"IN","platform":"JAICLUB"},{"country_code":"IN","platform":"Shree.Win"},{"country_code":"IN","platform":"Veer.Game"}]'::jsonb;
 r jsonb; k text; bid uuid; stamp timestamptz; fingerprint text; prior_hash text; n integer;
 dual boolean := false; local_count integer := 0; usdt_count integer := 0; money_ack jsonb := '{}'::jsonb;
BEGIN
 SELECT allowed_scopes INTO cred FROM public.ar_business_direct_credentials
 WHERE token_hash=p_token_hash AND NOT revoked AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='ARO_AUTH_INVALID'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>1048576 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 SELECT count(*) INTO scope_count FROM jsonb_array_elements(allowed) a
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=a->>'country_code' AND c->>'platform'=a->>'platform');
 IF scope_count=0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED'; END IF;
 IF p_payload->>'action'='check' THEN
   IF p_payload<>jsonb_build_object('action','check') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
   RETURN jsonb_build_object('ok',true,'source_system','AR','details_version',1,'scope_count',scope_count);
 END IF;
 dual := p_payload ? 'money_format_version';
 IF dual AND (p_payload->'money_format_version' IS DISTINCT FROM '1'::jsonb
   OR p_payload->>'country_code' IS DISTINCT FROM 'IN' OR p_payload->>'order_kind' IS DISTINCT FROM 'withdraw') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MONEY_VERSION';
 END IF;
 IF p_payload->>'action' IS DISTINCT FROM 'ingest' OR p_payload->>'source_system' IS DISTINCT FROM 'AR'
   OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>(CASE WHEN dual THEN 9 ELSE 8 END)
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) f(key) WHERE f.key<>ALL(ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at','orders'] || CASE WHEN dual THEN ARRAY['money_format_version'] ELSE ARRAY[]::text[] END)) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 FOREACH k IN ARRAY ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at'] LOOP
   IF jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(allowed) a WHERE a->>'country_code'=p_payload->>'country_code' AND a->>'platform'=p_payload->>'platform')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=p_payload->>'country_code' AND c->>'platform'=p_payload->>'platform') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED';
 END IF;
 IF p_payload->>'batch_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_payload->>'order_kind' NOT IN ('recharge','withdraw')
   OR p_payload->>'observed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_IDENTITY';
 END IF;
 BEGIN
   stamp:=(p_payload->>'observed_at')::timestamptz;
   IF stamp<timestamptz '2020-01-01 00:00:00+00' OR stamp>clock_timestamp()+interval '5 minutes'
      OR to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(p_payload->>'observed_at',19) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT';
   END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT'; END;
 IF jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'orders')>500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDERS';
 END IF;
 n:=jsonb_array_length(p_payload->'orders');
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'orders') LOOP
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['member_level','recharge_count']))<>(CASE WHEN dual THEN 15 ELSE 12 END)
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['order_no','member_id','amount','amount_text','status','applied_at','completed_at','operator','raw_channel','channel_type','remark','manual_remark'] || CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END || ARRAY['member_level','recharge_count'])) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   IF NOT public.ar_order_valid_text(r->'order_no',160,false,true) OR NOT public.ar_order_valid_text(r->'member_id',80,true,true)
     OR NOT public.ar_order_valid_text(r->'amount_text',100) OR NOT public.ar_order_valid_text(r->'status',160)
     OR NOT public.ar_order_valid_local_time(r->'applied_at') OR NOT public.ar_order_valid_local_time(r->'completed_at')
     OR NOT public.ar_order_valid_text(r->'operator',240) OR NOT public.ar_order_valid_text(r->'raw_channel',240)
     OR NOT public.ar_order_valid_text(r->'channel_type',240) OR NOT public.ar_order_valid_text(r->'remark',8000)
     OR NOT public.ar_order_valid_text(r->'manual_remark',8000) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   -- Optional source facts: missing/null remain unknown; integers preserve zero.
   FOREACH k IN ARRAY ARRAY['member_level','recharge_count'] LOOP
     IF r ? k AND r->k IS DISTINCT FROM 'null'::jsonb THEN
       IF jsonb_typeof(r->k) IS DISTINCT FROM 'number'
         OR r->>k !~ '^(0|[1-9][0-9]{0,8})$' THEN
         RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MEMBER_FACT';
       END IF;
       IF (r->>k)::numeric>(CASE WHEN k='member_level' THEN 9999 ELSE 999999999 END) THEN
         RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MEMBER_FACT';
       END IF;
     END IF;
   END LOOP;
   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN
     IF jsonb_typeof(r->'amount') IS DISTINCT FROM 'string' THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT';
     END IF;
     -- Match JavaScript trim() whitespace; keep the original signed source amount.
     IF p_payload->>'order_kind'='recharge'
       AND coalesce(btrim(r->>'raw_channel',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='人工充值',false) THEN
       IF r->>'amount' !~ '^-?(0|[1-9][0-9]{0,13})[.][0-9]{2}$' OR r->>'amount'='-0.00' THEN
         RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT';
       END IF;
     ELSIF r->>'amount' !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$' THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT';
     END IF;
     IF abs((r->>'amount')::numeric)>90071992547409.91 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT'; END IF;
   END IF;
   IF dual THEN
     IF r->>'currency_local' IS DISTINCT FROM 'INR'
       OR (r->'amount_local'='null'::jsonb AND r->'amount_usdt'='null'::jsonb) THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     FOREACH k IN ARRAY ARRAY['amount_local','amount_usdt'] LOOP
       IF r->k IS DISTINCT FROM 'null'::jsonb THEN
         IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR r->>k !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$' THEN
           RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
         END IF;
         IF (r->>k)::numeric>90071992547409.91 THEN
           RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
         END IF;
       END IF;
     END LOOP;
     IF upper(btrim(r->>'channel_type'))='USDT' AND r->'amount_usdt'='null'::jsonb THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     IF upper(btrim(r->>'channel_type')) IN ('BANK CARD','ARPAY','UPI') AND r->'amount_local'='null'::jsonb THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUAL_MONEY';
     END IF;
     IF r->'amount_local' IS DISTINCT FROM 'null'::jsonb THEN local_count := local_count+1; END IF;
     IF r->'amount_usdt' IS DISTINCT FROM 'null'::jsonb THEN usdt_count := usdt_count+1; END IF;
   END IF;
 END LOOP;
 IF dual THEN
   money_ack := jsonb_build_object('money_format_version',1,'money_local_count',local_count,
     'money_usdt_count',usdt_count,'money_missing_local_count',n-local_count);
 END IF;
 IF (SELECT count(DISTINCT value->>'order_no') FROM jsonb_array_elements(p_payload->'orders'))<>n THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUPLICATE';
 END IF;
 bid:=(p_payload->>'batch_id')::uuid; fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-batch:'||bid::text,0));
 SELECT payload_hash INTO prior_hash FROM public.ar_collected_order_receipts WHERE batch_id=bid;
 IF FOUND THEN
   IF prior_hash<>fingerprint THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='ARO_BATCH_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','unchanged') || money_ack;
 END IF;
 -- Stable scope lock avoids overlapping-page upsert deadlocks; different scopes remain independent.
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-scope:'||jsonb_build_array(p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind')::text,0));
 PERFORM private.collector_record_receipt_route_v1('ar_business_direct',p_token_hash,jsonb_build_object('country_code',p_payload->>'country_code','platform',p_payload->>'platform'),'ar_order',bid);
 INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);
 -- Dual fields are evidence, not a currency conversion. Keep legacy payload bytes for the receipt hash.
 INSERT INTO public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,operator,raw_channel,channel_type,remark,manual_remark,observed_at,batch_id,
   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code,member_level,recharge_count)
 SELECT 'AR',p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind',value->>'order_no',value->>'member_id',
   (CASE WHEN dual THEN value->>'amount_local' ELSE value->>'amount' END)::numeric,
   CASE WHEN dual THEN value->>'amount_local' ELSE value->>'amount_text' END,value->>'status',
   (value->>'applied_at')::timestamp,(value->>'completed_at')::timestamp,value->>'operator',value->>'raw_channel',value->>'channel_type',value->>'remark',value->>'manual_remark',stamp,bid,
   (value->>'amount_local')::numeric,(value->>'amount_usdt')::numeric,value->>'currency_local',
   CASE WHEN dual THEN 1::smallint END,CASE WHEN dual THEN stamp END,
   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END,
   (value->>'member_level')::integer,(value->>'recharge_count')::integer
 FROM jsonb_array_elements(p_payload->'orders') ORDER BY value->>'order_no'
 ON CONFLICT(source_system,country_code,platform,order_kind,order_no) DO UPDATE SET
   amount=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local) WHEN public.ar_collected_orders.money_format_version=1 THEN public.ar_collected_orders.amount ELSE excluded.amount END,
   amount_text=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local)::text WHEN public.ar_collected_orders.money_format_version=1 THEN public.ar_collected_orders.amount_text ELSE excluded.amount_text END,
   amount_local=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_local,public.ar_collected_orders.amount_local) ELSE public.ar_collected_orders.amount_local END,
   amount_usdt=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN coalesce(excluded.amount_usdt,public.ar_collected_orders.amount_usdt) ELSE public.ar_collected_orders.amount_usdt END,
   currency_local=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.currency_local ELSE public.ar_collected_orders.currency_local END,
   money_format_version=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.money_format_version ELSE public.ar_collected_orders.money_format_version END,
   money_observed_at=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN excluded.money_observed_at ELSE public.ar_collected_orders.money_observed_at END,
   money_issue_code=CASE WHEN excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at) THEN
     CASE WHEN excluded.amount_local IS NOT NULL THEN NULL
       WHEN public.ar_collected_orders.money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT'
         OR (public.ar_collected_orders.amount_local IS NOT NULL AND excluded.amount_usdt IS NOT NULL
             AND public.ar_collected_orders.amount_usdt IS DISTINCT FROM excluded.amount_usdt)
       THEN 'LOCAL_AMOUNT_STALE_FOR_USDT'
       ELSE 'LOCAL_AMOUNT_NOT_PROVIDED' END
     ELSE public.ar_collected_orders.money_issue_code END,
   -- Old clients and unavailable fields never erase previously captured facts.
   member_level=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN coalesce(excluded.member_level,public.ar_collected_orders.member_level) ELSE public.ar_collected_orders.member_level END,
   recharge_count=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN coalesce(excluded.recharge_count,public.ar_collected_orders.recharge_count) ELSE public.ar_collected_orders.recharge_count END,
   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,
   status=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.status ELSE public.ar_collected_orders.status END,
   applied_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.applied_at ELSE public.ar_collected_orders.applied_at END,
   completed_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.completed_at ELSE public.ar_collected_orders.completed_at END,
   operator=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.operator ELSE public.ar_collected_orders.operator END,
   channel_type=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.channel_type ELSE public.ar_collected_orders.channel_type END,
   remark=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.remark ELSE public.ar_collected_orders.remark END,
   manual_remark=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.manual_remark ELSE public.ar_collected_orders.manual_remark END,
   observed_at=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.observed_at ELSE public.ar_collected_orders.observed_at END,
   batch_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.batch_id ELSE public.ar_collected_orders.batch_id END,
   raw_channel=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN CASE
     WHEN excluded.order_kind='withdraw' AND excluded.status='已通过'
       AND nullif(btrim(excluded.raw_channel),'') IS NULL AND public.ar_collected_orders.raw_channel='人工确认'
     THEN public.ar_collected_orders.raw_channel ELSE excluded.raw_channel END ELSE public.ar_collected_orders.raw_channel END,
   updated_at=clock_timestamp()
 -- A newer legacy status must not prevent an independently newer monetary proof,
 -- nor may an older proof roll back the business status or its observed_at.
 WHERE public.ar_collected_orders.observed_at<excluded.observed_at OR (excluded.money_format_version=1 AND (public.ar_collected_orders.money_format_version IS DISTINCT FROM 1 OR public.ar_collected_orders.money_observed_at<excluded.money_observed_at));
 RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','accepted') || money_ack;
END;
$function$
;
