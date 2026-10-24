CREATE OR REPLACE FUNCTION private.dashboard_health_lg_runs_batch(p_feeds jsonb, p_asof timestamptz, p_scope jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
declare targets jsonb;result jsonb;
begin
 with authorized as materialized(
  select f from jsonb_array_elements(p_feeds)f
  where(f->>'dataset'='lg_orders' or(f->>'dataset'='orders' and f->>'system'='lg' and f?'timezone'))
   and private.dashboard_scope_allows(p_scope,f->>'country',f->>'rawPlatform')is true
 ),zoned as materialized(
  select f,private.dashboard_health_feed_timezone(f)zone from authorized
 ),dated as materialized(
  select f,(p_asof at time zone zone)::date today,nullif(f->>'firstDate','')::date first_day
  from zoned where zone is not null
 ),wanted as materialized(
  select distinct f->>'rawCountry'country_code,f->>'rawPlatform'platform,
   case direction when 'charge' then 'recharge' else 'withdraw' end order_kind,
   greatest(today-7,coalesce(first_day,today-7)) first_day,today end_day
  from dated cross join lateral jsonb_array_elements_text(case when jsonb_array_length(coalesce(f->'directions','[]'::jsonb))=0 then '["unknown"]'::jsonb else f->'directions'end)d(direction)
  where direction is distinct from 'unknown' and greatest(today-7,coalesce(first_day,today-7))<today
 )select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb)into targets from wanted w;
 if jsonb_array_length(targets)=0 then return '{}'::jsonb;end if;
 with wanted as materialized(select * from jsonb_to_recordset(targets)w(country_code text,platform text,order_kind text,first_day date,end_day date)),selected as materialized(
  -- One semijoin over run metadata; never scan transaction order details here.
  select t.country_code,t.platform,t.order_kind,t.stat_date,t.observed_at,t.status,t.sync_mode,
   t.expected_count,t.fetched_count,t.published_at
  from public.lg_sync_runs t where exists(select 1 from wanted w
   where w.country_code=t.country_code and w.platform=t.platform and w.order_kind=t.order_kind
    and t.stat_date>=w.first_day and t.stat_date<w.end_day)
 ),latest as(
  select distinct on(country_code,platform,order_kind,stat_date)*,
   count(*)over(partition by country_code,platform,order_kind,stat_date,observed_at)latest_ties
  from selected order by country_code,platform,order_kind,stat_date,observed_at desc
 ),groups as(
  select jsonb_build_array(country_code,platform,order_kind)::text key,
   jsonb_agg(jsonb_build_object('stat_date',stat_date,'status',status,'sync_mode',sync_mode,
    'expected_count',expected_count,'fetched_count',fetched_count,'published_at',published_at,
    'latest_ties',latest_ties)order by stat_date) value
  from latest group by country_code,platform,order_kind
 )select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)into result from groups;
 return result;
end;
$function$;
