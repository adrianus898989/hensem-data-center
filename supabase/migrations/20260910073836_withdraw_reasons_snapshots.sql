-- Isolated withdrawal-reason snapshots. No existing application objects are changed.
-- Provision only SHA-256 hashes of random, dedicated X-Reasons-Key tokens.
create table public.withdraw_reasons_credentials (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  source_system text not null check (source_system ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  allowed_scopes jsonb not null check (
    case when jsonb_typeof(allowed_scopes) = 'array' then jsonb_array_length(allowed_scopes) between 1 and 1000 else false end
  ),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  label text not null default '' check (length(label) <= 120),
  created_at timestamptz not null default now()
);

-- Receipts retain only a digest and scope, never note samples or historical payloads.
-- They prevent a previously replaced snapshot_id from being reused with new content.
create table public.withdraw_reasons_snapshot_receipts (
  snapshot_id uuid primary key,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  received_at timestamptz not null default now()
);

create table public.withdraw_reasons_daily (
  source_system text not null,
  country_code text not null,
  platform text not null,
  stat_date date not null,
  snapshot_id uuid not null unique references public.withdraw_reasons_snapshot_receipts(snapshot_id),
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
create index withdraw_reasons_daily_report_idx on public.withdraw_reasons_daily (source_system, stat_date, country_code, platform);

alter table public.withdraw_reasons_credentials enable row level security;
alter table public.withdraw_reasons_snapshot_receipts enable row level security;
alter table public.withdraw_reasons_daily enable row level security;
revoke all on public.withdraw_reasons_credentials, public.withdraw_reasons_snapshot_receipts, public.withdraw_reasons_daily from public, anon, authenticated;
grant select, insert, update, delete on public.withdraw_reasons_credentials to service_role;
grant select, insert on public.withdraw_reasons_snapshot_receipts to service_role;
grant select, insert, update on public.withdraw_reasons_daily to service_role;
grant select on public.withdraw_reasons_daily to authenticated;
create policy withdraw_reasons_dashboard_read on public.withdraw_reasons_daily for select to authenticated
  using ((select public.dashboard_has_permission('auto_withdraw')));

create function public.withdraw_reasons_is_count(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when pg_catalog.jsonb_typeof(p_value) = 'number'
    then (p_value::text)::numeric >= 0
      and (p_value::text)::numeric <= 9007199254740991
      and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric
    else false end;
$$;
revoke all on function public.withdraw_reasons_is_count(jsonb) from public, anon, authenticated;
grant execute on function public.withdraw_reasons_is_count(jsonb) to service_role;

-- Defense in depth: invalid/incomplete snapshots cannot be published by a direct RPC call.
create function public.withdraw_reasons_assert_snapshot(p_snapshot jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_coverage jsonb;
  v_totals jsonb;
  v_group jsonb;
  v_sample jsonb;
  v_key text;
  v_identity text;
  v_seen text[] := array[]::text[];
  v_date date;
  v_timestamp timestamptz;
  v_id uuid;
  v_total numeric := 0;
  v_auto numeric := 0;
  v_manual numeric := 0;
  v_unknown numeric := 0;
  v_success numeric := 0;
  v_reject numeric := 0;
  v_other numeric := 0;
  v_truncated numeric := 0;
  v_count numeric;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
     or pg_catalog.octet_length(p_snapshot::text) > 2097152
     or p_snapshot->'schema_version' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'WR_INVALID_SNAPSHOT';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_snapshot) field where field <> all(array['schema_version','source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at','classifier_version','coverage','totals','groups'])) then
    raise exception using errcode = '22023', message = 'WR_INVALID_EXTRA_FIELDS';
  end if;
  foreach v_key in array array['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at','classifier_version'] loop
    if pg_catalog.jsonb_typeof(p_snapshot->v_key) is distinct from 'string'
      or pg_catalog.length(p_snapshot->>v_key) not between 1 and 80
      or (p_snapshot->>v_key) <> pg_catalog.btrim(p_snapshot->>v_key)
      or (p_snapshot->>v_key) ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'WR_INVALID_SNAPSHOT';
    end if;
  end loop;
  if (p_snapshot->>'source_system') !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
    or (p_snapshot->>'country_code') !~ '^[A-Z]{2}$'
    or (p_snapshot->>'stat_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_snapshot->>'snapshot_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_snapshot->>'snapshot_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
    raise exception using errcode = '22023', message = 'WR_INVALID_SNAPSHOT';
  end if;
  begin
    v_date := (p_snapshot->>'stat_date')::date;
    v_timestamp := (p_snapshot->>'snapshot_at')::timestamptz;
    v_id := (p_snapshot->>'snapshot_id')::uuid;
    if v_date > (pg_catalog.clock_timestamp() at time zone (p_snapshot->>'timezone'))::date
      or v_timestamp > pg_catalog.clock_timestamp() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'WR_INVALID_SNAPSHOT';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or invalid_text_representation then
    raise exception using errcode = '22023', message = 'WR_INVALID_SNAPSHOT';
  end;
  v_coverage := p_snapshot->'coverage';
  v_totals := p_snapshot->'totals';
  if pg_catalog.jsonb_typeof(v_coverage) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_totals) is distinct from 'object'
    or v_coverage->'complete' is distinct from 'true'::jsonb
    or v_coverage->'note_header_found' is distinct from 'true'::jsonb
    or v_coverage->'missing_order_ids' is distinct from '0'::jsonb then
    raise exception using errcode = '22023', message = 'WR_INVALID_COVERAGE';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(v_coverage) field where field <> all(array['complete','expected_count','fetched_count','unique_count','missing_order_ids','note_header_found','incomplete_note_count']))
    or exists (select 1 from pg_catalog.jsonb_object_keys(v_totals) field where field <> all(array['total','auto','manual','unknown','success','reject','other'])) then
    raise exception using errcode = '22023', message = 'WR_INVALID_EXTRA_FIELDS';
  end if;
  foreach v_key in array array['expected_count','fetched_count','unique_count','incomplete_note_count'] loop
    if not public.withdraw_reasons_is_count(v_coverage->v_key) then
      raise exception using errcode = '22023', message = 'WR_INVALID_COVERAGE';
    end if;
  end loop;
  foreach v_key in array array['total','auto','manual','unknown','success','reject','other'] loop
    if not public.withdraw_reasons_is_count(v_totals->v_key) then
      raise exception using errcode = '22023', message = 'WR_INVALID_TOTALS';
    end if;
  end loop;
  if (v_totals->>'total')::numeric <> (v_coverage->>'expected_count')::numeric
    or (v_coverage->>'expected_count')::numeric <> (v_coverage->>'unique_count')::numeric
    or (v_coverage->>'unique_count')::numeric > (v_coverage->>'fetched_count')::numeric then
    raise exception using errcode = '22023', message = 'WR_INVALID_COVERAGE';
  end if;
  if pg_catalog.jsonb_typeof(p_snapshot->'groups') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'WR_INVALID_GROUPS';
  end if;
  if pg_catalog.jsonb_array_length(p_snapshot->'groups') > 5000 then
    raise exception using errcode = '22023', message = 'WR_INVALID_GROUPS';
  end if;
  for v_group in select value from pg_catalog.jsonb_array_elements(p_snapshot->'groups') loop
    if pg_catalog.jsonb_typeof(v_group) is distinct from 'object'
      or coalesce(v_group->>'operator_class', '') not in ('auto','manual','unknown')
      or coalesce(v_group->>'classification', '') not in ('template','empty','unclassified','truncated')
      or pg_catalog.jsonb_typeof(v_group->'reason_key') is distinct from 'string'
      or coalesce(v_group->>'reason_key', '') !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(v_group->'reason_label') is distinct from 'string'
      or pg_catalog.length(v_group->>'reason_label') not between 1 and 400
      or (v_group->>'reason_label') <> pg_catalog.btrim(v_group->>'reason_label')
      or (v_group->>'reason_label') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'WR_INVALID_GROUPS';
    end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_group) field where field <> all(array['operator_class','reason_key','reason_label','classification','count','success','reject','other','samples'])) then
      raise exception using errcode = '22023', message = 'WR_INVALID_EXTRA_FIELDS';
    end if;
    v_identity := (v_group->>'operator_class') || ':' || (v_group->>'reason_key');
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'WR_INVALID_DUPLICATE_GROUP';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
    foreach v_key in array array['count','success','reject','other'] loop
      if not public.withdraw_reasons_is_count(v_group->v_key) then
        raise exception using errcode = '22023', message = 'WR_INVALID_GROUPS';
      end if;
    end loop;
    if pg_catalog.jsonb_typeof(v_group->'samples') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'WR_INVALID_SAMPLES';
    end if;
    if pg_catalog.jsonb_array_length(v_group->'samples') > 3 then
      raise exception using errcode = '22023', message = 'WR_INVALID_SAMPLES';
    end if;
    for v_sample in select value from pg_catalog.jsonb_array_elements(v_group->'samples') loop
      if pg_catalog.jsonb_typeof(v_sample) is distinct from 'string' or pg_catalog.length(v_sample #>> '{}') > 500 then
        raise exception using errcode = '22023', message = 'WR_INVALID_SAMPLES';
      end if;
    end loop;
    v_count := (v_group->>'count')::numeric;
    if v_count <> (v_group->>'success')::numeric + (v_group->>'reject')::numeric + (v_group->>'other')::numeric then
      raise exception using errcode = '22023', message = 'WR_INVALID_GROUP_TOTALS';
    end if;
    v_total := v_total + v_count;
    if v_group->>'operator_class' = 'auto' then v_auto := v_auto + v_count;
      elsif v_group->>'operator_class' = 'manual' then v_manual := v_manual + v_count;
      else v_unknown := v_unknown + v_count; end if;
    v_success := v_success + (v_group->>'success')::numeric;
    v_reject := v_reject + (v_group->>'reject')::numeric;
    v_other := v_other + (v_group->>'other')::numeric;
    if v_group->>'classification' = 'truncated' then v_truncated := v_truncated + v_count; end if;
  end loop;
  if v_total <> (v_totals->>'total')::numeric or v_auto <> (v_totals->>'auto')::numeric
    or v_manual <> (v_totals->>'manual')::numeric or v_unknown <> (v_totals->>'unknown')::numeric
    or v_success <> (v_totals->>'success')::numeric or v_reject <> (v_totals->>'reject')::numeric
    or v_other <> (v_totals->>'other')::numeric or v_truncated <> (v_coverage->>'incomplete_note_count')::numeric then
    raise exception using errcode = '22023', message = 'WR_INVALID_TOTALS';
  end if;
end;
$$;
revoke all on function public.withdraw_reasons_assert_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.withdraw_reasons_assert_snapshot(jsonb) to service_role;

create function public.publish_withdraw_reasons_snapshot(p_token_hash text, p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_credential public.withdraw_reasons_credentials%rowtype;
  v_receipt public.withdraw_reasons_snapshot_receipts%rowtype;
  v_hash text;
  v_id uuid;
  v_current_id uuid;
  v_written_id uuid;
  v_replay boolean := false;
begin
  -- Credential read is locked until commit, so revoke/update cannot race publication.
  select * into v_credential from public.withdraw_reasons_credentials where token_hash = p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'WR_AUTH_INVALID';
  end if;
  perform public.withdraw_reasons_assert_snapshot(p_snapshot);
  if v_credential.source_system <> p_snapshot->>'source_system'
    or not v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('country_code', p_snapshot->>'country_code', 'platform', p_snapshot->>'platform')) then
    raise exception using errcode = '42501', message = 'WR_SCOPE_DENIED';
  end if;
  v_id := (p_snapshot->>'snapshot_id')::uuid;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot::text, 'UTF8')), 'hex');
  -- Serialize only the same id; independent platforms remain concurrent.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('withdraw-reasons-id:' || v_id::text, 0));
  select * into v_receipt from public.withdraw_reasons_snapshot_receipts where snapshot_id = v_id;
  if found then
    if v_receipt.payload_hash <> v_hash then
      raise exception using errcode = '23505', message = 'WR_ID_CONFLICT';
    end if;
    v_replay := true;
  else
    insert into public.withdraw_reasons_snapshot_receipts (snapshot_id, payload_hash, source_system, country_code, platform, stat_date)
    values (v_id, v_hash, p_snapshot->>'source_system', p_snapshot->>'country_code', p_snapshot->>'platform', (p_snapshot->>'stat_date')::date);
    insert into public.withdraw_reasons_daily as current_day (source_system, country_code, platform, stat_date, snapshot_id, snapshot_at, snapshot)
    values (p_snapshot->>'source_system', p_snapshot->>'country_code', p_snapshot->>'platform', (p_snapshot->>'stat_date')::date, v_id, (p_snapshot->>'snapshot_at')::timestamptz, p_snapshot)
    on conflict (source_system, country_code, platform, stat_date) do update
      set snapshot_id = excluded.snapshot_id, snapshot_at = excluded.snapshot_at, snapshot = excluded.snapshot, updated_at = pg_catalog.clock_timestamp()
      where excluded.snapshot_at > current_day.snapshot_at
    returning snapshot_id into v_written_id;
  end if;
  select snapshot_id into v_current_id from public.withdraw_reasons_daily
    where source_system = p_snapshot->>'source_system' and country_code = p_snapshot->>'country_code'
      and platform = p_snapshot->>'platform' and stat_date = (p_snapshot->>'stat_date')::date;
  if v_current_id is null then
    raise exception using errcode = '55000', message = 'WR_STORAGE_INCONSISTENT';
  end if;
  return pg_catalog.jsonb_build_object('ok', true,
    'status', case when v_current_id <> v_id then 'stale' when v_replay then 'unchanged' when v_written_id is not null then 'accepted' else 'stale' end,
    'snapshot_id', p_snapshot->>'snapshot_id', 'current_snapshot_id', v_current_id::text);
end;
$$;
revoke all on function public.publish_withdraw_reasons_snapshot(text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_withdraw_reasons_snapshot(text, jsonb) to service_role;

create function public.report_withdraw_reasons_snapshots(p_token_hash text, p_start date, p_end date, p_platforms text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_credential public.withdraw_reasons_credentials%rowtype;
  v_snapshots jsonb;
begin
  select * into v_credential from public.withdraw_reasons_credentials where token_hash = p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'WR_AUTH_INVALID';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 30
    or p_platforms is null or pg_catalog.cardinality(p_platforms) > 1000
    or exists (select 1 from pg_catalog.unnest(p_platforms) name where name is null or pg_catalog.length(name) not between 1 and 80 or name <> pg_catalog.btrim(name))
    or pg_catalog.cardinality(p_platforms) <> (select count(distinct name) from pg_catalog.unnest(p_platforms) name) then
    raise exception using errcode = '22023', message = 'WR_INVALID_REPORT';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_platforms) name where not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_credential.allowed_scopes) scope where scope->>'platform' = name
  )) then
    raise exception using errcode = '42501', message = 'WR_SCOPE_DENIED';
  end if;
  select coalesce(pg_catalog.jsonb_agg(day.snapshot order by day.stat_date, day.country_code, day.platform), '[]'::jsonb) into v_snapshots
    from public.withdraw_reasons_daily day
    where day.source_system = v_credential.source_system and day.stat_date between p_start and p_end
      and (pg_catalog.cardinality(p_platforms) = 0 or day.platform = any(p_platforms))
      and v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('country_code', day.country_code, 'platform', day.platform));
  return pg_catalog.jsonb_build_object('ok', true, 'snapshots', v_snapshots);
end;
$$;
revoke all on function public.report_withdraw_reasons_snapshots(text, date, date, text[]) from public, anon, authenticated;
grant execute on function public.report_withdraw_reasons_snapshots(text, date, date, text[]) to service_role;
