CREATE OR REPLACE FUNCTION private.dashboard_admin_newar_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, pending_count bigint, unknown_count bigint, unclassified_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, currencies jsonb, currency_unknown_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
 ), business as materialized (
  select s.country,s.platform_key,n.source_id,n.status_group,n.currency,n.captured_at,n.received_at,
   (n.created_at at time zone s.timezone)::date local_date,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end method,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
    then btrim(r."operatorName") else '（未知操作人）' end account,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceSubmittedAt") end submitted_at,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceHandledAt") end handled_at
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset='withdraw'
  cross join lateral jsonb_to_record(case when jsonb_typeof(n.raw)='object' then n.raw else '{}'::jsonb end)
   r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
     "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
  where n.created_at>=p_start::timestamp at time zone s.timezone and n.created_at<(p_end+1)::timestamp at time zone s.timezone
   and (s.launch_at is null or n.created_at>=s.launch_at)
 ), facts as materialized (
  select country,platform_key,source_id,status_group,currency,captured_at,received_at,local_date,method,account,
   case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
    and handled_at<=captured_at and handled_at<=statement_timestamp()
    then extract(epoch from handled_at-submitted_at) end processing_seconds
  from business
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
$function$

