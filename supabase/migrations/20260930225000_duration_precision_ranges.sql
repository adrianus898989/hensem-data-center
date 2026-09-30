-- Opt-in successful-duration precision. Unversioned clients keep all legacy bins.
-- Pending-age buckets, source filters, authorization, quantiles and totals stay intact.
begin;
set local lock_timeout='3s';
create or replace function private.dashboard_admin_validate_duration(p_request jsonb)
returns jsonb language plpgsql immutable set search_path='' as $function$
declare v_version integer:=1;v_range jsonb;v_min numeric;v_max numeric;v_key text;
begin
 if not (p_request?'durationVersion' or p_request?'durationRange') then return jsonb_build_object('version',1);end if;
 if p_request->'durationVersion' is distinct from '2'::jsonb then raise exception using errcode='22023',message='invalid_duration_version';end if;
 v_version:=2;
 if p_request->>'action' is distinct from 'aggregate'
  or coalesce(p_request->>'view','full') not in('full','drilldown')
  or (p_request->>'view'='drilldown' and p_request->>'kind' is distinct from 'latency')
 then raise exception using errcode='22023',message='invalid_duration_view';end if;
 if p_request?'durationRange' then
  v_range:=p_request->'durationRange';
  if jsonb_typeof(v_range) is distinct from 'object' or v_range-array['minSeconds','maxSeconds']<>'{}'::jsonb then
   raise exception using errcode='22023',message='invalid_duration_range';end if;
  foreach v_key in array array['minSeconds','maxSeconds'] loop
   if v_range?v_key and v_range->v_key<>'null'::jsonb then
    if jsonb_typeof(v_range->v_key) is distinct from 'number' or (v_range->>v_key)::numeric<>trunc((v_range->>v_key)::numeric)
     or (v_range->>v_key)::numeric not between 0 and 315360000 then raise exception using errcode='22023',message='invalid_duration_range';end if;
   end if;
  end loop;
  v_min:=(v_range->>'minSeconds')::numeric*1000;v_max:=(v_range->>'maxSeconds')::numeric*1000;
  if (v_min is null and v_max is null) or v_min>=v_max then raise exception using errcode='22023',message='invalid_duration_range';end if;
  if p_request->>'view'='drilldown' and (p_request?'bucket' or p_request?'cumulative') then
   raise exception using errcode='22023',message='ambiguous_duration_segment';end if;
 end if;
 return jsonb_build_object('version',v_version,'custom',v_range is not null,'min_ms',v_min,'max_ms',v_max,
  'range',case when v_range is not null then jsonb_build_object('minSeconds',v_min/1000,'maxSeconds',v_max/1000) end);
end;$function$;
revoke all on function private.dashboard_admin_validate_duration(jsonb) from public,anon,authenticated;

do $patch_27$
declare p record;d text;old_acl aclitem[];old_owner oid;r record;n integer;
begin
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_query_raw(jsonb)');
 if not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
  or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'duration_engine_contract_drift: dashboard_admin_live_query_raw';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 if position('duration_precision_ranges_v2' in d)>0 then
  if position('private.dashboard_admin_validate_duration(' in d)=0 or position('v_duration_custom;' in d)=0 then raise exception 'duration_installation_incomplete';end if;
  return;
 end if;
 if position('dynamic_amount_bands_v1' in d)=0 or d~'\$(27|28|29|30)([^0-9]|$)' then raise exception 'duration_parameter_baseline_drift: dashboard_admin_live_query_raw';end if;
 for r in select * from (values
($old0$  v_confirmations jsonb := '{}'::jsonb;$old0$,$new0$  v_confirmations jsonb := '{}'::jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;$new0$),
($old1$'amountMin','amountMax','amountBands','offset'$old1$,$new1$'amountMin','amountMax','amountBands','durationVersion','durationRange','offset'$new1$),
($old2$  v_action:=coalesce(p_request->>'action','catalog');$old2$,$new2$  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);$new2$),
($old3$  return v_result||case when v_amount_bands is null$old3$,$new3$  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null$new3$),
($old4$time_bounds(bucket,min_ms,max_ms) as (values
    (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
    (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
    (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))$old4$,$new4$time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2)$new4$),
($old5$case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end as bucket$old5$,$new5$case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket$new5$),
($old6$from duration_summary s cross join time_bounds b left join duration_bucket_totals r$old6$,$new6$from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r$new6$),
($old7$  ), page as ($old7$,$new7$  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as ($new7$),
($old8$from duration_json where kind='pending_age' and cumulative),'[]'::jsonb)),$old8$,$new8$from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,$new8$),
($old9$v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges;$old9$,$new9$v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom;$new9$)
 )x(old_text,new_text) loop
  n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
  if n<>1 then raise exception 'duration_anchor_drift: %',left(r.old_text,100);end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if exists(select 1 from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_live_query_raw(jsonb)') and(q.proacl is distinct from old_acl or q.proowner<>old_owner)) then raise exception 'duration_acl_changed';end if;
end;$patch_27$;

do $patch_33$
declare p record;d text;old_acl aclitem[];old_owner oid;r record;n integer;
begin
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_drilldown_raw(jsonb)');
 if not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
  or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'duration_engine_contract_drift: dashboard_admin_live_drilldown_raw';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 if position('duration_precision_ranges_v2' in d)>0 then
  if position('private.dashboard_admin_validate_duration(' in d)=0 or position('v_duration_custom;' in d)=0 then raise exception 'duration_installation_incomplete';end if;
  return;
 end if;
 if position('dynamic_amount_bands_v1' in d)=0 or d~'\$(33|34|35|36)([^0-9]|$)' then raise exception 'duration_parameter_baseline_drift: dashboard_admin_live_drilldown_raw';end if;
 for r in select * from (values
($old0$  v_confirmations jsonb := '{}'::jsonb;$old0$,$new0$  v_confirmations jsonb := '{}'::jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;$new0$),
($old1$'amountMin','amountMax','amountBands','offset'$old1$,$new1$'amountMin','amountMax','amountBands','durationVersion','durationRange','offset'$new1$),
($old2$  v_action:=coalesce(p_request->>'action','catalog');$old2$,$new2$  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);$new2$),
($old3$  return v_result||case when v_amount_bands is null$old3$,$new3$  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null$new3$),
($old4$  if v_kind='latency' then
    if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]$' then
      raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    v_bucket:=(p_request->>'bucket')::integer;
    if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
      raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
    v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
    if v_cumulative and v_bucket=9 then raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
$old4$,$new4$  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
$new4$),
($old5$case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end as duration_bucket$old5$,$new5$case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket$new5$),
($old6$latency_ms is not null and case when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match$old6$,$new6$latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match$new6$),
($old7$'amount_share',case when valid_amount>0 then amount/valid_amount end) as value from metrics m$old7$,$new7$'amount_share',case when valid_amount>0 then amount/valid_amount end)
        ||case when $36 then jsonb_build_object('min_ms',$34::numeric,'max_ms',$35::numeric) else '{}'::jsonb end as value from metrics m$new7$),
($old8$v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges;$old8$,$new8$v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom;$new8$),
($old9$'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind$old9$,$new9$'segment',jsonb_strip_nulls(jsonb_build_object('durationRange',case when v_duration_custom then v_duration->'range' end,'durationVersion',case when v_duration_version=2 then 2 end,'kind',v_kind$new9$)
 )x(old_text,new_text) loop
  n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
  if n<>1 then raise exception 'duration_anchor_drift: %',left(r.old_text,100);end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if exists(select 1 from pg_proc q where q.oid=to_regprocedure('private.dashboard_admin_live_drilldown_raw(jsonb)') and(q.proacl is distinct from old_acl or q.proowner<>old_owner)) then raise exception 'duration_acl_changed';end if;
end;$patch_33$;
notify pgrst,'reload schema';
commit;
