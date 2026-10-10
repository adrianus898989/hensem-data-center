-- NewAR auto/operator statistics use existing ten-minute details only.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
do $guard$
declare p record;
begin
 if to_regprocedure('private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)') is not null then raise exception 'newar_withdraw_helper_already_exists';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'685a4451ad17a9b383a1213bacefe903' or p.prosecdef is not true or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.owner_name<>'postgres'
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'newar_withdraw_reader_baseline_drift';end if;
end;$guard$;
-- Creation-day current-state statistics from the existing ten-minute detail stream.
create or replace function private.dashboard_admin_newar_withdraw_days(p_request jsonb,p_scope jsonb,p_start date,p_end date)
returns table(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
 auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,
 avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,
 complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
language sql stable set search_path='' as $function$
 with sites as materialized (
  select distinct p.name,p.country,p.source_name,p.timezone,n.launch_at,private.dashboard_admin_live_withdraw_key(p.name) platform_key
  from private.dashboard_admin_live_platforms() p join public.newar_detail_platforms n on n.platform=p.source_name
  where p.source='newar' and n.enabled and private.dashboard_scope_allows(p_scope,n.country_code,n.platform)
   and (case when p_request ? 'scopeTargets' then exists(select 1 from jsonb_array_elements(p_request->'scopeTargets') t
    where t->>'country'=p.country and exists(select 1 from jsonb_array_elements_text(t->'platforms') f
     where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name))) else p_request->>'country'=p.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(p.name))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
 ), facts as materialized (
  select s.*,n.source_id,n.status_group,n.currency,n.captured_at,n.received_at,(n.created_at at time zone s.timezone)::date local_date,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(btrim(n.raw->>'operatorSourceField'),'') is not null
    and nullif(btrim(n.raw->>'operatorName'),'') is not null and n.raw->>'operatorType' in ('auto','manual') then n.raw->>'operatorType' end method,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(btrim(n.raw->>'operatorSourceField'),'') is not null
    and nullif(btrim(n.raw->>'operatorName'),'') is not null and n.raw->>'operatorType' in ('auto','manual')
    then btrim(n.raw->>'operatorName') else '（未知操作人）' end account,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(n.raw->>'sourceSubmittedSourceField','') is not null
    and nullif(n.raw->>'sourceHandledSourceField','') is not null and isfinite(t.submitted) and isfinite(t.handled)
    and t.handled>=t.submitted and t.handled<=n.captured_at and t.handled<=statement_timestamp()
    then extract(epoch from t.handled-t.submitted) end processing_seconds
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset='withdraw'
  cross join lateral (select private.newar_stats_time(n.raw->>'sourceSubmittedAt') submitted,private.newar_stats_time(n.raw->>'sourceHandledAt') handled) t
  where n.created_at>=p_start::timestamp at time zone s.timezone and n.created_at<(p_end+1)::timestamp at time zone s.timezone
   and (s.launch_at is null or n.created_at>=s.launch_at)
 ), days as materialized (
  select s.*,d::date local_date,d::timestamp at time zone s.timezone day_start,(d::date+1)::timestamp at time zone s.timezone day_end,
   (select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) from private.newar_detail_coverage_runs c
    where c.platform=s.source_name and c.dataset='withdraw' and c.invalidated_at is null and c.observed_at<=statement_timestamp()
     and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone and c.end_at>d::timestamp at time zone s.timezone) ranges,
   (select max(c.observed_at) from private.newar_detail_coverage_runs c where c.platform=s.source_name and c.dataset='withdraw'
    and c.invalidated_at is null and c.observed_at<=statement_timestamp() and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone
    and c.end_at>d::timestamp at time zone s.timezone) coverage_seen
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ), evidence as materialized (
  select d.*,day_end<=statement_timestamp() and (launch_at is null or day_start>=launch_at)
   and coalesce(ranges @> tstzrange(day_start,day_end,'[)'),false) complete from days d
 ), operators as (
  select country,platform_key,local_date,account,count(*) processed,count(*) filter(where status_group='success') success,
   count(*) filter(where status_group in('failed','rejected')) rejected,
   max(captured_at) source_updated_at,max(received_at) updated_at,count(processing_seconds) duration_sample_count,
   sum(processing_seconds) duration_total_seconds,avg(processing_seconds) avg_seconds
  from facts where method is distinct from 'auto' group by 1,2,3,4
 )
 select d.local_date,d.country,d.name,d.platform_key,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group='success') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group in('failed','rejected')) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method='auto') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method='manual') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group='pending') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group is null or status_group not in('success','failed','rejected','pending')) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method is null) end,avg(processing_seconds),count(processing_seconds),sum(processing_seconds),
  max(captured_at),greatest(max(received_at),d.coverage_seen),d.complete and coalesce(max(captured_at)<=statement_timestamp(),true),
  coalesce((select jsonb_agg(to_jsonb(o) order by o.account) from operators o
   where o.country=d.country and o.platform_key=d.platform_key and o.local_date=d.local_date),'[]'::jsonb),
  coalesce(jsonb_agg(distinct f.currency) filter(where nullif(f.currency,'') is not null),'[]'::jsonb),count(f.source_id) filter(where nullif(f.currency,'') is null)
 from evidence d left join facts f on f.country=d.country and f.platform_key=d.platform_key and f.local_date=d.local_date
 group by d.local_date,d.country,d.name,d.platform_key,d.complete,d.coverage_seen;
$function$;
revoke all on function private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;

do $patch$
declare d text;r record;before_meta jsonb;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,before_meta from pg_proc p where p.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 for r in select * from (values
 ($old$v_yash_period text;$old$,$new$v_yash_period text;v_newar_days jsonb;$new$),
 ($old$ with selected_targets as materialized ($old$,$new$ select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_newar_days
 from private.dashboard_admin_newar_withdraw_days(p_request,v_scope,v_before,v_end) n;
 with selected_targets as materialized ($new$),
 ($old$ ), daily_source as materialized ($old$,$new$ ), newar_days as materialized (
  select * from jsonb_to_recordset(v_newar_days) n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
 ), daily_source as materialized ($new$),
 ($old$
   and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)$old$,$new$
   and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
   and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)$new$),
 ($old$'created_to_completed'::text from yash_days where total is not null
 ), operator_source$old$,$new$'created_to_completed'::text from yash_days where total is not null
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_submitted_to_handled'::text from newar_days
 ), operator_source$new$),
 ($old$
    and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)$old$,$new$
    and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
    and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)$new$),
 ($old$  from yash_days y cross join lateral jsonb_array_elements(y.operator_rows) r
 ), daily as materialized ($old$,$new$  from yash_days y cross join lateral jsonb_array_elements(y.operator_rows) r
  union all select n.data_date,n.country,n.platform,n.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_submitted_to_handled'::text,(r->>'success')::bigint
  from newar_days n cross join lateral jsonb_array_elements(n.operator_rows) r
 ), daily as materialized ($new$),
 ($old$  select p.country,p.platform,p.platform_key,p.group_date,p.account,
   case when exists(select 1 from yash_days$old$,$new$  select p.country,p.platform,p.platform_key,p.group_date,p.account,
   case when exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
    and (not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end),false)
    or not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date-1 else v_before end and case when v_daily then p.group_date-1 else v_start-1 end),false))
    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from yash_days$new$),
 ($old$ return v_result;
end;$old$,$new$ -- NewAR detail coverage and explicit unknowns; no legacy source fallback.
 if jsonb_array_length(v_newar_days)>0 then
  v_result:=v_result||jsonb_build_object('newarCoverage',(
   select jsonb_build_object('source','NEWAR','timeBasis','created_at','operatorBasis','current_latest_operator','operatorExcludesExplicitAutomatic',true,
    'currentComplete',coalesce(bool_and(n.complete) filter(where n.data_date>=v_start),false),
    'previousComplete',coalesce(bool_and(n.complete) filter(where n.data_date<v_start),false),
    'latestCollectedAt',max(n.updated_at) filter(where n.data_date>=v_start),
    'days',jsonb_agg(jsonb_build_object('country',n.country,'platform',n.platform,'date',n.data_date,'complete',n.complete,
     'total',n.total,'pendingCount',n.pending_count,'unknownStatusCount',n.unknown_count,'unclassifiedCount',n.unclassified_count,
     'currencies',n.currencies,'currencyUnknownCount',n.currency_unknown_count,'latestCollectedAt',n.updated_at) order by n.country,n.platform,n.data_date))
   from jsonb_to_recordset(v_newar_days)n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)));
  if (v_result#>>'{newarCoverage,currentComplete}')::boolean is not true or (v_result#>>'{newarCoverage,previousComplete}')::boolean is not true then
   v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);
  end if;
  v_yash_rows:='[]'::jsonb;
  for v_yash_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_newar_days)n(country text,platform_key text)
    where n.country=v_yash_item->>'country' and n.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')) then
    v_yash_from:=case when v_daily then (v_yash_item->>'dataDate')::date else v_start end;
    v_yash_to:=case when v_daily then v_yash_from else v_end end;
    select jsonb_build_object('source','NEWAR','statisticBasis','created_at_current_status','classificationAvailable',true,
     'classificationComplete',count(n.total)=count(*) and count(*)>0 and coalesce(sum(n.unclassified_count),0)=0,'complete',bool_and(n.complete),
     'coveredDays',count(*) filter(where n.complete),'expectedDays',v_yash_to-v_yash_from+1,
     'latestCollectedAt',max(n.updated_at),'durationBasis','source_submitted_to_handled')||
     case when v_view='auto' then jsonb_build_object('pendingCount',sum(n.pending_count),'unknownStatusCount',sum(n.unknown_count),
      'unclassifiedCount',sum(n.unclassified_count),'currencyUnknownCount',sum(n.currency_unknown_count)) else '{}'::jsonb end into v_yash_meta
    from jsonb_to_recordset(v_newar_days)n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
    where n.country=v_yash_item->>'country' and n.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')
     and n.data_date between v_yash_from and v_yash_to;
    v_yash_item:=v_yash_item||v_yash_meta;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then
   foreach v_yash_period in array array['totals','previousTotals'] loop
    if v_result->v_yash_period->'total'='null'::jsonb then
     v_result:=jsonb_set(v_result,array[v_yash_period,'unclassifiedCount'],'null'::jsonb);
    end if;
   end loop;
  end if;
 end if;
 return v_result;
end;$new$)
 )v(old_text,new_text) loop
  if (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 then raise exception 'newar_withdraw_patch_anchor_drift';end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure) is distinct from before_meta then raise exception 'newar_withdraw_metadata_changed';end if;
end;$patch$;
commit;
