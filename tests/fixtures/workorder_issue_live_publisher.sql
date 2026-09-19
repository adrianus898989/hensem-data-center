CREATE OR REPLACE FUNCTION public.publish_workorder_issue_snapshot(p_token_hash text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_credential public.workorder_issue_credentials%rowtype;
  v_receipt public.workorder_issue_snapshot_receipts%rowtype;
  v_id uuid;
  v_hash text;
  v_date date;
  v_snapshot_at timestamptz;
  v_country text;
  v_groups jsonb;
  v_current_id uuid;
  v_current_at timestamptz;
  v_replay boolean := false;
  v_accepted boolean := false;
begin
  -- Hold the credential row until commit so revoke/publication ordering is
  -- explicit and a credential cannot change during publication.
  select *
  into v_credential
  from public.workorder_issue_credentials
  where token_hash = p_token_hash
  for share;

  if not found
    or v_credential.revoked
    or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'WOI_AUTH_INVALID';
  end if;

  perform public.workorder_issue_assert_snapshot(p_snapshot);

  if v_credential.source_system <> p_snapshot->>'source_system'
    or not ((p_snapshot->>'source_system') = any(v_credential.allowed_source_systems))
    or not v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'country_code', p_snapshot->>'country_code',
        'platform', p_snapshot->>'platform',
        'timezone', p_snapshot->>'timezone'
      )
    ) then
    raise exception using errcode = '42501', message = 'WOI_SCOPE_DENIED';
  end if;

  v_id := (p_snapshot->>'snapshot_id')::uuid;
  v_date := (p_snapshot->>'stat_date')::date;
  v_snapshot_at := (p_snapshot->>'snapshot_at')::timestamptz;
  v_country := case p_snapshot->>'country_code'
    when 'PK' then '巴基斯坦'
    when 'IN' then '印度'
    else null
  end;
  v_groups := p_snapshot->'groups';
  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_snapshot::text, 'UTF8')),
    'hex'
  );

  -- Always lock in this order. Reusing an ID across scopes cannot deadlock a
  -- concurrent publisher for either scope.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workorder-issue-id:' || v_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'workorder-issue-day:' || pg_catalog.jsonb_build_array(
        p_snapshot->>'source_system',
        p_snapshot->>'country_code',
        p_snapshot->>'platform',
        p_snapshot->>'stat_date'
      )::text,
      0
    )
  );

  select *
  into v_receipt
  from public.workorder_issue_snapshot_receipts
  where snapshot_id = v_id;

  if found then
    if v_receipt.payload_hash <> v_hash then
      raise exception using errcode = '23505', message = 'WOI_ID_CONFLICT';
    end if;
    v_replay := true;
  else
    insert into public.workorder_issue_snapshot_receipts (
      snapshot_id, payload_hash
    ) values (
      v_id, v_hash
    );

    select h.current_snapshot_id, h.snapshot_at
    into v_current_id, v_current_at
    from public.workorder_issue_snapshot_heads h
    where h.source_system = p_snapshot->>'source_system'
      and h.country_code = p_snapshot->>'country_code'
      and h.platform = p_snapshot->>'platform'
      and h.stat_date = v_date;

    if v_current_id is null or v_snapshot_at > v_current_at then
      insert into public.workorder_deposit_daily as current_row (
        system_name,
        source_system,
        stat_date,
        country_code,
        country,
        platform,
        third_party,
        channel_type,
        submitted_count,
        submitted_amount,
        success_count,
        success_amount,
        status_counts,
        withdraw_not_received_count,
        withdraw_not_received_amount,
        withdraw_success_count,
        withdraw_success_amount,
        source_updated_at,
        updated_at
      )
      select
        'AR',
        'AR_WORKORDER',
        v_date,
        p_snapshot->>'country_code',
        v_country,
        p_snapshot->>'platform',
        row_data.value->>'third_party',
        row_data.value->>'channel_type',
        (row_data.value->>'submitted_count')::bigint,
        (row_data.value->>'submitted_amount')::numeric(24, 2),
        (row_data.value->>'success_count')::bigint,
        (row_data.value->>'success_amount')::numeric(24, 2),
        row_data.value->'status_counts',
        (row_data.value->>'withdraw_not_received_count')::bigint,
        (row_data.value->>'withdraw_not_received_amount')::numeric(24, 2),
        (row_data.value->>'withdraw_success_count')::bigint,
        (row_data.value->>'withdraw_success_amount')::numeric(24, 2),
        v_snapshot_at,
        pg_catalog.clock_timestamp()
      from pg_catalog.jsonb_array_elements(v_groups) as row_data(value)
      on conflict (
        system_name, stat_date, country_code, platform, third_party, channel_type
      ) do update
      set
        source_system = excluded.source_system,
        country = excluded.country,
        submitted_count = excluded.submitted_count,
        submitted_amount = excluded.submitted_amount,
        success_count = excluded.success_count,
        success_amount = excluded.success_amount,
        status_counts = excluded.status_counts,
        withdraw_not_received_count = excluded.withdraw_not_received_count,
        withdraw_not_received_amount = excluded.withdraw_not_received_amount,
        withdraw_success_count = excluded.withdraw_success_count,
        withdraw_success_amount = excluded.withdraw_success_amount,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at;

      -- A complete snapshot is authoritative only inside this exact
      -- system/source/platform/business-day scope. An empty groups array safely
      -- deletes every old row in that one scope and nothing else.
      delete from public.workorder_deposit_daily d
      where d.system_name = 'AR'
        and d.source_system = 'AR_WORKORDER'
        and d.stat_date = v_date
        and d.country_code = p_snapshot->>'country_code'
        and d.platform = p_snapshot->>'platform'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_groups) as wanted(value)
          where wanted.value->>'third_party' = d.third_party
            and wanted.value->>'channel_type' = d.channel_type
        );

      insert into public.workorder_issue_snapshot_heads as current_head (
        source_system,
        country_code,
        platform,
        timezone,
        stat_date,
        current_snapshot_id,
        snapshot_at,
        updated_at
      ) values (
        p_snapshot->>'source_system',
        p_snapshot->>'country_code',
        p_snapshot->>'platform',
        p_snapshot->>'timezone',
        v_date,
        v_id,
        v_snapshot_at,
        pg_catalog.clock_timestamp()
      )
      on conflict (source_system, country_code, platform, stat_date)
      do update set
        timezone = excluded.timezone,
        current_snapshot_id = excluded.current_snapshot_id,
        snapshot_at = excluded.snapshot_at,
        updated_at = excluded.updated_at
      where excluded.snapshot_at > current_head.snapshot_at;

      v_accepted := true;
    end if;
  end if;

  select h.current_snapshot_id, h.snapshot_at
  into v_current_id, v_current_at
  from public.workorder_issue_snapshot_heads h
  where h.source_system = p_snapshot->>'source_system'
    and h.country_code = p_snapshot->>'country_code'
    and h.platform = p_snapshot->>'platform'
    and h.stat_date = v_date;

  if v_current_id is null then
    raise exception using errcode = '55000', message = 'WOI_STORAGE_INCONSISTENT';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', case
      when v_current_id <> v_id then 'stale'
      when v_replay then 'unchanged'
      when v_accepted then 'accepted'
      else 'stale'
    end,
    'snapshot_id', v_id::text,
    'current_snapshot_id', v_current_id::text,
    'current_snapshot_at', pg_catalog.to_char(
      v_current_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
end;
$function$;
