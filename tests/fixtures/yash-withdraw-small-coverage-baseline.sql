CREATE OR REPLACE FUNCTION private.dashboard_admin_yash_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, failed_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with sites as materialized (
  select p.name,p.country,p.source_name,p.timezone,private.dashboard_admin_live_withdraw_key(p.name) platform_key
  from private.dashboard_admin_live_platforms() p
  where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET'
   and private.dashboard_scope_allows(p_scope,'IN','YASH.BET')
   and (case when p_request ? 'scopeTargets' then exists(
     select 1 from jsonb_array_elements(p_request->'scopeTargets') t where t->>'country'=p.country
      and exists(select 1 from jsonb_array_elements_text(t->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
    else p_request->>'country'=p.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(p.name))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
 ), orders as materialized (
  select y.*,s.name display_platform,s.country display_country,s.platform_key,(y.created_at at time zone 'Asia/Kolkata')::date local_date,
   private.dashboard_admin_yash_status(y.order_type,y.status) status_group,
   case when private.dashboard_admin_yash_status(y.order_type,y.status)='success'
    and isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(y.observed_at)
    and y.completed_at>=y.created_at and y.completed_at<=y.observed_at and y.completed_at<=statement_timestamp()
    then extract(epoch from y.completed_at-y.created_at) end processing_seconds
  from sites s join private.yash_orders y on y.source_site='yash' and y.order_type='withdrawal'
  where y.created_at>=p_start::timestamp at time zone 'Asia/Kolkata' and y.created_at<(p_end+1)::timestamp at time zone 'Asia/Kolkata'
 ), days as materialized (
  select s.*,d::date local_date,private.dashboard_admin_yash_day_evidence('IN','YASH.BET','withdraw',d::date) evidence
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ), operators as (
  select local_date,coalesce(nullif(btrim(operator),''),'（未知操作人）') account,
   count(*) processed,count(*) filter(where status_group='success') success,count(*) filter(where status_group='rejected') rejected,
   count(*) filter(where status_group='pending') pending_count,count(*) filter(where status_group='failed') failed_count,count(*) filter(where status_group='unknown') unknown_count,
   max(observed_at) source_updated_at,max(received_at) updated_at,
   count(processing_seconds) duration_sample_count,sum(processing_seconds) duration_total_seconds,avg(processing_seconds) avg_seconds
  from orders group by 1,2
 )
 select d.local_date,d.country,d.name,d.platform_key,
  case when count(o.order_no)>0 or (d.evidence->>'complete')::boolean then count(o.order_no) end,
  count(o.order_no) filter(where o.status_group='success'),count(o.order_no) filter(where o.status_group='rejected'),
  count(o.order_no) filter(where o.status_group='pending'),count(o.order_no) filter(where o.status_group='failed'),count(o.order_no) filter(where o.status_group='unknown'),
  avg(o.processing_seconds),count(o.processing_seconds),sum(o.processing_seconds),
  max(o.observed_at),greatest(max(o.received_at),(d.evidence->>'seen')::timestamptz),(d.evidence->>'complete')::boolean,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.account) from operators r where r.local_date=d.local_date),'[]'::jsonb)
 from days d left join orders o on o.local_date=d.local_date
 group by d.local_date,d.country,d.name,d.platform_key,d.evidence;
$function$
