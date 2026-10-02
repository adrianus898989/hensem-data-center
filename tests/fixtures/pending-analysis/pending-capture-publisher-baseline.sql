-- Captured production function definitions only; no credentials or business rows.
-- Source contract read-only audit 2026-10-02. Synthetic tests create all rows locally.
CREATE OR REPLACE FUNCTION public.publish_withdraw_pending_details(p_token_hash text, p_snapshot jsonb, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s jsonb; sid uuid; receipt public.withdraw_pending_order_receipts%rowtype;
  cc integer; oc integer; n integer; total numeric; hs jsonb; rows jsonb; groups_actual jsonb; groups_expected jsonb;
  h text; dh text; ack jsonb; chunk record; prior_publish text;
BEGIN
  PERFORM public.withdraw_pending_assert_snapshot(p_snapshot);
  s:=p_snapshot-ARRAY['schema_version','coverage','totals','groups'];
  PERFORM public.withdraw_pending_details_assert_scope(p_token_hash,s);
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' OR p_manifest->'details_version' IS DISTINCT FROM '1'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_manifest) k WHERE k<>ALL(ARRAY['details_version','chunk_count','order_count']))
    OR public.withdraw_pending_is_count(p_manifest->'chunk_count') IS DISTINCT FROM true
    OR public.withdraw_pending_is_count(p_manifest->'order_count') IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_MANIFEST';
  END IF;
  IF (p_manifest->>'chunk_count')::numeric>200 OR (p_manifest->>'order_count')::numeric>100000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_MANIFEST';
  END IF;
  cc:=(p_manifest->>'chunk_count')::integer; oc:=(p_manifest->>'order_count')::integer;
  IF (cc=0)<>(oc=0) OR oc<>(p_snapshot#>>'{totals,pending_count}')::integer OR oc<cc OR oc>cc*500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_MANIFEST';
  END IF;
  sid:=(s->>'snapshot_id')::uuid;
  h:=encode(extensions.digest(p_snapshot::text,'sha256'),'hex');
  -- Serialize detail replacement by logical day; legacy summary upserts also hold their row lock to commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdraw-pending-scope:'||jsonb_build_array(s->>'source_system',s->>'country_code',s->>'platform',s->>'stat_date')::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('withdraw-pending-snapshot:'||sid::text,0));
  SELECT * INTO receipt FROM public.withdraw_pending_order_receipts WHERE snapshot_id=sid;
  IF FOUND THEN
    IF receipt.scope<>s OR receipt.snapshot_hash<>h OR receipt.chunk_count<>cc OR receipt.order_count<>oc THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='WP_ID_CONFLICT';
    END IF;
    prior_publish:=current_setting('withdraw_pending.details_publish',true);
    PERFORM set_config('withdraw_pending.details_publish',sid::text,true);
    BEGIN
      ack:=public.publish_withdraw_pending_snapshot(p_token_hash,p_snapshot);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('withdraw_pending.details_publish',coalesce(prior_publish,''),true);
      RAISE;
    END;
    PERFORM set_config('withdraw_pending.details_publish',coalesce(prior_publish,''),true);
    RETURN ack||jsonb_build_object('details_version',1,'order_count',oc);
  END IF;
  SELECT count(*) INTO n FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid AND expires_at>clock_timestamp();
  IF n<>cc OR EXISTS(SELECT 1 FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid
    AND (scope<>s OR chunk_count<>cc OR expires_at<=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_INCOMPLETE';
  END IF;
  -- Each chunk is revalidated at publication; no partial or malformed snapshot can publish.
  FOR chunk IN SELECT * FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid ORDER BY chunk_index LOOP
    PERFORM public.withdraw_pending_details_assert_orders(s,chunk.orders);
  END LOOP;
  SELECT coalesce(jsonb_agg(chunk_hash ORDER BY chunk_index),'[]'::jsonb) INTO hs FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid;
  SELECT coalesce(jsonb_agg(o.value ORDER BY o.value->>'order_no'),'[]'::jsonb) INTO rows
    FROM public.withdraw_pending_order_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.orders) o WHERE c.snapshot_id=sid;
  SELECT count(*),coalesce(sum((value->>'amount')::numeric),0) INTO n,total FROM jsonb_array_elements(rows);
  IF n<>oc OR (SELECT count(DISTINCT value->>'order_no') FROM jsonb_array_elements(rows))<>oc
    OR total<>(p_snapshot#>>'{totals,pending_amount}')::numeric THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_TOTALS';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_channel',raw_channel,'channel_type',channel_type,'pending_count',cnt,'pending_amount',amt)
    ORDER BY raw_channel,channel_type),'[]'::jsonb) INTO groups_actual FROM (
      SELECT value->>'raw_channel' raw_channel,value->>'channel_type' channel_type,count(*) cnt,sum((value->>'amount')::numeric) amt
      FROM jsonb_array_elements(rows) GROUP BY 1,2) g;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'raw_channel',value->>'channel_type'),'[]'::jsonb)
    INTO groups_expected FROM jsonb_array_elements(p_snapshot->'groups');
  IF groups_actual<>groups_expected THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_GROUPS'; END IF;
  dh:=encode(extensions.digest(rows::text,'sha256'),'hex');
  prior_publish:=current_setting('withdraw_pending.details_publish',true);
  PERFORM set_config('withdraw_pending.details_publish',sid::text,true);
  BEGIN
    ack:=public.publish_withdraw_pending_snapshot(p_token_hash,p_snapshot);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('withdraw_pending.details_publish',coalesce(prior_publish,''),true);
    RAISE;
  END;
  PERFORM set_config('withdraw_pending.details_publish',coalesce(prior_publish,''),true);
  INSERT INTO public.withdraw_pending_order_receipts(snapshot_id,scope,snapshot_hash,details_hash,chunk_hashes,chunk_count,order_count)
    VALUES(sid,s,h,dh,hs,cc,oc);
  IF ack->>'current_snapshot_id'=sid::text THEN
    DELETE FROM public.withdraw_pending_orders WHERE source_system=s->>'source_system' AND country_code=s->>'country_code'
      AND platform=s->>'platform' AND stat_date=(s->>'stat_date')::date;
    INSERT INTO public.withdraw_pending_orders(source_system,country_code,platform,stat_date,order_no,member_id,amount,applied_at,timezone,raw_channel,channel_type,status,snapshot_id,snapshot_at)
    SELECT s->>'source_system',s->>'country_code',s->>'platform',(s->>'stat_date')::date,value->>'order_no',value->>'member_id',(value->>'amount')::numeric,
      (value->>'applied_at')::timestamp,s->>'timezone',value->>'raw_channel',value->>'channel_type',value->>'status',sid,(s->>'snapshot_at')::timestamptz
    FROM jsonb_array_elements(rows);
  END IF;
  DELETE FROM public.withdraw_pending_order_chunks WHERE snapshot_id=sid;
  RETURN ack||jsonb_build_object('details_version',1,'order_count',oc);
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_withdraw_pending_snapshot(p_token_hash text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_credential public.withdraw_pending_credentials%rowtype; v_receipt public.withdraw_pending_snapshot_receipts%rowtype;
  v_id uuid; v_current_id uuid; v_written_id uuid; v_hash text; v_replay boolean := false;
begin
  select * into v_credential from public.withdraw_pending_credentials where token_hash=p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then raise exception using errcode='28000', message='WP_AUTH_INVALID'; end if;
  perform public.withdraw_pending_assert_snapshot(p_snapshot);
  -- Coordinate old and new publishers so a legacy writer cannot race past the detail guard.
  perform pg_advisory_xact_lock(hashtextextended('withdraw-pending-scope:'||jsonb_build_array(p_snapshot->>'source_system',p_snapshot->>'country_code',p_snapshot->>'platform',p_snapshot->>'stat_date')::text,0));
  if current_setting('withdraw_pending.details_publish',true) is distinct from p_snapshot->>'snapshot_id'
    and exists(select 1 from public.withdraw_pending_daily d join public.withdraw_pending_order_receipts r on r.snapshot_id=d.snapshot_id
      where d.source_system=p_snapshot->>'source_system' and d.country_code=p_snapshot->>'country_code'
      and d.platform=p_snapshot->>'platform' and d.stat_date=(p_snapshot->>'stat_date')::date
      and d.snapshot_at<(p_snapshot->>'snapshot_at')::timestamptz) then
    raise exception using errcode='22023',message='WP_INVALID_DETAILS_REQUIRED';
  end if;
  if v_credential.source_system <> p_snapshot->>'source_system' or not v_credential.allowed_scopes @> jsonb_build_array(jsonb_build_object('country_code',p_snapshot->>'country_code','platform',p_snapshot->>'platform','timezone',p_snapshot->>'timezone')) then raise exception using errcode='42501', message='WP_SCOPE_DENIED'; end if;
  v_id := (p_snapshot->>'snapshot_id')::uuid; v_hash := encode(extensions.digest(p_snapshot::text,'sha256'),'hex');
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
$function$;

CREATE OR REPLACE FUNCTION public.refresh_withdraw_pending_backlog()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s jsonb:=NEW.scope; capture_day date; zone text; cnt integer; total_count bigint; total_amount numeric;
  fetched bigint; groups_json jsonb; snap jsonb; latest timestamptz; window_days integer; first_day date; last_day date;
BEGIN
  zone:=s->>'timezone'; capture_day:=((s->>'snapshot_at')::timestamptz AT TIME ZONE zone)::date;
  window_days:=CASE WHEN capture_day >= DATE '2026-09-20' THEN 7 ELSE 30 END;
  first_day:=capture_day-window_days; last_day:=capture_day-1;
  -- NEWAR launch policy excludes pre-launch test orders. Its first week contains
  -- only official application days; no invented zero partitions are required.
  IF s->>'source_system'='WITHDRAW_REVIEW' THEN
    SELECT greatest(first_day, (p.launch_at AT TIME ZONE p.timezone)::date)
      INTO first_day FROM public.newar_detail_platforms p
      WHERE p.platform=s->>'platform' AND p.country_code=s->>'country_code'
        AND p.timezone=zone AND p.launch_at IS NOT NULL;
    first_day:=coalesce(first_day,capture_day-window_days);
    IF first_day>last_day THEN RETURN NEW; END IF;
    window_days:=last_day-first_day+1;
  END IF;
  -- An older 30-day queue may still deliver archived partitions. Keep its stored data,
  -- but do not let an out-of-window receipt publish or replace the current 7-day head.
  IF (s->>'stat_date')::date NOT BETWEEN first_day AND last_day THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('withdraw-pending-backlog:'||jsonb_build_array(s->>'source_system',s->>'country_code',s->>'platform')::text,0));
  -- Recheck after acquiring the platform lock: stale receipts cannot change source/head identity.
  IF NOT EXISTS(SELECT 1 FROM public.withdraw_pending_daily d WHERE d.snapshot_id=NEW.snapshot_id
    AND d.source_system=s->>'source_system' AND d.country_code=s->>'country_code' AND d.platform=s->>'platform'
    AND d.stat_date=(s->>'stat_date')::date
    AND d.snapshot-ARRAY['schema_version','coverage','totals','groups']=s) THEN RETURN NEW; END IF;
  INSERT INTO public.withdraw_pending_backlog_sources(source_system,country_code,platform)
    VALUES(s->>'source_system',s->>'country_code',s->>'platform') ON CONFLICT DO NOTHING;
  SELECT count(*),sum((d.snapshot#>>'{totals,pending_count}')::bigint),sum((d.snapshot#>>'{totals,pending_amount}')::numeric),
    sum((d.snapshot#>>'{coverage,fetched_count}')::bigint),max(d.snapshot_at)
    INTO cnt,total_count,total_amount,fetched,latest
    FROM public.withdraw_pending_daily d JOIN public.withdraw_pending_order_receipts r ON r.snapshot_id=d.snapshot_id
    WHERE d.source_system=s->>'source_system' AND d.country_code=s->>'country_code' AND d.platform=s->>'platform'
      AND d.stat_date BETWEEN first_day AND last_day
      AND d.snapshot->>'timezone'=zone AND (d.snapshot_at AT TIME ZONE zone)::date=capture_day
      AND r.scope=d.snapshot-ARRAY['schema_version','coverage','totals','groups'];
  -- Require one current, detailed receipt for every day, including proved zero days.
  IF cnt<>window_days THEN RETURN NEW; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_channel',raw_channel,'channel_type',channel_type,
    'pending_count',n,'pending_amount',a) ORDER BY raw_channel,channel_type),'[]'::jsonb) INTO groups_json
  FROM (
    SELECT g.value->>'raw_channel' raw_channel,g.value->>'channel_type' channel_type,
      sum((g.value->>'pending_count')::bigint) n,sum((g.value->>'pending_amount')::numeric) a
    FROM public.withdraw_pending_daily d JOIN public.withdraw_pending_order_receipts r ON r.snapshot_id=d.snapshot_id
      CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'groups') g
    WHERE d.source_system=s->>'source_system' AND d.country_code=s->>'country_code' AND d.platform=s->>'platform'
      AND d.stat_date BETWEEN first_day AND last_day
      AND d.snapshot->>'timezone'=zone AND (d.snapshot_at AT TIME ZONE zone)::date=capture_day
      AND r.scope=d.snapshot-ARRAY['schema_version','coverage','totals','groups']
    GROUP BY 1,2
  ) q;
  snap:=jsonb_build_object('schema_version',1,'source_system',s->>'source_system','country_code',s->>'country_code',
    'platform',s->>'platform','stat_date',last_day::text,'timezone',zone,'snapshot_id',NEW.snapshot_id::text,
    'snapshot_at',to_char(latest AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'coverage',jsonb_build_object('complete',true,'expected_count',total_count,'unique_count',total_count,'fetched_count',fetched),
    'totals',jsonb_build_object('pending_count',total_count,'pending_amount',total_amount),'groups',groups_json);
  INSERT INTO public.withdraw_pending_backlog_daily(source_system,country_code,platform,stat_date,capture_date,window_start,window_end,snapshot_id,snapshot_at,snapshot)
    VALUES(s->>'source_system',s->>'country_code',s->>'platform',last_day,capture_day,first_day,last_day,NEW.snapshot_id,latest,snap)
    ON CONFLICT(source_system,country_code,platform,stat_date) DO UPDATE SET capture_date=excluded.capture_date,
      window_start=excluded.window_start,window_end=excluded.window_end,snapshot_id=excluded.snapshot_id,
      snapshot_at=excluded.snapshot_at,snapshot=excluded.snapshot,updated_at=clock_timestamp()
    WHERE public.withdraw_pending_backlog_daily.snapshot_at<=excluded.snapshot_at;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_pending_assert_snapshot(p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    or p_snapshot->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
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
    or public.withdraw_pending_is_count(v_coverage->'expected_count') is distinct from true
    or public.withdraw_pending_is_count(v_coverage->'fetched_count') is distinct from true
    or public.withdraw_pending_is_count(v_coverage->'unique_count') is distinct from true
    or public.withdraw_pending_is_count(v_totals->'pending_count') is distinct from true
    or public.withdraw_pending_is_amount(v_totals->'pending_amount') is distinct from true
    or (v_coverage->>'fetched_count')::numeric < (v_coverage->>'unique_count')::numeric
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
      or public.withdraw_pending_is_count(v_group->'pending_count') is distinct from true
      or public.withdraw_pending_is_amount(v_group->'pending_amount') is distinct from true
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
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_pending_details_assert_orders(p_scope jsonb, p_orders jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r jsonb; k text; a timestamp without time zone;
BEGIN
  IF jsonb_typeof(p_orders) IS DISTINCT FROM 'array' OR jsonb_array_length(p_orders) NOT BETWEEN 1 AND 500
    OR octet_length(p_orders::text)>524288 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_ORDERS';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(r) AS f(key_name) WHERE f.key_name<>ALL(ARRAY['order_no','member_id','amount','applied_at','raw_channel','channel_type','status'])) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_ORDER';
    END IF;
    FOREACH k IN ARRAY ARRAY['order_no','member_id','amount','applied_at','raw_channel','channel_type','status'] LOOP
      IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR length(r->>k) NOT BETWEEN 1 AND (CASE k WHEN 'order_no' THEN 160 WHEN 'member_id' THEN 80 ELSE 100 END)
        OR r->>k<>btrim(r->>k) OR r->>k~'[[:cntrl:]]' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_ORDER';
      END IF;
    END LOOP;
    IF r->>'order_no' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' OR r->>'member_id' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' OR r->>'status'<>'已提交' OR r->>'amount' !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$'
      OR NOT public.collection_success_safe_descriptor(r->>'raw_channel',96)
      OR NOT public.collection_success_safe_descriptor(r->>'channel_type',48)
      OR r->>'applied_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_ORDER';
    END IF;
    IF (r->>'amount')::numeric>90071992547409.91 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_ORDER';
    END IF;
    BEGIN
      a:=(r->>'applied_at')::timestamp;
      IF a::date<>(p_scope->>'stat_date')::date OR to_char(a,'YYYY-MM-DD HH24:MI:SS')<>r->>'applied_at' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_DATE';
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_DATE';
    END;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value->>'order_no') FROM jsonb_array_elements(p_orders)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_DUPLICATE';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_pending_details_assert_scope(p_token_hash text, p_scope jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c public.withdraw_pending_credentials%rowtype; k text; d date; a timestamptz;
BEGIN
  SELECT * INTO c FROM public.withdraw_pending_credentials WHERE token_hash=p_token_hash FOR SHARE;
  IF NOT FOUND OR c.revoked OR c.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WP_AUTH_INVALID';
  END IF;
  IF jsonb_typeof(p_scope) IS DISTINCT FROM 'object' OR
     EXISTS (SELECT 1 FROM jsonb_object_keys(p_scope) AS f(key_name) WHERE f.key_name <> ALL(ARRAY['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at'])) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_SCOPE';
  END IF;
  FOREACH k IN ARRAY ARRAY['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at'] LOOP
    IF jsonb_typeof(p_scope->k) IS DISTINCT FROM 'string' OR length(p_scope->>k) NOT BETWEEN 1 AND 100
       OR p_scope->>k <> btrim(p_scope->>k) OR p_scope->>k ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_SCOPE';
    END IF;
  END LOOP;
  IF p_scope->>'source_system' <> 'WITHDRAW_REVIEW' OR p_scope->>'country_code' !~ '^[A-Z]{2}$'
    OR NOT public.collection_success_safe_descriptor(p_scope->>'platform',80)
    OR p_scope->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR p_scope->>'snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_scope->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_scope->>'timezone') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_SCOPE';
  END IF;
  BEGIN
    d:=(p_scope->>'stat_date')::date; a:=(p_scope->>'snapshot_at')::timestamptz;
    IF d<date '2020-01-01' OR d>=(clock_timestamp() AT TIME ZONE (p_scope->>'timezone'))::date
      OR d>=(a AT TIME ZONE (p_scope->>'timezone'))::date OR a>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_DATE';
    END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WP_INVALID_DETAILS_DATE';
  END;
  IF c.source_system<>p_scope->>'source_system' OR NOT c.allowed_scopes @> jsonb_build_array(jsonb_build_object(
    'country_code',p_scope->>'country_code','platform',p_scope->>'platform','timezone',p_scope->>'timezone')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WP_SCOPE_DENIED';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_pending_is_amount(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_typeof(p_value) = 'number'
    and (p_value::text)::numeric between 0 and 9007199254740991
    and pg_catalog.round((p_value::text)::numeric, 2) = (p_value::text)::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_pending_is_count(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_typeof(p_value) = 'number'
    and (p_value::text)::numeric between 0 and 9007199254740991
    and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric;
$function$;
