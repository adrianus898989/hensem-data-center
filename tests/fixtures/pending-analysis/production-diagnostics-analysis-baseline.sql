-- Read-only production function definition. No user data or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_pending_analysis(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();
 v_catalog jsonb;v_backlogs jsonb;v_provider_map jsonb;v_timezones text[];v_day_backlogs jsonb;v_baseline jsonb;v_archive_id uuid;
 v_start date;v_end date;v_date date;v_request jsonb;v_day jsonb;v_daily jsonb:='[]'::jsonb;
 v_row jsonb;v_key text;v_head public.withdraw_pending_backlog_daily%rowtype;
 v_scope_group text;v_providers text[]:='{}';v_count bigint;v_amount numeric;v_amount_valid boolean;v_identity_valid boolean;
 v_groups jsonb;v_expected_groups jsonb;v_stats jsonb;v_platforms jsonb:='[]';v_missing jsonb:='[]';
 v_buckets jsonb;v_aging jsonb;v_available boolean;v_coverage_complete boolean;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['startDate','endDate','platformIds','providers']))
  or jsonb_typeof(p_request->'startDate') is distinct from 'string'
  or jsonb_typeof(p_request->'endDate') is distinct from 'string'
  or p_request->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or p_request->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_request->'platformIds') is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 begin v_start:=(p_request->>'startDate')::date;v_end:=(p_request->>'endDate')::date;
 exception when others then raise exception using errcode='22023',message='invalid_date';end;
 if v_start<date '2000-01-01' or v_end>current_date+1 or v_end<v_start or v_end-v_start>30
  or to_char(v_start,'YYYY-MM-DD')<>p_request->>'startDate'
  or to_char(v_end,'YYYY-MM-DD')<>p_request->>'endDate' then
  raise exception using errcode='22023',message='invalid_date_range';
 end if;
 -- Existing single-day adapter validates authorized IDs, providers, currency,
 -- source identity, snapshot coverage and aliases. Never sum overlapping days.
 v_request:=(p_request-array['startDate','endDate']);
 -- Resolve authorization, aliases and currency once for the entire request.
 v_catalog:=private.dashboard_admin_pending_resolve(v_request||jsonb_build_object('date',v_end),v_scope);
 -- Read only selected identities across the bounded window, including the
 -- comparison baseline. Keep ambiguous raw identities for the original guard.
 v_backlogs:=private.dashboard_admin_pending_capture_heads(v_catalog,v_scope,greatest(date '2000-01-01',v_start-1),v_end);
 -- Resolve the timezone catalogue once for the whole request, then retain
 -- the original snapshot checks against only those validated timezone names.
 select coalesce(array_agg(t.name),'{}') into v_timezones
 from pg_catalog.pg_timezone_names t where t.name in
  (select distinct x->>'timezone' from jsonb_array_elements(v_catalog)x);
 -- Canonicalization is expensive even with an indexed registry: each call
 -- invokes the complete alias function. Deduplicate exact country/platform/
 -- original-channel tuples across daily rows AND the comparison baseline.
 with provider_keys as materialized(
  select distinct p->>'country' country,b->>'platform' platform,g->>'raw_channel' raw_channel
  from jsonb_array_elements(v_catalog)p join jsonb_array_elements(v_backlogs)b
   on b->>'country_code'=p->>'scope_group'
    and private.dashboard_admin_pending_platform_key(b->>'country_code',b->>'platform')=p->>'platform_key'
  cross join lateral jsonb_array_elements(case when jsonb_typeof(b#>'{snapshot,groups}')='array'
   then b#>'{snapshot,groups}' else '[]'::jsonb end)g
  where p->>'source'in('ar','newar','withdraw')
   and jsonb_typeof(g->'raw_channel')='string'
   and public.collection_success_safe_descriptor(g->>'raw_channel',96)
 ), providers as materialized(
  select country,platform,raw_channel,
   private.dashboard_admin_live_provider_canonical(country,platform,raw_channel) provider from provider_keys
 )select coalesce(jsonb_object_agg(jsonb_build_array(country,platform,raw_channel)::text,provider),'{}')
 into v_provider_map from providers;

 for v_date in select generate_series(greatest(date '2000-01-01',v_start-1),v_end,interval '1 day')::date loop
  select coalesce(jsonb_agg(b),'[]'::jsonb) into v_day_backlogs
   from jsonb_array_elements(v_backlogs)b where b->>'stat_date'=v_date::text;
  v_day:=private.dashboard_admin_pending_observation(private.dashboard_admin_pending_resolved_day_cached(
   v_request||jsonb_build_object('date',v_date),v_scope,v_catalog,v_day_backlogs,v_provider_map,v_timezones));
  v_day:=private.dashboard_admin_pending_capture_day(v_day,v_catalog,v_day_backlogs);
  if v_date<v_start then v_baseline:=v_day;else v_daily:=v_daily||jsonb_build_array(v_day);end if;
 end loop;
 -- Historical details are replaced by later collector partitions. Only exact
 -- capture-matched details can describe age, never latest status or now().
 if p_request ? 'providers' then
  select coalesce(array_agg(value),'{}') into v_providers from jsonb_array_elements_text(p_request->'providers');
 end if;
 for v_row in select value from jsonb_array_elements(v_day->'rows') loop
  if v_row->>'state'<>'complete' then
   v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name',
    'state',v_row->>'state','expectedCount',v_row->'count','expectedAmount',v_row->'amount',
    'matchedCount',null,'unknownCount',null,'unknownAmount',null,'count',null,'amount',null,
    'over24Count',null,'over24Amount',null,'maxHours',null,'avgHours',null,'groups','[]'::jsonb,'buckets','[]'::jsonb));
   v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state',v_row->>'state'));
   continue;
  end if;
  -- WG_EXISTING_FEEDS_V1
  if v_row->>'source'='wg' then
   v_stats:=v_row->'wgAging';
   if jsonb_typeof(v_stats)='object' and not(v_stats?'thresholds') then
    v_stats:=v_stats||jsonb_build_object('thresholds',jsonb_build_array(jsonb_build_object(
     'minHours',24,'count',v_stats->'over24Count','amount',v_stats->'over24Amount')));
   end if;
   if jsonb_typeof(v_stats)='object' then
    v_platforms:=v_platforms||jsonb_build_array(v_stats||jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','complete',
     'expectedCount',v_row->'count','expectedAmount',v_row->'amount','snapshotAt',v_row->'snapshotAt'));
   else
    v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','detail_unavailable','groups','[]'::jsonb,'buckets','[]'::jsonb));
    v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','detail_unavailable'));
   end if;
   continue;
  end if;
  v_scope_group:=v_row->>'scopeGroup';
  -- Reconstruct the same unambiguous authorized source mapping used by the
  -- single-day response; a displayed native/report alias is not a new source.
  select coalesce(min(private.dashboard_admin_pending_platform_key(v_scope_group,t.source_platform)),
    private.dashboard_admin_pending_platform_key(v_scope_group,v_row->>'sourceName')) into v_key
  from public.dashboard_platform_team_map t
  where t.active and t.country_code=v_scope_group and private.dashboard_scope_allows(v_scope,t.country_code,t.source_platform)
   and (v_row->>'team' is null or t.team_name=v_row->>'team')
   and (private.dashboard_admin_pending_platform_key(v_scope_group,t.source_platform)=private.dashboard_admin_pending_platform_key(v_scope_group,v_row->>'sourceName')
    or private.dashboard_admin_pending_platform_key(v_scope_group,t.platform_name)=private.dashboard_admin_pending_platform_key(v_scope_group,v_row->>'name'));
  select b.* into v_head from jsonb_populate_recordset(null::public.withdraw_pending_backlog_daily,v_day_backlogs)b
  where b.source_system='WITHDRAW_REVIEW' and b.country_code=v_scope_group and b.stat_date=v_end
   and private.dashboard_admin_pending_platform_key(b.country_code,b.platform)=v_key
   and b.snapshot_at=(v_row->>'snapshotAt')::timestamptz and private.dashboard_scope_allows(v_scope,b.country_code,b.platform);
  v_count:=null;v_amount:=null;v_amount_valid:=false;v_identity_valid:=false;v_stats:=null;v_groups:=null;v_expected_groups:=null;
  if found then
   select nullif(b->>'archive_id','')::uuid into v_archive_id from jsonb_array_elements(v_day_backlogs)b
    where b->>'source_system'=v_head.source_system and b->>'country_code'=v_head.country_code
     and b->>'platform'=v_head.platform and(b->>'stat_date')::date=v_head.stat_date
     and(b->>'snapshot_at')::timestamptz=v_head.snapshot_at
     and(b->>'window_start')::date=v_head.window_start and(b->>'window_end')::date=v_head.window_end;
   select coalesce(jsonb_agg(jsonb_build_object('rawChannel',g->>'raw_channel','channelType',g->>'channel_type',
    'count',(g->>'pending_count')::bigint,'amount',(g->>'pending_amount')::numeric)
    order by g->>'raw_channel',g->>'channel_type'),'[]') into v_expected_groups
    from jsonb_array_elements(v_head.snapshot->'groups') g
    where not ((g->>'pending_count')::bigint=0 and (g->>'pending_amount')::numeric=0);
   with raw_observed as materialized (
    select o.order_no,o.amount,o.raw_channel,o.channel_type,
     case when o.status='已提交' and o.timezone=v_head.snapshot->>'timezone'
       and o.applied_at is not null and isfinite(o.applied_at) and o.applied_at::date=o.stat_date
       and (o.applied_at at time zone (v_head.snapshot->>'timezone'))<=v_head.snapshot_at
      then extract(epoch from v_head.snapshot_at-(o.applied_at at time zone (v_head.snapshot->>'timezone')))/3600 end as hours
    from(
     select o.order_no,o.amount,o.raw_channel,o.channel_type,o.status,o.timezone,o.applied_at,o.stat_date
     from private.withdraw_pending_capture_orders o
     where v_archive_id is not null and o.archive_id=v_archive_id
      and o.source_system=v_head.source_system and o.country_code=v_head.country_code and o.platform=v_head.platform
      and o.stat_date between v_head.window_start and v_head.window_end and o.snapshot_at=v_head.snapshot_at
     union all
     select o.order_no,o.amount,o.raw_channel,o.channel_type,o.status,o.timezone,o.applied_at,o.stat_date
     from public.withdraw_pending_orders o join public.withdraw_pending_daily d
      on d.source_system=o.source_system and d.country_code=o.country_code and d.platform=o.platform
       and d.stat_date=o.stat_date and d.snapshot_id=o.snapshot_id and d.snapshot_at=o.snapshot_at
     where v_archive_id is null and o.source_system=v_head.source_system and o.country_code=v_head.country_code and o.platform=v_head.platform
      and o.stat_date between v_head.window_start and v_head.window_end and o.snapshot_at=v_head.snapshot_at
    )o
   ), detail_provider_keys as materialized (
    select distinct raw_channel from raw_observed
   ), detail_providers as materialized (
    select raw_channel,case when v_provider_map?jsonb_build_array(v_row->>'country',v_head.platform,raw_channel)::text
     then v_provider_map->>jsonb_build_array(v_row->>'country',v_head.platform,raw_channel)::text
     else private.dashboard_admin_live_provider_canonical(v_row->>'country',v_head.platform,raw_channel)end provider
    from detail_provider_keys
   ), observed as materialized (
    select o.*,p.provider from raw_observed o join detail_providers p
     on p.raw_channel is not distinct from o.raw_channel
   ), full_groups as (
    select raw_channel,channel_type,count(*)::bigint n,sum(amount) amount from observed group by 1,2
   ), selected as materialized (
    select * from observed where cardinality(v_providers)=0 or provider=any(v_providers)
   ), threshold_keys(min_hours) as(values(24),(48),(72),(168)),
   threshold_totals as (
    select t.min_hours,count(s.hours)::bigint n,coalesce(sum(s.amount),0) amount
    from threshold_keys t left join selected s on s.hours>=t.min_hours group by t.min_hours
   ), provider_thresholds as (
    select s.provider,t.min_hours,count(*)filter(where s.hours>=t.min_hours)::bigint n,
      coalesce(sum(s.amount)filter(where s.hours>=t.min_hours),0) amount
    from selected s cross join threshold_keys t group by s.provider,t.min_hours
   ), age_groups as (
    select provider,count(*)::bigint as matched_count,count(*) filter(where hours is null)::bigint as unknown_count,
     coalesce(sum(amount) filter(where hours is null),0) unknown_amount,
     count(hours)::bigint as n,coalesce(sum(amount) filter(where hours is not null),0) amount,
     count(*) filter(where hours>=24)::bigint as over24_count,coalesce(sum(amount) filter(where hours>=24),0) as over24_amount,
     max(hours) max_hours,avg(hours) avg_hours
    from selected group by provider
   ), bucket_keys(key,label,min_hours,max_hours) as (values
    (0,'<1小时',0::numeric,1::numeric),(1,'1–3小时',1,3),(2,'3–6小时',3,6),(3,'6–12小时',6,12),
    (4,'12–24小时',12,24),(5,'24–48小时',24,48),(6,'48–72小时',48,72),(7,'≥72小时',72,null)),
   buckets as (
    select b.key,b.label,count(s.hours)::bigint n,coalesce(sum(s.amount),0) amount
    from bucket_keys b left join selected s on s.hours>=b.min_hours and (b.max_hours is null or s.hours<b.max_hours)
    group by b.key,b.label
   )
   select (select count(*) from observed),(select coalesce(sum(amount),0) from observed),
    (select coalesce(bool_and(amount is not null and amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),true) from observed),
    (select count(distinct order_no)=count(*) and coalesce(bool_and(nullif(btrim(order_no),'') is not null),true) from observed),
    (select coalesce(jsonb_agg(jsonb_build_object('rawChannel',raw_channel,'channelType',channel_type,'count',n,'amount',amount)
      order by raw_channel,channel_type),'[]') from full_groups),
    jsonb_build_object('matchedCount',count(*),'unknownCount',count(*) filter(where hours is null),
     'unknownAmount',coalesce(sum(amount) filter(where hours is null),0)::text,
     'count',count(hours),'amount',coalesce(sum(amount) filter(where hours is not null),0)::text,
     'over24Count',count(*) filter(where hours>=24),'over24Amount',coalesce(sum(amount) filter(where hours>=24),0)::text,
     'maxHours',max(hours),'avgHours',avg(hours),
     'thresholds',(select jsonb_agg(jsonb_build_object('minHours',min_hours,'count',n,'amount',amount::text)order by min_hours)from threshold_totals),
     'groups',(select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'matchedCount',matched_count,'unknownCount',unknown_count,
       'unknownAmount',unknown_amount::text,'count',n,'amount',amount::text,'over24Count',over24_count,'over24Amount',over24_amount::text,
       'maxHours',max_hours,'avgHours',avg_hours,
       'thresholds',(select jsonb_agg(jsonb_build_object('minHours',t.min_hours,'count',t.n,'amount',t.amount::text)order by t.min_hours)
          from provider_thresholds t where t.provider=g.provider)) order by n desc,provider),'[]') from age_groups g),
     'buckets',(select jsonb_agg(jsonb_build_object('key',key,'label',label,'count',n,'amount',amount::text) order by key) from buckets))
   into v_count,v_amount,v_amount_valid,v_identity_valid,v_groups,v_stats from selected;
  end if;
  if v_count is null or not v_amount_valid or not v_identity_valid or v_count<>(v_head.snapshot#>>'{totals,pending_count}')::bigint
   or v_amount<>(v_head.snapshot#>>'{totals,pending_amount}')::numeric or v_groups is distinct from v_expected_groups then
   v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name',
    'state','detail_unavailable','expectedCount',v_row->'count','expectedAmount',v_row->'amount',
    'matchedCount',null,'unknownCount',null,'unknownAmount',null,'count',null,'amount',null,
    'over24Count',null,'over24Amount',null,'maxHours',null,'avgHours',null,'groups','[]'::jsonb,'buckets','[]'::jsonb));
   v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','detail_unavailable'));
  else
   v_platforms:=v_platforms||jsonb_build_array(v_stats||jsonb_build_object('id',v_row->>'id','name',v_row->>'name',
    'state',case when (v_stats->>'unknownCount')::bigint>0 then 'metadata_incomplete' else 'complete' end,
    'expectedCount',v_row->'count','expectedAmount',v_row->'amount','snapshotAt',v_row->'snapshotAt'));
  end if;
 end loop;
 v_available:=exists(select 1 from jsonb_array_elements(v_platforms) p where p->>'state' in ('complete','metadata_incomplete'));
 v_coverage_complete:=(v_day->>'complete')::boolean and jsonb_array_length(v_missing)=0;
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'count',n,'amount',amount::text) order by key),'[]') into v_buckets
 from (select (b->>'key')::int key,min(b->>'label') label,sum((b->>'count')::bigint)::bigint n,sum((b->>'amount')::numeric) amount
  from jsonb_array_elements(v_platforms) p cross join lateral jsonb_array_elements(p->'buckets') b group by 1) b;
 select jsonb_build_object('available',v_available,'coverageComplete',v_coverage_complete,
  'complete',v_coverage_complete and coalesce(sum((p->>'unknownCount')::bigint),0)=0,
  'basis','source_snapshot_age','snapshotDate',v_end,'expectedCount',v_day->'count','expectedAmount',v_day->'amount',
  'matchedCount',case when v_available then coalesce(sum((p->>'matchedCount')::bigint),0) end,
  'unknownCount',case when v_available then coalesce(sum((p->>'unknownCount')::bigint),0) end,
  'unknownAmount',case when v_available then coalesce(sum((p->>'unknownAmount')::numeric),0)::text end,
  'count',case when v_available then coalesce(sum((p->>'count')::bigint),0) end,
  'amount',case when v_available then coalesce(sum((p->>'amount')::numeric),0)::text end,
  'over24Count',case when v_available then coalesce(sum((p->>'over24Count')::bigint),0) end,
  'over24Amount',case when v_available then coalesce(sum((p->>'over24Amount')::numeric),0)::text end,
  'maxHours',max((p->>'maxHours')::numeric),
  'avgHours',sum((p->>'avgHours')::numeric*(p->>'count')::bigint)/nullif(sum((p->>'count')::bigint),0),
  'thresholds',(select jsonb_agg(jsonb_build_object('minHours',q.min_hours,'count',q.n,'amount',q.a)order by q.min_hours)
   from(select k.min_hours,
     case when count(t.value)=count(*) and count(*)>0 and bool_and(t.value->>'count' is not null) then sum((t.value->>'count')::bigint)end n,
     case when count(t.value)=count(*) and count(*)>0 and bool_and(t.value->>'amount' is not null) then sum((t.value->>'amount')::numeric)::text end a
    from(values(24),(48),(72),(168))k(min_hours)
    left join jsonb_array_elements(v_platforms)p on p->>'state'in('complete','metadata_incomplete')
    left join lateral(select x value from jsonb_array_elements(coalesce(p->'thresholds','[]'::jsonb))x
      where (x->>'minHours')::int=k.min_hours)t on true group by k.min_hours)q),
  'buckets',v_buckets,'platforms',v_platforms,'missingPlatforms',v_missing)
 into v_aging from jsonb_array_elements(v_platforms) p;
 return jsonb_build_object('version',1,'basis','seven_day_pending_snapshot','startDate',v_start,'endDate',v_end,
  'daily',v_daily,'baseline',v_baseline,'aging',v_aging);
end;
$function$;

revoke all on function private.dashboard_admin_live_pending_analysis(jsonb) from public,anon,service_role;
grant execute on function private.dashboard_admin_live_pending_analysis(jsonb) to authenticated;
