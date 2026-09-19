-- Read-only anomaly inputs plus an append-only future midnight observation archive.
-- No historical midnight values are reconstructed from mutable order status.
-- No cron, collector activation, or existing table/function mutation is performed.
begin;

create table public.provider_midnight_snapshots (
  snapshot_id uuid primary key,
  source_system text not null,
  country_code text not null,
  platform text not null,
  currency text not null,
  timezone text not null,
  scheduled_at timestamptz not null,
  observation_started_at timestamptz not null,
  captured_at timestamptz not null,
  snapshot jsonb not null,
  received_at timestamptz not null default now()
);
create index provider_midnight_scope_time_idx on public.provider_midnight_snapshots
  (country_code,platform,scheduled_at,currency,captured_at);
alter table public.provider_midnight_snapshots enable row level security;
revoke all on public.provider_midnight_snapshots from public,anon,authenticated,service_role;
grant select on public.provider_midnight_snapshots to service_role;

create function private.provider_midnight_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='MIDNIGHT_ARCHIVE_IMMUTABLE'; end;
$$;
create trigger provider_midnight_immutable before update or delete on public.provider_midnight_snapshots
  for each row execute function private.provider_midnight_immutable();
revoke all on function private.provider_midnight_immutable() from public,anon,authenticated;

create function private.anomaly_nonnegative_number(p_value jsonb,p_integer boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='number' then
    (p_value::text)::numeric between 0 and 9007199254740991
    and (not p_integer or trunc((p_value::text)::numeric)=(p_value::text)::numeric)
    else false end;
$$;
revoke all on function private.anomaly_nonnegative_number(jsonb,boolean) from public,anon,authenticated;

-- Only a trusted, separately authenticated collector receiver may call this.
-- Its receiver MUST authorize source/country/platform/timezone/currency against
-- the collector credential. This is not an anonymous ingestion endpoint.
create function public.publish_provider_midnight_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_old jsonb; v_key text; v_group jsonb; v_bucket jsonb;
  v_start timestamptz; v_at timestamptz; v_scheduled timestamptz;
  v_count numeric:=0; v_amount numeric:=0; v_gc numeric; v_ga numeric;
  v_bc numeric; v_ba numeric; v_index integer; v_bounds integer[]:=array[0,1,2,3,7];
  v_seen text[]:=array[]::text[]; v_name text; v_coverage jsonb;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>1048576
    or p_snapshot->'schema_version' is distinct from '1'::jsonb
    or exists (select 1 from jsonb_object_keys(p_snapshot) k where k <> all(array[
      'schema_version','snapshot_id','source_system','country_code','platform','currency','timezone',
      'scheduled_at','observation_started_at','captured_at','coverage','totals','groups'])) then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_PAYLOAD';
  end if;
  foreach v_key in array array['snapshot_id','source_system','country_code','platform','currency','timezone','scheduled_at','observation_started_at','captured_at'] loop
    if jsonb_typeof(p_snapshot->v_key) is distinct from 'string' or length(p_snapshot->>v_key) not between 1 and 100
      or p_snapshot->>v_key<>btrim(p_snapshot->>v_key) or p_snapshot->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023',message='MIDNIGHT_INVALID_DESCRIPTOR';
    end if;
  end loop;
  if p_snapshot->>'country_code' !~ '^[A-Z][A-Z_]{1,19}$' or p_snapshot->>'currency' !~ '^[A-Z]{3,8}$'
    or p_snapshot->>'source_system' !~ '^[A-Z][A-Z0-9_]{1,39}$'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_snapshot->>'timezone') then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_DESCRIPTOR';
  end if;
  foreach v_key in array array['scheduled_at','observation_started_at','captured_at'] loop
    if p_snapshot->>v_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='22023',message='MIDNIGHT_INVALID_TIME';
    end if;
  end loop;
  begin
    v_id:=(p_snapshot->>'snapshot_id')::uuid;
    v_start:=(p_snapshot->>'observation_started_at')::timestamptz;
    v_at:=(p_snapshot->>'captured_at')::timestamptz;
    v_scheduled:=(p_snapshot->>'scheduled_at')::timestamptz;
  exception when others then raise exception using errcode='22023',message='MIDNIGHT_INVALID_TIME'; end;
  if not isfinite(v_start) or not isfinite(v_at) or not isfinite(v_scheduled)
    or (v_scheduled at time zone (p_snapshot->>'timezone'))::time<>time '00:00'
    or v_start<v_scheduled or v_at<v_start or v_at>clock_timestamp()+interval '5 minutes'
    or v_start>=v_scheduled+interval '1 day' then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_TIME';
  end if;
  v_coverage:=p_snapshot->'coverage';
  if jsonb_typeof(v_coverage) is distinct from 'object'
    or jsonb_typeof(v_coverage->'complete') is distinct from 'boolean'
    or exists(select 1 from jsonb_object_keys(v_coverage) k where k<>all(array['complete','expected_count','fetched_count','unique_count']))
    or jsonb_typeof(p_snapshot->'totals') is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_snapshot->'totals') k where k<>all(array['pending_count','pending_amount']))
    or not private.anomaly_nonnegative_number(p_snapshot#>'{totals,pending_count}',true)
    or not private.anomaly_nonnegative_number(p_snapshot#>'{totals,pending_amount}') then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_COVERAGE';
  end if;
  foreach v_key in array array['expected_count','fetched_count','unique_count'] loop
    if not private.anomaly_nonnegative_number(v_coverage->v_key,true) then
      raise exception using errcode='22023',message='MIDNIGHT_INVALID_COVERAGE';
    end if;
  end loop;
  if v_coverage->'unique_count'<>p_snapshot#>'{totals,pending_count}'
    or (v_coverage->>'unique_count')::numeric>(v_coverage->>'fetched_count')::numeric
    or (v_coverage->'complete'='true'::jsonb and
      (v_coverage->'expected_count'<>v_coverage->'unique_count' or v_coverage->'fetched_count'<>v_coverage->'unique_count')) then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_COVERAGE';
  end if;
  if jsonb_typeof(p_snapshot->'groups') is distinct from 'array' or jsonb_array_length(p_snapshot->'groups')>2000 then
    raise exception using errcode='22023',message='MIDNIGHT_INVALID_GROUPS';
  end if;
  for v_group in select value from jsonb_array_elements(p_snapshot->'groups') loop
    if jsonb_typeof(v_group) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(v_group) k where k<>all(array['raw_channel','channel_type','currency','pending_count','pending_amount','age_buckets']))
      or jsonb_typeof(v_group->'raw_channel') is distinct from 'string' or length(btrim(v_group->>'raw_channel')) not between 1 and 120
      or jsonb_typeof(v_group->'channel_type') is distinct from 'string' or length(v_group->>'channel_type')>80
      or v_group->>'currency' is distinct from p_snapshot->>'currency'
      or not private.anomaly_nonnegative_number(v_group->'pending_count',true)
      or not private.anomaly_nonnegative_number(v_group->'pending_amount')
      or jsonb_typeof(v_group->'age_buckets') is distinct from 'array' or jsonb_array_length(v_group->'age_buckets')<>5 then
      raise exception using errcode='22023',message='MIDNIGHT_INVALID_GROUPS';
    end if;
    v_name:=jsonb_build_array(v_group->>'raw_channel',v_group->>'channel_type')::text;
    if v_name=any(v_seen) then raise exception using errcode='22023',message='MIDNIGHT_DUPLICATE_GROUP'; end if;
    v_seen:=array_append(v_seen,v_name); v_bc:=0; v_ba:=0; v_index:=1;
    for v_bucket in select value from jsonb_array_elements(v_group->'age_buckets') loop
      if jsonb_typeof(v_bucket) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(v_bucket) k where k<>all(array['min_days','max_days','count','amount']))
        or v_bucket->'min_days' is distinct from to_jsonb(v_bounds[v_index])
        or v_bucket->'max_days' is distinct from coalesce(to_jsonb(v_bounds[v_index+1]),'null'::jsonb)
        or not private.anomaly_nonnegative_number(v_bucket->'count',true)
        or not private.anomaly_nonnegative_number(v_bucket->'amount') then
        raise exception using errcode='22023',message='MIDNIGHT_INVALID_AGE_BUCKETS';
      end if;
      v_bc:=v_bc+(v_bucket->>'count')::numeric; v_ba:=v_ba+(v_bucket->>'amount')::numeric; v_index:=v_index+1;
    end loop;
    v_gc:=(v_group->>'pending_count')::numeric; v_ga:=(v_group->>'pending_amount')::numeric;
    if v_gc<>v_bc or v_ga<>v_ba then raise exception using errcode='22023',message='MIDNIGHT_AGE_TOTAL_MISMATCH'; end if;
    v_count:=v_count+v_gc; v_amount:=v_amount+v_ga;
  end loop;
  if v_count<>(p_snapshot#>>'{totals,pending_count}')::numeric or v_amount<>(p_snapshot#>>'{totals,pending_amount}')::numeric then
    raise exception using errcode='22023',message='MIDNIGHT_TOTAL_MISMATCH';
  end if;
  insert into public.provider_midnight_snapshots(snapshot_id,source_system,country_code,platform,currency,timezone,scheduled_at,observation_started_at,captured_at,snapshot)
    values(v_id,p_snapshot->>'source_system',p_snapshot->>'country_code',p_snapshot->>'platform',p_snapshot->>'currency',p_snapshot->>'timezone',v_scheduled,v_start,v_at,p_snapshot)
    on conflict(snapshot_id) do nothing;
  select snapshot into v_old from public.provider_midnight_snapshots where snapshot_id=v_id;
  if v_old is distinct from p_snapshot then raise exception using errcode='23505',message='MIDNIGHT_ID_REUSE'; end if;
  return jsonb_build_object('ok',true,'snapshot_id',v_id,'verified',v_coverage->'complete'='true'::jsonb and v_at<=v_scheduled+interval '5 minutes');
end;
$$;
revoke all on function public.publish_provider_midnight_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.publish_provider_midnight_snapshot(jsonb) to service_role;

create function private.dashboard_provider_anomaly_inputs(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb; v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  if public.dashboard_has_permission('third_party') is not true then raise exception using errcode='42501',message='没有三方查询权限'; end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>30 then
    raise exception using errcode='22023',message='请选择最多31天的日期范围';
  end if;
  v_scope:=private.dashboard_current_data_scope();
  with platforms as materialized (
    select g.id,g.platform_name as platform,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country
    from public.game66_platforms g
    where g.team_code in ('hong_kong','red_crab','in','IN')
      and private.dashboard_scope_allows(v_scope,case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
  ), created as (
    select p.country,p.platform,coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,
      count(*) as sample,count(*) filter(where c.status_code='1') as succeeded,
      sum(coalesce(c.amount_display,c.amount_minor/100.0)) filter(where c.status_code='1') as amount,
      max(c.last_seen_at) as latest_at
    from platforms p join public.game66_charge_orders c on c.platform_id=p.id
    where c.create_time >= p_start::timestamp at time zone 'Asia/Kolkata'
      and c.create_time < (p_end+1)::timestamp at time zone 'Asia/Kolkata'
    group by p.country,p.platform,coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道')
  ), delays as (
    select p.country,p.platform,coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,
      extract(epoch from c.pay_time-c.create_time) as seconds,c.last_seen_at,
      c.create_time is not null and isfinite(c.create_time) and isfinite(c.pay_time) and c.pay_time>=c.create_time as valid
    from platforms p join public.game66_charge_orders c on c.platform_id=p.id
    where c.status_code='1' and c.pay_time >= p_start::timestamp at time zone 'Asia/Kolkata'
      and c.pay_time < (p_end+1)::timestamp at time zone 'Asia/Kolkata'
  ), delay_groups as (
    select country,platform,provider,count(*) filter(where valid) as sample,count(*) filter(where not valid) as invalid,
      max(last_seen_at) as latest_at,
      jsonb_build_array(count(*) filter(where valid and seconds<60),count(*) filter(where valid and seconds>=60 and seconds<300),
        count(*) filter(where valid and seconds>=300 and seconds<600),count(*) filter(where valid and seconds>=600 and seconds<1800),
        count(*) filter(where valid and seconds>=1800 and seconds<3600),count(*) filter(where valid and seconds>=3600 and seconds<21600),
        count(*) filter(where valid and seconds>=21600 and seconds<86400),count(*) filter(where valid and seconds>=86400 and seconds<172800),
        count(*) filter(where valid and seconds>=172800)) as buckets
    from delays group by country,platform,provider
  ), detail_rows as (
    select coalesce(c.country,d.country) as country,coalesce(c.platform,d.platform) as platform,coalesce(c.provider,d.provider) as provider,
      c.sample as created_sample,c.succeeded,c.amount,
      sum(c.amount) over(partition by c.country,c.platform) as observed_total_amount,
      d.sample as delay_sample,d.invalid as invalid_delay_count,d.buckets as delay_buckets,greatest(c.latest_at,d.latest_at) as latest_at
    from created c full join delay_groups d using(country,platform,provider)
  ), success_snapshots as (
    -- RECHARGE_REVIEW is the verified charge cohort contract. Other producers
    -- remain excluded until their dataset contract is explicitly proven.
    select s.country_code as country,s.platform,s.stat_date as date,s.snapshot_at,
      s.snapshot->>'timezone' as timezone,s.snapshot->'coverage' as coverage,s.snapshot->'totals' as totals,s.snapshot->'groups' as groups
    from public.collection_success_daily s where s.source_system='RECHARGE_REVIEW' and s.stat_date between p_start and p_end
      and s.country_code in ('IN','HK_TEAM','RED_CRAB') and private.dashboard_scope_allows(v_scope,s.country_code,s.platform)
  ), midnight as (
    select s.snapshot,s.source_system,s.country_code as country,s.platform,s.currency,s.timezone,
      (s.scheduled_at at time zone s.timezone)::date as date,s.scheduled_at,s.observation_started_at,s.captured_at,
      (s.snapshot#>'{coverage,complete}'='true'::jsonb and s.captured_at<=s.scheduled_at+interval '5 minutes') as verified
    from public.provider_midnight_snapshots s
    where s.scheduled_at>=(p_start-1)::timestamptz and s.scheduled_at<(p_end+2)::timestamptz
      and (s.scheduled_at at time zone s.timezone)::date between p_start and p_end
      and s.country_code in ('IN','HK_TEAM','RED_CRAB') and private.dashboard_scope_allows(v_scope,s.country_code,s.platform)
  ) select jsonb_build_object('version',1,'generatedAt',now(),'startDate',p_start,'endDate',p_end,
      'detailRows',coalesce((select jsonb_agg(to_jsonb(d)) from detail_rows d),'[]'::jsonb),
      'successSnapshots',coalesce((select jsonb_agg(to_jsonb(s)) from success_snapshots s),'[]'::jsonb),
      'midnightSnapshots',coalesce((select jsonb_agg(to_jsonb(m)) from midnight m),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(jsonb_build_object('country',country,'platform',platform,'timezone','Asia/Kolkata')) from platforms),'[]'::jsonb),
      'limitations',jsonb_build_array('DETAIL_COLLECTION_COVERAGE_NOT_RECORDED','CUSTOMER_PAYMENT_TIME_UNAVAILABLE','MIDNIGHT_HISTORY_NOT_RECONSTRUCTED','OTHER_SUCCESS_PRODUCERS_EXCLUDED')) into v_result;
  if octet_length(v_result::text)>8388608 then raise exception using errcode='54000',message='异常查询结果过大，请缩短日期范围'; end if;
  return v_result;
end;
$$;
create function public.dashboard_provider_anomaly_inputs(p_start date,p_end date)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_provider_anomaly_inputs(p_start,p_end);
$$;
revoke all on function private.dashboard_provider_anomaly_inputs(date,date),public.dashboard_provider_anomaly_inputs(date,date) from public,anon;
grant execute on function private.dashboard_provider_anomaly_inputs(date,date),public.dashboard_provider_anomaly_inputs(date,date) to authenticated;
notify pgrst,'reload schema';
commit;
