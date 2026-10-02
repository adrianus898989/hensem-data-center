-- Preserve complete ACTUAL observations without changing collector requests or ACKs.
-- This is a seven-creation-day observation archive, not proof of all open orders
-- or a reconstructed historical midnight. No collector, cron, deletion, or key
-- change is included. Existing primary tables keep their current semantics.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $preflight$
declare r record; f pg_proc%rowtype;
begin
  for r in select * from (values
    ('public.publish_withdraw_pending_details(text,jsonb,jsonb)','b89cbb48b69d781ccb26073d8318be18','099075a8a800ad9669087317145e8092'),
    ('public.publish_withdraw_pending_snapshot(text,jsonb)','c4b8844411db4b298b7d3fde909e6e7a','fe86a5985aaf7e039a4233313e2b641a'),
    ('public.refresh_withdraw_pending_backlog()','9ab44edff8c8e6c84448e4f861d48178','c662075ceb662004f1f5960e82f7a5bd')
  ) x(signature,definition_hash,body_hash) loop
    select * into f from pg_proc where oid=to_regprocedure(r.signature);
    if not found or md5(pg_get_functiondef(f.oid))<>r.definition_hash or md5(f.prosrc)<>r.body_hash
      or f.prosecdef or f.provolatile<>'v' or pg_get_userbyid(f.proowner)<>'postgres'
      or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
      then raise exception 'pending_capture_source_contract_drift: %',r.signature; end if;
  end loop;
  if to_regclass('private.collector_platform_identities') is null
    or to_regclass('public.dashboard_platform_team_map') is null
    or to_regclass('private.withdraw_pending_capture_archive') is not null
    or to_regclass('private.withdraw_pending_capture_orders') is not null
    then raise exception 'pending_capture_schema_contract_drift'; end if;
end $preflight$;

create table private.withdraw_pending_capture_archive (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check(source_system='WITHDRAW_REVIEW'),
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  platform text not null,
  stat_date date not null,
  capture_date date not null,
  window_start date not null,
  window_end date not null,
  window_days integer not null check(window_days between 1 and 30),
  snapshot_id uuid not null,
  snapshot_at timestamptz not null check(isfinite(snapshot_at)),
  snapshot jsonb not null,
  timezone text not null,
  capture_basis text not null default 'actual_capture' check(capture_basis='actual_capture'),
  -- Only the actual capture time is available. This does not assert an exact
  -- zero-point observation or the unknown source query start time.
  within_midnight_window boolean not null,
  identity_status text not null check(identity_status in ('resolved','legacy_unbound')),
  native_source_system text check(native_source_system in ('AR','NEW_AR')),
  platform_id uuid,
  team_name text,
  -- Native currency is absent in many old producers; never infer from country.
  currency text check(currency ~ '^[A-Z0-9]{3,8}$'),
  partition_snapshots jsonb not null check(jsonb_typeof(partition_snapshots)='array'),
  -- The legacy manifest cap is per creation day, not per observation window.
  pending_count bigint not null check(pending_count>=0),
  pending_amount numeric not null check(pending_amount>=0 and pending_amount::text not in ('NaN','Infinity','-Infinity')),
  updated_at timestamptz not null default clock_timestamp(),
  unique(source_system,country_code,platform,snapshot_at,window_start,window_end),
  check(window_end=stat_date and window_end=capture_date-1 and window_days=window_end-window_start+1),
  check((snapshot_at at time zone timezone)::date=capture_date),
  check((identity_status='resolved')=(platform_id is not null and native_source_system is not null and team_name is not null))
);
create index withdraw_pending_capture_scope_date_idx on private.withdraw_pending_capture_archive
  (source_system,country_code,platform,stat_date,snapshot_at);
create table private.withdraw_pending_capture_orders (
  archive_id uuid not null references private.withdraw_pending_capture_archive(id),
  order_no text not null,
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  amount numeric not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
  -- Unknown application time remains unknown for age calculations.
  applied_at timestamp check(applied_at is null or isfinite(applied_at)),
  timezone text not null,
  raw_channel text not null,
  channel_type text not null,
  status text not null check(status='已提交'),
  snapshot_id uuid not null,
  snapshot_at timestamptz not null check(isfinite(snapshot_at)),
  primary key(archive_id,order_no)
);
create index withdraw_pending_capture_provider_order_idx on private.withdraw_pending_capture_orders
  (archive_id,raw_channel,order_no);
alter table private.withdraw_pending_capture_archive enable row level security;
alter table private.withdraw_pending_capture_orders enable row level security;
revoke all on private.withdraw_pending_capture_archive,private.withdraw_pending_capture_orders
  from public,anon,authenticated,service_role;

create function private.withdraw_pending_capture_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='PENDING_CAPTURE_IMMUTABLE'; end;
$$;
revoke all on function private.withdraw_pending_capture_immutable() from public,anon,authenticated,service_role;
create trigger withdraw_pending_capture_header_immutable before update or delete on private.withdraw_pending_capture_archive
  for each row execute function private.withdraw_pending_capture_immutable();
create trigger withdraw_pending_capture_order_immutable before update or delete on private.withdraw_pending_capture_orders
  for each row execute function private.withdraw_pending_capture_immutable();

-- Collector-only internal helper. No caller may upload archive rows directly.
-- Existing source metadata and full manifests are the evidence; missing evidence
-- returns NULL rather than changing an already valid legacy publication/ACK.
create function private.archive_withdraw_pending_capture(
  p_source_system text,p_country_code text,p_platform text,p_snapshot_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  h public.withdraw_pending_backlog_daily%rowtype; archive_key uuid; expected_days integer;
  partitions jsonb; detail_rows jsonb; groups_actual jsonb; groups_expected jsonb;
  partition_count bigint; meta_count bigint; meta_amount numeric; order_count bigint; unique_count bigint; order_amount numeric;
  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb;
begin
  if p_source_system is distinct from 'WITHDRAW_REVIEW' or p_country_code is null or p_country_code !~ '^[A-Z]{2}$'
    or nullif(btrim(p_platform),'') is null or p_snapshot_at is null or not isfinite(p_snapshot_at)
    or p_snapshot_at>clock_timestamp()+interval '5 minutes' then return null; end if;
  -- Match the existing platform publication lock. No per-order lookup or lock.
  perform pg_advisory_xact_lock(hashtextextended('withdraw-pending-backlog:'||jsonb_build_array(p_source_system,p_country_code,p_platform)::text,0));
  select b.* into h from public.withdraw_pending_backlog_daily b
    where b.source_system=p_source_system and b.country_code=p_country_code and b.platform=p_platform and b.snapshot_at=p_snapshot_at;
  if not found then return null; end if;
  select a.id into archive_key from private.withdraw_pending_capture_archive a where
    a.source_system=h.source_system and a.country_code=h.country_code and a.platform=h.platform
    and a.snapshot_at=h.snapshot_at and a.window_start=h.window_start and a.window_end=h.window_end;
  if found then return archive_key; end if;
  expected_days:=h.window_end-h.window_start+1;
  if expected_days not between 1 and 30 or h.capture_date<>h.window_end+1 or h.stat_date<>h.window_end
    or h.snapshot#>'{coverage,complete}' is distinct from 'true'::jsonb
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{coverage,fetched_count}'
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{coverage,unique_count}'
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{totals,pending_count}'
    or nullif(h.snapshot->>'timezone','') is null
    or (h.snapshot#>>'{totals,pending_amount}')::numeric::text in ('NaN','Infinity','-Infinity')
    then return null; end if;
  -- All evidence is read in one MVCC statement. A zero partition still needs an
  -- exact detailed receipt and timestamp; no missing day is invented as zero.
  with days as materialized (
    select d.*,r.order_count as receipt_count from public.withdraw_pending_daily d
      join public.withdraw_pending_order_receipts r on r.snapshot_id=d.snapshot_id
      and r.scope=d.snapshot-array['schema_version','coverage','totals','groups']
    where d.source_system=h.source_system and d.country_code=h.country_code and d.platform=h.platform
      and d.stat_date between h.window_start and h.window_end and d.snapshot_at=h.snapshot_at
      and d.snapshot->>'timezone'=h.snapshot->>'timezone'
  ), orders as materialized (
    select o.* from days d join public.withdraw_pending_orders o
      on o.source_system=d.source_system and o.country_code=d.country_code and o.platform=d.platform
      and o.stat_date=d.stat_date and o.snapshot_id=d.snapshot_id and o.snapshot_at=d.snapshot_at
  ), day_totals as (
    select stat_date,count(*) as n,sum(amount) as amount from orders group by stat_date
  ), provider_totals as (
    select raw_channel,channel_type,count(*) as n,sum(amount) as amount from orders group by raw_channel,channel_type
  ) select
    (select count(*) from days),
    (select coalesce(sum((snapshot#>>'{totals,pending_count}')::bigint),0) from days),
    (select coalesce(sum((snapshot#>>'{totals,pending_amount}')::numeric),0) from days),
    (select coalesce(bool_or(d.receipt_count<>(d.snapshot#>>'{totals,pending_count}')::bigint
      or coalesce(t.n,0)<>d.receipt_count or coalesce(t.amount,0)<>(d.snapshot#>>'{totals,pending_amount}')::numeric
      or d.snapshot#>'{coverage,complete}' is distinct from 'true'::jsonb
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{coverage,fetched_count}'
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{coverage,unique_count}'
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{totals,pending_count}'),false)
      from days d left join day_totals t using(stat_date)),
    (select count(*) from orders),(select count(distinct order_no) from orders),
    (select coalesce(sum(amount),0) from orders),
    (select coalesce(bool_or(status is distinct from '已提交' or nullif(btrim(order_no),'') is null
      or amount is null or amount<0 or amount::text in ('NaN','Infinity','-Infinity')
      or applied_at is not null and not isfinite(applied_at)
      or nullif(btrim(raw_channel),'') is null or nullif(btrim(channel_type),'') is null
      or timezone is distinct from h.snapshot->>'timezone'),false) from orders),
    (select coalesce(jsonb_agg(jsonb_build_object('stat_date',stat_date,'snapshot_id',snapshot_id,'snapshot_at',snapshot_at,
      'order_count',receipt_count) order by stat_date),'[]'::jsonb) from days),
    (select coalesce(jsonb_agg(jsonb_build_object('order_no',order_no,'stat_date',stat_date,'amount',amount,'applied_at',applied_at,
      'raw_channel',raw_channel,'channel_type',channel_type,'status',status,'snapshot_id',snapshot_id,'snapshot_at',snapshot_at)
      order by order_no),'[]'::jsonb) from orders),
    (select coalesce(jsonb_agg(jsonb_build_object('raw_channel',raw_channel,'channel_type',channel_type,
      'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals)
  into partition_count,meta_count,meta_amount,bad_partitions,order_count,unique_count,order_amount,bad_orders,partitions,detail_rows,groups_actual;
  select coalesce(jsonb_agg(value order by value->>'raw_channel',value->>'channel_type'),'[]'::jsonb)
    into groups_expected from jsonb_array_elements(h.snapshot->'groups');
  if partition_count<>expected_days or bad_partitions or bad_orders or meta_count<>order_count or unique_count<>order_count
    or meta_amount::text in ('NaN','Infinity','-Infinity') or order_amount::text in ('NaN','Infinity','-Infinity')
    or meta_amount<>order_amount or order_count<>(h.snapshot#>>'{totals,pending_count}')::bigint
    or order_amount<>(h.snapshot#>>'{totals,pending_amount}')::numeric or groups_actual<>groups_expected
    then return null; end if;
  -- Reuse ONLY an exact, still-current identity. The legacy producer does not
  -- carry a team/native-source/currency; unknown identity/currency stays unknown.
  with native as (
    select 'AR'::text as source_system,t.country_code,t.platform,t.timezone,t.currency
      from public.ar_config_targets t where t.source_system='AR' and t.country_code=h.country_code and t.platform=h.platform
    union all select 'NEW_AR',n.country_code,n.platform,n.timezone,n.currency
      from public.newar_detail_platforms n where n.enabled and n.country_code=h.country_code and n.platform=h.platform
  ) select coalesce(jsonb_agg(jsonb_build_object('source_system',i.source_system,'platform_id',i.platform_id,
      'team_name',i.team_name,'currency',i.currency)),'[]'::jsonb) into native_candidates
    from private.collector_platform_identities i join native n on n.source_system=i.source_system
      and n.country_code=i.country_code and n.platform=i.source_platform and n.timezone=i.timezone
      and n.currency is not distinct from i.currency
    join public.dashboard_platform_team_map m on m.id=i.mapping_id and m.active
      and m.source_system=i.source_system and m.country_code=i.country_code and m.source_platform=i.source_platform
      and m.source_country=i.source_country and m.team_name=i.team_name
    where i.country_code=h.country_code and i.source_platform=h.platform and i.timezone=h.snapshot->>'timezone'
      and (select count(*) from public.dashboard_platform_team_map other
        where other.active and other.source_system=i.source_system
          and other.country_code=i.country_code and other.source_platform=i.source_platform)=1;
  if jsonb_array_length(native_candidates)=1 then identity:=native_candidates->0; else identity:=null; end if;
  insert into private.withdraw_pending_capture_archive(source_system,country_code,platform,stat_date,capture_date,window_start,window_end,
    window_days,snapshot_id,snapshot_at,snapshot,timezone,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,
    partition_snapshots,pending_count,pending_amount)
  values(h.source_system,h.country_code,h.platform,h.stat_date,h.capture_date,h.window_start,h.window_end,
    expected_days,h.snapshot_id,h.snapshot_at,h.snapshot,h.snapshot->>'timezone',
    (h.snapshot_at at time zone (h.snapshot->>'timezone'))::time between time '00:00' and time '00:05',
    case when identity is null then 'legacy_unbound' else 'resolved' end,identity->>'source_system',(identity->>'platform_id')::uuid,
    identity->>'team_name',identity->>'currency',partitions,order_count,order_amount) returning id into archive_key;
  insert into private.withdraw_pending_capture_orders(archive_id,order_no,source_system,country_code,platform,stat_date,amount,applied_at,timezone,
    raw_channel,channel_type,status,snapshot_id,snapshot_at)
  select archive_key,value->>'order_no',h.source_system,h.country_code,h.platform,(value->>'stat_date')::date,(value->>'amount')::numeric,
    (value->>'applied_at')::timestamp,h.snapshot->>'timezone',value->>'raw_channel',value->>'channel_type',value->>'status',
    (value->>'snapshot_id')::uuid,(value->>'snapshot_at')::timestamptz from jsonb_array_elements(detail_rows);
  return archive_key;
end;
$$;
revoke all on function private.archive_withdraw_pending_capture(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function private.archive_withdraw_pending_capture(text,text,text,timestamptz) to service_role;

-- The backlog receipt trigger runs BEFORE final order replacement. Add exactly
-- one hook AFTER replacement, preserving arguments, security, ACK, and replay.
do $hook$
declare original text; needle text; replacement text;
begin
  select pg_get_functiondef('public.publish_withdraw_pending_details(text,jsonb,jsonb)'::regprocedure) into original;
  needle:=E'  DELETE FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid;\n  RETURN ack||jsonb_build_object';
  replacement:=E'  PERFORM private.archive_withdraw_pending_capture(s->>\'source_system\',s->>\'country_code\',s->>\'platform\',(s->>\'snapshot_at\')::timestamptz);\n  DELETE FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid;\n  RETURN ack||jsonb_build_object';
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 then
    raise exception 'pending_capture_hook_contract_drift'; end if;
  execute replace(original,needle,replacement);
end $hook$;

-- Limited evidence-only backfill: any overwritten or mismatched old detail is
-- skipped. These remain actual captures, never manufactured historical midnight.
do $backfill$
declare h record;
begin
  -- Filter overwritten heads before taking any publication lock. The helper
  -- still rechecks all evidence under its lock; this only bounds backfill work.
  for h in select b.source_system,b.country_code,b.platform,b.snapshot_at from public.withdraw_pending_backlog_daily b
    where b.source_system='WITHDRAW_REVIEW' and isfinite(b.snapshot_at)
      and b.window_end-b.window_start+1 between 1 and 30
      and b.snapshot#>'{coverage,complete}'='true'::jsonb
      and (select count(*) from public.withdraw_pending_daily d
        join public.withdraw_pending_order_receipts r on r.snapshot_id=d.snapshot_id
          and r.scope=d.snapshot-array['schema_version','coverage','totals','groups']
        where d.source_system=b.source_system and d.country_code=b.country_code and d.platform=b.platform
          and d.stat_date between b.window_start and b.window_end and d.snapshot_at=b.snapshot_at
          and d.snapshot->>'timezone'=b.snapshot->>'timezone')=b.window_end-b.window_start+1
    order by b.source_system,b.country_code,b.platform,b.snapshot_at loop
    perform private.archive_withdraw_pending_capture(h.source_system,h.country_code,h.platform,h.snapshot_at);
  end loop;
end $backfill$;

notify pgrst,'reload schema';
commit;
