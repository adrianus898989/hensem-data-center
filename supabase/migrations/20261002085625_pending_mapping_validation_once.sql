-- Request-local read optimization only. Existing publishers, original
-- validator, scope/gateway entry points and business observations stay intact.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
do $preflight$
declare r record;p pg_proc%rowtype;
begin
 for r in select * from(values
  ('private.dashboard_admin_live_pending_analysis(jsonb)','380bb5659b1cd8400f8751a6aa4abc33'),
  ('private.dashboard_admin_pending_resolved_day(jsonb,jsonb,jsonb,jsonb)','d2d0803d0ada6953b460dc9e231baa28'),
  ('public.withdraw_pending_assert_snapshot(jsonb)','fa3cd408659596d6dd3ffbe2c494cce2')
 )v(signature,body_md5)loop
  select *into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_md5 or p.proowner<>'postgres'::regrole
   or p.proconfig is distinct from array['search_path=""']then
   raise exception 'pending_cache_baseline_drift: %',r.signature;end if;
 end loop;
 select *into p from pg_proc where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure;
 if not p.prosecdef or p.provolatile<>'s' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'then
  raise exception 'pending_cache_access_drift';end if;
 if to_regprocedure('private.dashboard_admin_pending_assert_snapshot_cached(jsonb,text[])')is not null
  or to_regprocedure('private.dashboard_admin_pending_resolved_day_cached(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')is not null then
  raise exception 'pending_cache_objects_exist';end if;
end $preflight$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_pending_assert_snapshot_cached(p_snapshot jsonb, p_timezones text[])
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
    or coalesce((p_snapshot->>'timezone')=any(p_timezones),false) is not true then
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
;
CREATE OR REPLACE FUNCTION private.dashboard_admin_pending_resolved_day_cached(p_request jsonb, p_scope jsonb, p_catalog jsonb, p_backlogs jsonb, p_provider_map jsonb, p_timezones text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=p_scope; v_date date; v_ids uuid[]; v_providers text[]:='{}';
 v_catalog jsonb; v_rows jsonb:='[]'; v_groups jsonb; v_item jsonb; v_target record; v_snap public.withdraw_pending_backlog_daily%rowtype; v_g jsonb;
 v_state text; v_matches integer; v_received integer:=0; v_count bigint:=0; v_amount numeric:=0;
 v_row_count bigint; v_row_amount numeric; v_valid boolean; v_provider text; v_row_groups jsonb;
 v_currency text; v_min_at timestamptz; v_max_at timestamptz; v_launch date;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['date','platformIds','providers']))
  or jsonb_typeof(p_request->'date') is distinct from 'string'
  or p_request->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_request->'platformIds') is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 begin v_date:=(p_request->>'date')::date;
 exception when others then raise exception using errcode='22023',message='invalid_date';end;
 if v_date<date '2000-01-01' or v_date>current_date+1 or to_char(v_date,'YYYY-MM-DD')<>p_request->>'date'
  or jsonb_array_length(p_request->'platformIds') not between 1 and 250
  or exists(select 1 from jsonb_array_elements(p_request->'platformIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_request->'platformIds');
 if cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids)x) then raise exception using errcode='22023',message='duplicate_platform';end if;
 if p_request ? 'providers' then
  if jsonb_typeof(p_request->'providers') is distinct from 'array' or jsonb_array_length(p_request->'providers')>250
   or exists(select 1 from jsonb_array_elements(p_request->'providers')x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 200 or btrim(x#>>'{}')='' or x#>>'{}' ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_filter';end if;
  select coalesce(array_agg(value),'{}') into v_providers from jsonb_array_elements_text(p_request->'providers');
  if cardinality(v_providers)<>(select count(distinct x) from unnest(v_providers)x) then raise exception using errcode='22023',message='duplicate_provider';end if;
 end if;
 v_catalog:=p_catalog;
 if (select count(distinct x->>'id') from jsonb_array_elements(v_catalog)x)<>cardinality(v_ids) then
  raise exception using errcode='42501',message='platform_denied';
 end if;
 if (select count(distinct x->>'currency') from jsonb_array_elements(v_catalog)x where nullif(x->>'currency','') is not null)>1 then
  raise exception using errcode='22023',message='mixed_currency';
 end if;
 select min(nullif(x->>'currency','')) into v_currency from jsonb_array_elements(v_catalog)x;
 -- Native/report representations of one source are one stock target. Explicit
 -- IN RAJA/RAJALOTTERY is the only additional alias; countries never coalesce.
 for v_target in
  select x->>'scope_group' as scope_group,x->>'platform_key' as platform_key,
   case when x->>'source' in('ar','newar','withdraw') then 'withdraw_review' else x->>'source' end as source_family,
   (jsonb_agg(x order by (x->>'source'='withdraw'),x->>'id')->0) as p,
   jsonb_agg(x->>'id' order by x->>'id') as ids,
   bool_or((x->>'mapping_ambiguous')::boolean or x->>'team'='__team_conflict__') or count(distinct x->>'team')>1 as ambiguous
  from jsonb_array_elements(v_catalog)x group by 1,2,3 order by 1,2,3
 loop
  v_item:=v_target.p; v_state:='missing';v_row_count:=null;v_row_amount:=null;v_row_groups:='[]';v_valid:=false;
  v_snap:=null;v_matches:=0;
  -- WG_EXISTING_FEEDS_V1
  if v_target.source_family='wg' then
   v_item:=private.dashboard_admin_wg_pending_row(v_item,v_date,v_providers)||jsonb_build_object('selectedIds',v_target.ids);
   v_rows:=v_rows||jsonb_build_array(v_item);
   if v_item->>'state'='complete' then
    v_received:=v_received+1;v_count:=v_count+(v_item->>'count')::bigint;v_amount:=v_amount+(v_item->>'amount')::numeric;
    v_min_at:=least(v_min_at,(v_item->>'snapshotAt')::timestamptz);v_max_at:=greatest(v_max_at,(v_item->>'snapshotAt')::timestamptz);
   end if;
   continue;
  end if;
  if v_target.source_family<>'withdraw_review' then v_state:='unsupported';
  elsif v_target.scope_group='IN' and v_target.platform_key='RAJALOTTERY' and v_item->>'team' is distinct from 'M8' then v_state:='unsupported';
  elsif v_target.ambiguous then v_state:='ambiguous';
  elsif nullif(v_item->>'currency','') is null or nullif(v_item->>'timezone','') is null then v_state:='unsupported';
  else
   select count(*) into v_matches from jsonb_populate_recordset(null::public.withdraw_pending_backlog_daily,p_backlogs) b
    where b.country_code=v_target.scope_group and b.stat_date=v_date
     and private.dashboard_admin_pending_platform_key(b.country_code,b.platform)=v_target.platform_key
     and private.dashboard_scope_allows(v_scope,b.country_code,b.platform);
   if v_matches>1 then v_state:='ambiguous';
   elsif v_matches=1 then
    select b.* into v_snap from jsonb_populate_recordset(null::public.withdraw_pending_backlog_daily,p_backlogs) b
     where b.country_code=v_target.scope_group and b.stat_date=v_date
      and private.dashboard_admin_pending_platform_key(b.country_code,b.platform)=v_target.platform_key
      and private.dashboard_scope_allows(v_scope,b.country_code,b.platform);
    v_valid:=true;
    begin
     perform private.dashboard_admin_pending_assert_snapshot_cached(v_snap.snapshot,p_timezones);
     if v_snap.source_system<>'WITHDRAW_REVIEW'
      or v_snap.snapshot->>'source_system' is distinct from v_snap.source_system
      or v_snap.snapshot->>'country_code' is distinct from v_snap.country_code
      or v_snap.snapshot->>'platform' is distinct from v_snap.platform
      or v_snap.snapshot->>'stat_date' is distinct from v_date::text
      or v_snap.snapshot->>'snapshot_id' is distinct from v_snap.snapshot_id::text
      or (v_snap.snapshot->>'snapshot_at')::timestamptz is distinct from v_snap.snapshot_at
      or v_snap.snapshot->>'timezone' is distinct from v_item->>'timezone'
      or v_snap.capture_date is distinct from v_date+1
      or v_snap.window_end is distinct from v_date
      or v_snap.window_start is null or v_snap.window_start<v_date-6 or v_snap.window_start>v_date
      or not isfinite(v_snap.snapshot_at)
      or (v_snap.snapshot_at at time zone (v_item->>'timezone'))::date is distinct from v_snap.capture_date then v_valid:=false;end if;
     if v_valid and v_snap.window_start>v_date-6 then
      select min((p.launch_at at time zone p.timezone)::date) into v_launch
       from public.newar_detail_platforms p
       where p.country_code=v_snap.country_code and p.platform=v_snap.platform
        and p.timezone=v_item->>'timezone' and p.launch_at is not null;
      if v_launch is distinct from v_snap.window_start then v_valid:=false;end if;
     end if;
    exception when data_exception then v_valid:=false;
    end;
    if v_valid then
     v_state:='complete';v_row_count:=0;v_row_amount:=0;
     for v_g in select value from jsonb_array_elements(v_snap.snapshot->'groups') loop
      -- Request-local mapping uses the complete source tuple, including nulls.
      -- Missing entries are defensive legacy fallback; valid selected groups
      -- have one precomputed value even when that value itself is null.
      v_provider:=case when p_provider_map?jsonb_build_array(v_item->>'country',v_snap.platform,v_g->>'raw_channel')::text
       then p_provider_map->>jsonb_build_array(v_item->>'country',v_snap.platform,v_g->>'raw_channel')::text
       else private.dashboard_admin_live_provider_canonical(v_item->>'country',v_snap.platform,v_g->>'raw_channel') end;
      if cardinality(v_providers)=0 or v_provider=any(v_providers) then
       v_row_count:=v_row_count+(v_g->>'pending_count')::bigint;
       v_row_amount:=v_row_amount+(v_g->>'pending_amount')::numeric;
       v_row_groups:=v_row_groups||jsonb_build_array(jsonb_build_object('provider',v_provider,
        'rawChannel',v_g->>'raw_channel','channelType',v_g->>'channel_type',
        'count',(v_g->>'pending_count')::bigint,'amount',(v_g->>'pending_amount')::numeric::text));
      end if;
     end loop;
     v_received:=v_received+1;v_count:=v_count+v_row_count;v_amount:=v_amount+v_row_amount;
     v_min_at:=least(v_min_at,v_snap.snapshot_at);v_max_at:=greatest(v_max_at,v_snap.snapshot_at);
    else v_state:='invalid';end if;
   end if;
  end if;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
   'id',v_item->>'id','selectedIds',v_target.ids,'name',case when v_target.source_family='withdraw_review' and v_target.scope_group='IN' and v_target.platform_key='RAJALOTTERY' then 'RAJA' else v_item->>'name' end,
   'sourceName',v_item->>'source_name','source',v_item->>'source','country',v_item->>'country','scopeGroup',v_target.scope_group,
   'team',v_item->>'team','currency',v_item->>'currency','timezone',v_item->>'timezone',
   'state',v_state,'count',v_row_count,'amount',v_row_amount::text,'groups',v_row_groups,
   'windowStart',case when v_matches=1 then v_snap.window_start end,
   'windowEnd',case when v_matches=1 then v_snap.window_end end,
   'captureDate',case when v_matches=1 then v_snap.capture_date end,
   'snapshotAt',case when v_matches=1 then v_snap.snapshot_at end,
   'updatedAt',case when v_matches=1 then v_snap.updated_at end,
   'coverage',case when v_valid then v_snap.snapshot->'coverage' end));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'count',n,'amount',a::text) order by n desc,provider),'[]') into v_groups
 from(select g->>'provider' provider,sum((g->>'count')::bigint)::bigint n,sum((g->>'amount')::numeric) a
  from jsonb_array_elements(v_rows)r cross join lateral jsonb_array_elements(r->'groups')g group by 1)g;
 return jsonb_build_object('version',1,'basis','seven_day_pending_snapshot','date',v_date,'snapshotDate',v_date,
  'windowStart',v_date-6,'windowEnd',v_date,'currency',v_currency,
  'complete',v_received=jsonb_array_length(v_rows),'expectedPlatformCount',jsonb_array_length(v_rows),'receivedPlatformCount',v_received,
  'requestedIdCount',cardinality(v_ids),'amount',case when v_received>0 then v_amount::text end,'count',case when v_received>0 then v_count end,
  'summary',jsonb_build_object('amount',case when v_received>0 then v_amount::text end,'count',case when v_received>0 then v_count end),
  'observedAt',v_max_at,'firstObservedAt',v_min_at,'rows',v_rows,'groups',v_groups,
  'missingPlatforms',(select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','state',r->>'state')),'[]') from jsonb_array_elements(v_rows)r where r->>'state'<>'complete'));
end;
$function$
;
revoke all on function private.dashboard_admin_pending_assert_snapshot_cached(jsonb,text[]),
 private.dashboard_admin_pending_resolved_day_cached(jsonb,jsonb,jsonb,jsonb,jsonb,text[])from public,anon,authenticated,service_role;
do $replace$
declare before_meta jsonb;
begin
 select to_jsonb(p)-'prosrc'into before_meta from pg_proc p where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure;
 execute $main$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_pending_analysis(p_request jsonb)
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
$function$
;$main$;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure)is distinct from before_meta then
  raise exception 'pending_cache_metadata_drift';end if;
end $replace$;
notify pgrst,'reload schema';commit;
