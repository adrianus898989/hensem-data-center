CREATE OR REPLACE FUNCTION private.dashboard_admin_live_pending_snapshot(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope(); v_date date; v_ids uuid[]; v_providers text[]:='{}';
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
 -- Each authorized catalog is evaluated once, not once per selected ID.
 with native as materialized(select * from private.dashboard_admin_live_platforms()),
 seeds as materialized(select * from private.dashboard_admin_live_withdraw_platforms()),
 selected as materialized(
  select * from native where id=any(v_ids) union all select * from seeds where id=any(v_ids)
 ), mapped as (
  select p.*,coalesce(m.keys[1],private.dashboard_admin_pending_platform_key(p.scope_group,p.source_name)) as platform_key,
   coalesce(cardinality(m.keys)>1,false) as mapping_ambiguous
  from selected p left join lateral(
   select array_agg(distinct private.dashboard_admin_pending_platform_key(p.scope_group,t.source_platform)) as keys
   from public.dashboard_platform_team_map t
   where t.active and t.country_code=p.scope_group
    and private.dashboard_scope_allows(v_scope,t.country_code,t.source_platform)
    and (p.team is null or t.team_name=p.team)
    and (private.dashboard_admin_pending_platform_key(p.scope_group,t.source_platform)=private.dashboard_admin_pending_platform_key(p.scope_group,p.source_name)
     or private.dashboard_admin_pending_platform_key(p.scope_group,t.platform_name)=private.dashboard_admin_pending_platform_key(p.scope_group,p.name))
  )m on true
 )
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into v_catalog from mapped m;
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
   select count(*) into v_matches from public.withdraw_pending_backlog_daily b
    where b.country_code=v_target.scope_group and b.stat_date=v_date
     and private.dashboard_admin_pending_platform_key(b.country_code,b.platform)=v_target.platform_key
     and private.dashboard_scope_allows(v_scope,b.country_code,b.platform);
   if v_matches>1 then v_state:='ambiguous';
   elsif v_matches=1 then
    select b.* into v_snap from public.withdraw_pending_backlog_daily b
     where b.country_code=v_target.scope_group and b.stat_date=v_date
      and private.dashboard_admin_pending_platform_key(b.country_code,b.platform)=v_target.platform_key
      and private.dashboard_scope_allows(v_scope,b.country_code,b.platform);
    v_valid:=true;
    begin
     perform public.withdraw_pending_assert_snapshot(v_snap.snapshot);
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
      v_provider:=private.dashboard_admin_live_provider_canonical(v_item->>'country',v_snap.platform,v_g->>'raw_channel');
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
