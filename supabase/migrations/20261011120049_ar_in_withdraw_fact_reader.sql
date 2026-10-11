-- OFFLINE GUARDED CANDIDATE: partition/future proof required to read facts.
begin;
set local lock_timeout='2s';set local statement_timeout='20s';
do $patch$
declare p record;v_definition text;v_body text;v_before jsonb;v_after jsonb;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.provolatile<>'s' or p.prosecdef or p.proparallel<>'u' or not p.proretset or p.prorettype<>'record'::regtype
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  or pg_get_function_result(p.oid)<>'TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])' or md5(p.prosrc) not in('53cf57763dca603f812cf91c1dea7bb7','90a9a7aa8e3142494d37d3a6cb6c2a8d')
  then raise exception 'ar_withdraw_projection_reader_metadata_drift';end if;
 if private.ar_withdraw_fact_generation() is null then raise exception 'ar_withdraw_ready_generation_invalid';end if;
 v_before:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='53cf57763dca603f812cf91c1dea7bb7' then
  if (length(p.prosrc)-length(replace(p.prosrc,$old$ ), facts AS MATERIALIZED (
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
$old$,'')))/length($old$ ), facts AS MATERIALIZED (
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
$old$)<>1 then raise exception 'ar_withdraw_projection_reader_anchor_drift';end if;
  v_body:=replace(p.prosrc,$old$ ), facts AS MATERIALIZED (
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
$old$,$new$ ), generation AS MATERIALIZED (
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
   CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
    WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END method
  FROM raw_facts f

  UNION ALL
  SELECT q.country,q.platform,q.platform_key,q.data_date,f.status,f.account,f.seconds,f.observed_at,f.updated_at,f.is_success,f.is_rejected,f.method
  FROM partitions q JOIN private.ar_withdraw_facts f ON f.country_code=q.code AND f.platform=q.native_alias
   AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
  WHERE q.projected
$new$);
  if md5(v_body)<>'90a9a7aa8e3142494d37d3a6cb6c2a8d' then raise exception 'ar_withdraw_projection_reader_afterhash_mismatch';end if;
  v_definition:=pg_get_functiondef(p.oid);
  if position(p.prosrc in v_definition)=0 then raise exception 'ar_withdraw_projection_reader_definition_drift';end if;
  execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(q)-'prosrc' into v_after from pg_proc q where q.oid=p.oid;
 if v_after is distinct from v_before or (select md5(prosrc) from pg_proc where oid=p.oid)<>'90a9a7aa8e3142494d37d3a6cb6c2a8d' then raise exception 'ar_withdraw_projection_reader_post_metadata_drift';end if;
end;$patch$;
commit;
