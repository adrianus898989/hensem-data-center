-- Captured WG collector DDL only; no rows, keys, credentials or external fixture dependency.
-- BEGIN DETAILS
do $ddl$
declare tab text; biz text;
begin
  foreach biz in array array['recharge','withdraw'] loop
    tab := 'wg_' || biz || '_details';
    execute format($q$
      create table public.%I (
        system text not null check (system='WG'),
        country text not null check(country in ('BR','VN')),
        platform text not null,
        site_code text not null check(site_code in ('278','8311','12588','3257','3605')),
        business text not null check(business=%L),
        order_number text not null,
        third_order_number text,
        member_id text,
        provider text,
        channel text,
        utr text,
        status_code integer not null,
        status_group text not null check(status_group in ('pending','paying','success','failed','cancelled','rejected','forced','unknown')),
        created_at timestamptz not null,
        success_at timestamptz,
        updated_at timestamptz,
        operated_at timestamptz,
        completion_at_unverified timestamptz,
        captured_at timestamptz not null,
        member_currency text not null,
        member_unit_scale integer not null check(member_unit_scale in (1,1000)),
        member_amount_units numeric not null,
        member_amount numeric not null,
        settlement_currency text not null,
        settlement_amount numeric,
        settlement_fee numeric,
        exchange_rate numeric,
        source_fields jsonb not null,
        version_at timestamptz not null,
        content_hash text not null,
        stored_at timestamptz not null default clock_timestamp(),
        primary key(site_code,order_number),
        check(member_amount=member_amount_units*member_unit_scale),
        check(success_at is null or (business='recharge' and status_code=2 and success_at>=created_at)),
        check((business='recharge' and updated_at is not null and operated_at is null) or (business='withdraw' and updated_at is null))
      )
    $q$, tab, biz);
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public, anon, authenticated',tab);
    execute format('create index %I on public.%I(site_code,created_at desc,order_number desc)',tab||'_created',tab);
    execute format('create index %I on public.%I(site_code,status_group,created_at desc,order_number desc)',tab||'_status',tab);
    execute format('create index %I on public.%I(site_code,third_order_number) where third_order_number is not null',tab||'_third_order',tab);
    execute format('create index %I on public.%I(order_number)',tab||'_order',tab);
    if biz='recharge' then
      execute format('create index %I on public.%I(site_code,updated_at desc,order_number desc)',tab||'_updated',tab);
      execute format('create index %I on public.%I(site_code,success_at desc,order_number desc) where success_at is not null',tab||'_success',tab);
    else
      execute format('create index %I on public.%I(site_code,operated_at desc,order_number desc) where operated_at is not null',tab||'_operated',tab);
    end if;
  end loop;
end $ddl$;
-- END DETAILS

-- BEGIN CONFIG
create table if not exists public.wg_realtime_config_daily(
  country_code text not null check(country_code in ('BR','VN')),platform text not null,
  site_code text not null check(site_code in ('278','3257')),observed_local_date date not null,
  observed_at timestamptz not null,snapshot_id uuid not null unique,timezone text not null,
  parser_version text not null check(parser_version='wg-config-v1'),
  configuration jsonb not null check(jsonb_typeof(configuration)='object'),
  configuration_hash text not null,snapshot_hash text not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key(site_code,observed_local_date),
  check(observed_local_date=(observed_at at time zone timezone)::date)
);
alter table public.wg_realtime_config_daily enable row level security;
revoke all on public.wg_realtime_config_daily from public,anon,authenticated;
create index if not exists wg_realtime_config_recent on public.wg_realtime_config_daily(site_code,observed_at desc);
create or replace view public.wg_realtime_config_latest with(security_invoker=true) as
  select distinct on(site_code) * from public.wg_realtime_config_daily order by site_code,observed_at desc;
revoke all on public.wg_realtime_config_latest from public,anon,authenticated;

-- END CONFIG

-- BEGIN COVERAGE
create or replace view public.wg_detail_coverage with(security_invoker=true) as
  with ranges as (
    select site_code,business,basis,floor as started,cursor as finished from private.wg_detail_progress where cursor is not null
    union all
    select site_code,business,basis,range_start,cursor from private.wg_detail_history where cursor is not null
  ), previous as (
    select *,max(finished) over(partition by site_code,business,basis order by started,finished rows between unbounded preceding and 1 preceding) as previous_finish from ranges
  ), numbered as (
    select *,sum(case when previous_finish is null or started>previous_finish+1 then 1 else 0 end)
      over(partition by site_code,business,basis order by started,finished) as block from previous
  ), merged as (
    select site_code,business,basis,min(started) as started,max(finished) as finished,
      case when site_code in ('278','8311','12588') then 'America/Sao_Paulo' else 'Asia/Ho_Chi_Minh' end as tz
    from numbered group by site_code,business,basis,block
  ), days as (
    select m.*,d::date as business_date from merged m
    cross join lateral generate_series((to_timestamp(started) at time zone tz)::date::timestamp,
      (to_timestamp(finished) at time zone tz)::date::timestamp,interval '1 day') d
  )
  select site_code,business,basis,business_date,
    bool_or(started<=extract(epoch from business_date::timestamp at time zone tz)::bigint
      and finished>=extract(epoch from (business_date+1)::timestamp at time zone tz)::bigint-1) as complete
  from days group by site_code,business,basis,business_date;

-- END COVERAGE

-- BEGIN SNAPSHOT
create table public.wg_withdraw_midnight_runs (
  site_code text not null check(site_code in ('278','8311','12588','3257','3605')),
  scheduled_at timestamptz not null,
  snapshot_date date not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null check(status in ('capturing','complete','missed')),
  observed_started_at timestamptz,
  observed_finished_at timestamptz,
  owner uuid, run_id uuid, lease_until timestamptz,
  record_count integer,
  pages integer not null default 0,
  received integer not null default 0,
  primary key(site_code,scheduled_at),
  check((status='complete' and record_count is not null and observed_finished_at is not null)
    or (status<>'complete' and record_count is null))
);
create table public.wg_withdraw_midnight_items (
  site_code text not null,
  scheduled_at timestamptz not null,
  order_number text not null,
  safe_record jsonb not null,
  primary key(site_code,scheduled_at,order_number),
  foreign key(site_code,scheduled_at) references public.wg_withdraw_midnight_runs(site_code,scheduled_at)
);
create index wg_midnight_order_search on public.wg_withdraw_midnight_items(site_code,order_number,scheduled_at desc);
create index wg_midnight_completed on public.wg_withdraw_midnight_runs(snapshot_date desc,site_code) where status='complete';
alter table public.wg_withdraw_midnight_runs enable row level security;
alter table public.wg_withdraw_midnight_items enable row level security;
revoke all on public.wg_withdraw_midnight_runs,public.wg_withdraw_midnight_items from public,anon,authenticated;

-- END SNAPSHOT

