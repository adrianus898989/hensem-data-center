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
$function$
