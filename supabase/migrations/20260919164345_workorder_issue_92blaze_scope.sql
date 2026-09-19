-- Add only 92BLAZE to the existing AR_WORKORDER publication path.
-- Existing credentials are not changed and still require explicit scope authorization.
-- Preserve all validation, source classification, publisher/idempotence, RLS and ACLs.
CREATE OR REPLACE FUNCTION public.workorder_issue_scopes_are_allowed(p_scopes jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_seen text[] := array[]::text[];
  v_identity text;
begin
  if pg_catalog.jsonb_typeof(p_scopes) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_scopes) not between 1 and 3 then
    return false;
  end if;

  for v_scope in
    select value from pg_catalog.jsonb_array_elements(p_scopes)
  loop
    if v_scope <> '{"country_code":"PK","platform":"POPZAR","timezone":"Asia/Karachi"}'::jsonb
      and v_scope <> '{"country_code":"IN","platform":"DhaniWin","timezone":"Asia/Kolkata"}'::jsonb
      and v_scope <> '{"country_code":"PK","platform":"92BLAZE","timezone":"Asia/Karachi"}'::jsonb then
      return false;
    end if;

    v_identity := v_scope::text;
    if v_identity = any(v_seen) then
      return false;
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
  end loop;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.workorder_issue_assert_snapshot(p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_coverage jsonb;
  v_totals jsonb;
  v_groups jsonb;
  v_row jsonb;
  v_key text;
  v_status_key text;
  v_status_value jsonb;
  v_date date;
  v_at timestamptz;
  v_identity text;
  v_seen text[] := array[]::text[];
  v_row_issue_count numeric;
  v_deposit_status_total numeric;
  v_withdraw_status_total numeric;
  v_sum_submitted_count numeric := 0;
  v_sum_submitted_amount numeric := 0;
  v_sum_success_count numeric := 0;
  v_sum_success_amount numeric := 0;
  v_sum_withdraw_not_received_count numeric := 0;
  v_sum_withdraw_not_received_amount numeric := 0;
  v_sum_withdraw_success_count numeric := 0;
  v_sum_withdraw_success_amount numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 1048576
    or p_snapshot->'schema_version' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'WOI_INVALID_SNAPSHOT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_snapshot) k
    where k <> all(array[
      'schema_version', 'source_system', 'country_code', 'country', 'platform',
      'stat_date', 'timezone', 'snapshot_id', 'snapshot_at', 'coverage',
      'totals', 'groups'
    ])
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_EXTRA_FIELDS';
  end if;

  foreach v_key in array array[
    'source_system', 'country_code', 'country', 'platform', 'stat_date',
    'timezone', 'snapshot_id', 'snapshot_at'
  ] loop
    if pg_catalog.jsonb_typeof(p_snapshot->v_key) is distinct from 'string'
      or pg_catalog.length(p_snapshot->>v_key) not between 1 and 80
      or p_snapshot->>v_key <> pg_catalog.btrim(p_snapshot->>v_key)
      or p_snapshot->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'WOI_INVALID_SNAPSHOT';
    end if;
  end loop;

  if p_snapshot->>'source_system' <> 'AR_WORKORDER'
    or p_snapshot->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_snapshot->>'snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_snapshot->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    or not (
      (
        p_snapshot->>'country_code' = 'PK'
        and p_snapshot->>'country' = '巴基斯坦'
        and p_snapshot->>'platform' in ('POPZAR', '92BLAZE')
        and p_snapshot->>'timezone' = 'Asia/Karachi'
      )
      or
      (
        p_snapshot->>'country_code' = 'IN'
        and p_snapshot->>'country' = '印度'
        and p_snapshot->>'platform' = 'DhaniWin'
        and p_snapshot->>'timezone' = 'Asia/Kolkata'
      )
    ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_SCOPE';
  end if;

  begin
    v_date := (p_snapshot->>'stat_date')::date;
    v_at := (p_snapshot->>'snapshot_at')::timestamptz;

    if v_date < date '2020-01-01'
      or v_date >= (pg_catalog.clock_timestamp() at time zone (p_snapshot->>'timezone'))::date
      or v_date >= (v_at at time zone (p_snapshot->>'timezone'))::date
      or v_at > pg_catalog.clock_timestamp() + interval '5 minutes'
      or pg_catalog.to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
        <> pg_catalog.substring(p_snapshot->>'snapshot_at', 1, 19) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DATE';
    end if;
  exception
    when invalid_datetime_format
      or datetime_field_overflow
      or invalid_parameter_value
      or invalid_text_representation then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DATE';
  end;

  -- 92BLAZE opens at 2026-09-22 00:00 Asia/Karachi. Its first
  -- complete business-day snapshot is September 22, published September 23.
  if p_snapshot->>'platform' = '92BLAZE' and (
    v_date < date '2026-09-22'
    or v_at < timestamptz '2026-09-21 19:00:00+00'
    or pg_catalog.clock_timestamp() < timestamptz '2026-09-21 19:00:00+00'
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_LAUNCH_DATE';
  end if;

  v_coverage := p_snapshot->'coverage';
  v_totals := p_snapshot->'totals';
  v_groups := p_snapshot->'groups';

  if pg_catalog.jsonb_typeof(v_coverage) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_totals) is distinct from 'object'
    or v_coverage->'complete' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(v_groups) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_groups) > 2000 then
    raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_coverage) k
    where k <> all(array[
      'complete', 'expected_count', 'fetched_count', 'unique_count',
      'target_count', 'ignored_count', 'unmapped_count'
    ])
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_totals) k
    where k <> all(array[
      'submitted_count', 'submitted_amount', 'success_count', 'success_amount',
      'withdraw_not_received_count', 'withdraw_not_received_amount',
      'withdraw_success_count', 'withdraw_success_amount'
    ])
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_EXTRA_FIELDS';
  end if;

  foreach v_key in array array[
    'expected_count', 'fetched_count', 'unique_count', 'target_count',
    'ignored_count', 'unmapped_count'
  ] loop
    if not public.workorder_issue_is_count(v_coverage->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
    end if;
  end loop;

  foreach v_key in array array[
    'submitted_count', 'success_count', 'withdraw_not_received_count',
    'withdraw_success_count'
  ] loop
    if not public.workorder_issue_is_count(v_totals->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
    end if;
  end loop;

  foreach v_key in array array[
    'submitted_amount', 'success_amount', 'withdraw_not_received_amount',
    'withdraw_success_amount'
  ] loop
    if not public.workorder_issue_is_money(v_totals->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
    end if;
  end loop;

  if v_coverage->'expected_count' <> v_coverage->'fetched_count'
    or v_coverage->'expected_count' <> v_coverage->'unique_count'
    or (v_coverage->>'target_count')::numeric
      + (v_coverage->>'ignored_count')::numeric
      <> (v_coverage->>'unique_count')::numeric
    or (v_coverage->>'unmapped_count')::numeric <> 0
    or (v_totals->>'submitted_count')::numeric
      + (v_totals->>'withdraw_not_received_count')::numeric
      + (v_coverage->>'unmapped_count')::numeric
      <> (v_coverage->>'target_count')::numeric
    or (v_totals->>'success_count')::numeric > (v_totals->>'submitted_count')::numeric
    or (v_totals->>'success_amount')::numeric > (v_totals->>'submitted_amount')::numeric
    or (v_totals->>'withdraw_success_count')::numeric > (v_totals->>'withdraw_not_received_count')::numeric
    or (v_totals->>'withdraw_success_amount')::numeric > (v_totals->>'withdraw_not_received_amount')::numeric then
    raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
  end if;

  for v_row in
    select value from pg_catalog.jsonb_array_elements(v_groups)
  loop
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_row) k
        where k <> all(array[
          'third_party', 'channel_type', 'submitted_count', 'submitted_amount',
          'success_count', 'success_amount', 'withdraw_not_received_count',
          'withdraw_not_received_amount', 'withdraw_success_count',
          'withdraw_success_amount', 'status_counts'
        ])
      ) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    if pg_catalog.jsonb_typeof(v_row->'third_party') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'channel_type') is distinct from 'string'
      or not public.workorder_issue_safe_descriptor(v_row->>'third_party', 96)
      or not public.workorder_issue_safe_descriptor(v_row->>'channel_type', 80) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    foreach v_key in array array[
      'submitted_count', 'success_count', 'withdraw_not_received_count',
      'withdraw_success_count'
    ] loop
      if not public.workorder_issue_is_count(v_row->v_key) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
      end if;
    end loop;

    foreach v_key in array array[
      'submitted_amount', 'success_amount', 'withdraw_not_received_amount',
      'withdraw_success_amount'
    ] loop
      if not public.workorder_issue_is_money(v_row->v_key) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
      end if;
    end loop;

    if pg_catalog.jsonb_typeof(v_row->'status_counts') is distinct from 'object'
      or (v_row->>'success_count')::numeric > (v_row->>'submitted_count')::numeric
      or (v_row->>'success_amount')::numeric > (v_row->>'submitted_amount')::numeric
      or (v_row->>'withdraw_success_count')::numeric > (v_row->>'withdraw_not_received_count')::numeric
      or (v_row->>'withdraw_success_amount')::numeric > (v_row->>'withdraw_not_received_amount')::numeric then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    v_row_issue_count :=
      (v_row->>'submitted_count')::numeric
      + (v_row->>'withdraw_not_received_count')::numeric;

    if v_row_issue_count <= 0 then
      raise exception using errcode = '22023', message = 'WOI_INVALID_EMPTY_ROW';
    end if;

    v_identity := pg_catalog.jsonb_build_array(
      v_row->>'third_party', v_row->>'channel_type'
    )::text;
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DUPLICATE_ROW';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);

    for v_status_key, v_status_value in
      select key, value from pg_catalog.jsonb_each(v_row->'status_counts')
    loop
      if v_status_key <> all(array[
          '存款/待处理', '存款/处理中', '存款/已驳回', '存款/已处理', '存款/系统处理中',
          '提款/待处理', '提款/处理中', '提款/已驳回', '提款/已处理', '提款/系统处理中'
        ])
        or not public.workorder_issue_is_count(v_status_value) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_STATUS_COUNTS';
      end if;
    end loop;

    v_deposit_status_total :=
      coalesce((v_row#>>'{status_counts,存款/待处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/处理中}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/已驳回}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/已处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/系统处理中}')::numeric, 0);
    v_withdraw_status_total :=
      coalesce((v_row#>>'{status_counts,提款/待处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/处理中}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/已驳回}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/已处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/系统处理中}')::numeric, 0);

    if v_deposit_status_total <> (v_row->>'submitted_count')::numeric
      or v_withdraw_status_total <> (v_row->>'withdraw_not_received_count')::numeric
      or coalesce((v_row#>>'{status_counts,存款/已处理}')::numeric, 0)
        <> (v_row->>'success_count')::numeric
      or coalesce((v_row#>>'{status_counts,提款/已处理}')::numeric, 0)
        <> (v_row->>'withdraw_success_count')::numeric then
      raise exception using errcode = '22023', message = 'WOI_INVALID_STATUS_COUNTS';
    end if;

    v_sum_submitted_count := v_sum_submitted_count + (v_row->>'submitted_count')::numeric;
    v_sum_submitted_amount := v_sum_submitted_amount + (v_row->>'submitted_amount')::numeric;
    v_sum_success_count := v_sum_success_count + (v_row->>'success_count')::numeric;
    v_sum_success_amount := v_sum_success_amount + (v_row->>'success_amount')::numeric;
    v_sum_withdraw_not_received_count := v_sum_withdraw_not_received_count
      + (v_row->>'withdraw_not_received_count')::numeric;
    v_sum_withdraw_not_received_amount := v_sum_withdraw_not_received_amount
      + (v_row->>'withdraw_not_received_amount')::numeric;
    v_sum_withdraw_success_count := v_sum_withdraw_success_count
      + (v_row->>'withdraw_success_count')::numeric;
    v_sum_withdraw_success_amount := v_sum_withdraw_success_amount
      + (v_row->>'withdraw_success_amount')::numeric;
  end loop;

  if v_sum_submitted_count <> (v_totals->>'submitted_count')::numeric
    or v_sum_submitted_amount <> (v_totals->>'submitted_amount')::numeric
    or v_sum_success_count <> (v_totals->>'success_count')::numeric
    or v_sum_success_amount <> (v_totals->>'success_amount')::numeric
    or v_sum_withdraw_not_received_count <> (v_totals->>'withdraw_not_received_count')::numeric
    or v_sum_withdraw_not_received_amount <> (v_totals->>'withdraw_not_received_amount')::numeric
    or v_sum_withdraw_success_count <> (v_totals->>'withdraw_success_count')::numeric
    or v_sum_withdraw_success_amount <> (v_totals->>'withdraw_success_amount')::numeric then
    raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
  end if;
end;
$function$;

alter table public.workorder_issue_snapshot_heads
  drop constraint workorder_issue_snapshot_heads_check;
alter table public.workorder_issue_snapshot_heads
  add constraint workorder_issue_snapshot_heads_check check (
    (country_code = 'PK' and platform in ('POPZAR', '92BLAZE') and timezone = 'Asia/Karachi')
    or (country_code = 'IN' and platform = 'DhaniWin' and timezone = 'Asia/Kolkata')
  );
