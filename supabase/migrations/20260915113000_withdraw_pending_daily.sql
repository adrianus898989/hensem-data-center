-- Additive exact-"已提交" payout snapshots.
-- This table is intentionally separate from legacy volume, fees, and collection success data.
begin;

create table public.withdraw_pending_credentials (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  source_system text not null check (source_system = 'WITHDRAW_REVIEW'),
  allowed_scopes jsonb not null check (jsonb_typeof(allowed_scopes) = 'array' and jsonb_array_length(allowed_scopes) between 1 and 1000),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  label text not null default '' check (length(label) <= 120),
  created_at timestamptz not null default now()
);

create table public.withdraw_pending_snapshot_receipts (
  snapshot_id uuid primary key,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now()
);

create table public.withdraw_pending_daily (
  source_system text not null check (source_system = 'WITHDRAW_REVIEW'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  platform text not null,
  stat_date date not null,
  snapshot_id uuid not null unique references public.withdraw_pending_snapshot_receipts(snapshot_id),
  snapshot_at timestamptz not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (source_system, country_code, platform, stat_date),
  check (snapshot->>'source_system' = source_system),
  check (snapshot->>'country_code' = country_code),
  check (snapshot->>'platform' = platform),
  check ((snapshot->>'stat_date')::date = stat_date),
  check ((snapshot->>'snapshot_id')::uuid = snapshot_id),
  check ((snapshot->>'snapshot_at')::timestamptz = snapshot_at),
  check (snapshot#>'{coverage,complete}' = 'true'::jsonb)
);
create index withdraw_pending_daily_date_idx on public.withdraw_pending_daily (stat_date, country_code, platform);

alter table public.withdraw_pending_credentials enable row level security;
alter table public.withdraw_pending_snapshot_receipts enable row level security;
alter table public.withdraw_pending_daily enable row level security;
revoke all on public.withdraw_pending_credentials, public.withdraw_pending_snapshot_receipts, public.withdraw_pending_daily from public, anon, authenticated;
grant select, insert, update, delete on public.withdraw_pending_credentials to service_role;
grant select, insert on public.withdraw_pending_snapshot_receipts to service_role;
grant select, insert, update on public.withdraw_pending_daily to service_role;
grant select on public.withdraw_pending_daily to authenticated;
create policy withdraw_pending_module_read on public.withdraw_pending_daily for select to authenticated
  using ((select public.dashboard_has_permission('third_party')));
create policy withdraw_pending_scope_read on public.withdraw_pending_daily as restrictive for select to authenticated
  using (private.dashboard_scope_allows((select private.dashboard_current_data_scope()), country_code, platform));

create function public.withdraw_pending_is_count(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_value) = 'number'
    and (p_value::text)::numeric between 0 and 9007199254740991
    and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric;
$$;
create function public.withdraw_pending_is_amount(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_value) = 'number'
    and (p_value::text)::numeric between 0 and 9007199254740991
    and pg_catalog.round((p_value::text)::numeric, 2) = (p_value::text)::numeric;
$$;
revoke all on function public.withdraw_pending_is_count(jsonb), public.withdraw_pending_is_amount(jsonb) from public, anon, authenticated;
grant execute on function public.withdraw_pending_is_count(jsonb), public.withdraw_pending_is_amount(jsonb) to service_role;

create function public.withdraw_pending_assert_snapshot(p_snapshot jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_coverage jsonb; v_totals jsonb; v_group jsonb; v_key text; v_date date; v_at timestamptz;
  v_seen text[] := array[]::text[]; v_count numeric := 0; v_amount numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 1048576
    or p_snapshot->'schema_version' is distinct from '1'::jsonb
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_snapshot) k where k <> all(array['schema_version','source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at','coverage','totals','groups'])) then
    raise exception using errcode='22023', message='WP_INVALID_SNAPSHOT';
  end if;
  foreach v_key in array array['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at'] loop
    if pg_catalog.jsonb_typeof(p_snapshot->v_key) is distinct from 'string' or pg_catalog.length(p_snapshot->>v_key) not between 1 and 100 or p_snapshot->>v_key <> pg_catalog.btrim(p_snapshot->>v_key) or p_snapshot->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023', message='WP_INVALID_SNAPSHOT';
    end if;
  end loop;
  if p_snapshot->>'source_system' <> 'WITHDRAW_REVIEW' or p_snapshot->>'country_code' !~ '^[A-Z]{2}$'
    or p_snapshot->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_snapshot->>'snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_snapshot->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    or not public.collection_success_safe_descriptor(p_snapshot->>'platform',80)
    or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_snapshot->>'timezone') then
    raise exception using errcode='22023', message='WP_INVALID_SNAPSHOT';
  end if;
  begin
    v_date := (p_snapshot->>'stat_date')::date; v_at := (p_snapshot->>'snapshot_at')::timestamptz;
    if v_date < date '2020-01-01' or v_date >= (pg_catalog.clock_timestamp() at time zone (p_snapshot->>'timezone'))::date
      or v_date >= (v_at at time zone (p_snapshot->>'timezone'))::date or v_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
      raise exception using errcode='22023', message='WP_INVALID_DATE';
    end if;
  exception when others then
    if sqlstate not like '22%' then raise; end if;
    raise exception using errcode='22023', message='WP_INVALID_DATE';
  end;
  v_coverage := p_snapshot->'coverage'; v_totals := p_snapshot->'totals';
  if jsonb_typeof(v_coverage) is distinct from 'object' or jsonb_typeof(v_totals) is distinct from 'object'
    or v_coverage->'complete' is distinct from 'true'::jsonb
    or exists (select 1 from pg_catalog.jsonb_object_keys(v_coverage) k where k <> all(array['complete','expected_count','fetched_count','unique_count']))
    or exists (select 1 from pg_catalog.jsonb_object_keys(v_totals) k where k <> all(array['pending_count','pending_amount']))
    or not public.withdraw_pending_is_count(v_coverage->'expected_count')
    or not public.withdraw_pending_is_count(v_coverage->'fetched_count')
    or not public.withdraw_pending_is_count(v_coverage->'unique_count')
    or not public.withdraw_pending_is_count(v_totals->'pending_count')
    or not public.withdraw_pending_is_amount(v_totals->'pending_amount')
    or v_coverage->'expected_count' <> v_coverage->'fetched_count'
    or v_coverage->'expected_count' <> v_coverage->'unique_count'
    or v_coverage->'expected_count' <> v_totals->'pending_count' then
    raise exception using errcode='22023', message='WP_INVALID_COVERAGE';
  end if;
  if jsonb_typeof(p_snapshot->'groups') is distinct from 'array' or jsonb_array_length(p_snapshot->'groups') > 2000 then
    raise exception using errcode='22023', message='WP_INVALID_GROUPS';
  end if;
  for v_group in select value from jsonb_array_elements(p_snapshot->'groups') loop
    if jsonb_typeof(v_group) is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(v_group) k where k <> all(array['raw_channel','channel_type','pending_count','pending_amount']))
      or not public.collection_success_safe_descriptor(v_group->>'raw_channel',96)
      or not public.collection_success_safe_descriptor(v_group->>'channel_type',48)
      or not public.withdraw_pending_is_count(v_group->'pending_count')
      or not public.withdraw_pending_is_amount(v_group->'pending_amount')
      or (v_group->>'pending_count')::numeric <= 0 then
      raise exception using errcode='22023', message='WP_INVALID_GROUPS';
    end if;
    v_key := jsonb_build_array(v_group->>'raw_channel',v_group->>'channel_type')::text;
    if v_key = any(v_seen) then raise exception using errcode='22023', message='WP_DUPLICATE_GROUP'; end if;
    v_seen := array_append(v_seen,v_key);
    v_count := v_count + (v_group->>'pending_count')::numeric; v_amount := v_amount + (v_group->>'pending_amount')::numeric;
  end loop;
  if v_count <> (v_totals->>'pending_count')::numeric or round(v_amount,2) <> (v_totals->>'pending_amount')::numeric then
    raise exception using errcode='22023', message='WP_INVALID_TOTALS';
  end if;
end;
$$;
revoke all on function public.withdraw_pending_assert_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.withdraw_pending_assert_snapshot(jsonb) to service_role;

create function public.publish_withdraw_pending_snapshot(p_token_hash text, p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_credential public.withdraw_pending_credentials%rowtype; v_receipt public.withdraw_pending_snapshot_receipts%rowtype;
  v_id uuid; v_current_id uuid; v_written_id uuid; v_hash text; v_replay boolean := false;
begin
  select * into v_credential from public.withdraw_pending_credentials where token_hash=p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then raise exception using errcode='28000', message='WP_AUTH_INVALID'; end if;
  perform public.withdraw_pending_assert_snapshot(p_snapshot);
  if v_credential.source_system <> p_snapshot->>'source_system' or not v_credential.allowed_scopes @> jsonb_build_array(jsonb_build_object('country_code',p_snapshot->>'country_code','platform',p_snapshot->>'platform','timezone',p_snapshot->>'timezone')) then raise exception using errcode='42501', message='WP_SCOPE_DENIED'; end if;
  v_id := (p_snapshot->>'snapshot_id')::uuid; v_hash := encode(digest(p_snapshot::text,'sha256'),'hex');
  select * into v_receipt from public.withdraw_pending_snapshot_receipts where snapshot_id=v_id for update;
  if found then if v_receipt.payload_hash <> v_hash then raise exception using errcode='23505', message='WP_ID_CONFLICT'; end if; v_replay := true; else insert into public.withdraw_pending_snapshot_receipts(snapshot_id,payload_hash) values(v_id,v_hash); end if;
  insert into public.withdraw_pending_daily(source_system,country_code,platform,stat_date,snapshot_id,snapshot_at,snapshot,updated_at)
    values(p_snapshot->>'source_system',p_snapshot->>'country_code',p_snapshot->>'platform',(p_snapshot->>'stat_date')::date,v_id,(p_snapshot->>'snapshot_at')::timestamptz,p_snapshot,now())
    on conflict (source_system,country_code,platform,stat_date) do update set snapshot_id=excluded.snapshot_id,snapshot_at=excluded.snapshot_at,snapshot=excluded.snapshot,updated_at=now()
    where public.withdraw_pending_daily.snapshot_at < excluded.snapshot_at returning snapshot_id into v_written_id;
  select snapshot_id into v_current_id from public.withdraw_pending_daily where source_system=p_snapshot->>'source_system' and country_code=p_snapshot->>'country_code' and platform=p_snapshot->>'platform' and stat_date=(p_snapshot->>'stat_date')::date;
  if v_current_id is null then raise exception using errcode='55000', message='WP_STORAGE_INCONSISTENT'; end if;
  return jsonb_build_object('ok',true,'status',case when v_current_id<>v_id then 'stale' when v_replay then 'unchanged' when v_written_id is not null then 'accepted' else 'stale' end,'snapshot_id',p_snapshot->>'snapshot_id','current_snapshot_id',v_current_id::text);
end;
$$;
revoke all on function public.publish_withdraw_pending_snapshot(text,jsonb) from public, anon, authenticated;
grant execute on function public.publish_withdraw_pending_snapshot(text,jsonb) to service_role;

create function public.dashboard_withdraw_pending(p_start date,p_end date,p_country text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_snapshots jsonb; v_country text; v_rows bigint; v_bytes numeric;
begin
  if p_start is null or p_end is null or p_start>p_end or p_end-p_start>731 or (p_country is not null and (length(p_country)>80 or p_country ~ '[[:cntrl:]]')) then raise exception using errcode='22023',message='WP_INVALID_RANGE'; end if;
  v_country := case when p_country is null or btrim(p_country)='' then null else private.dashboard_data_group(p_country,'') end;
  select count(*),coalesce(sum(octet_length(s.snapshot::text)),0) into v_rows,v_bytes from public.withdraw_pending_daily s where s.stat_date between p_start and p_end and (v_country is null or (v_country<>'' and private.dashboard_data_group(s.country_code,s.platform)=v_country));
  if v_rows>10000 or v_bytes>16777216 then raise exception using errcode='54000',message='WP_RANGE_TOO_LARGE'; end if;
  select coalesce(jsonb_agg(s.snapshot order by s.stat_date,s.country_code,s.platform),'[]'::jsonb) into v_snapshots from public.withdraw_pending_daily s where s.stat_date between p_start and p_end and (v_country is null or (v_country<>'' and private.dashboard_data_group(s.country_code,s.platform)=v_country));
  return jsonb_build_object('snapshots',v_snapshots);
end;
$$;
revoke all on function public.dashboard_withdraw_pending(date,date,text) from public,anon;
grant execute on function public.dashboard_withdraw_pending(date,date,text) to authenticated,service_role;
commit;
