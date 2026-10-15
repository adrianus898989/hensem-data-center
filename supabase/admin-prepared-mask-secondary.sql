-- Pure result shaping when a native source has no proven secondary clock.
-- Creation facts and native evidence remain usable; absence is never zero.
create or replace function private.prepared_aggregate_mask_secondary_row(
  p_row jsonb,p_reason text,p_direction text,p_parent_direction text default null,p_depth integer default 0
) returns jsonb language plpgsql immutable security invoker set search_path='' as $function$
declare
  r jsonb:=p_row; d text; k text; children jsonb;
begin
  if p_depth>16 then raise exception 'prepared_secondary_result_depth';end if;
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'prepared_secondary_invalid_row';end if;
  d:=coalesce(r->>'direction',p_parent_direction);
  if p_direction='all' or d=p_direction then
    for k in select jsonb_object_keys(r) loop
      -- Fee bands are facts of the secondary success cohort. Identity, provider
      -- and fee category metadata are kept separately from these facts.
      if k in ('success_count','success_amount','success_rate','successRate','success_member_count','success_order_count')
        or k ~ '^fee_.*_(count|amount)$' then
        r:=jsonb_set(r,array[k],'null'::jsonb);
      elsif k='fee_version_state' then r:=jsonb_set(r,array[k],'"unavailable"'::jsonb);
      end if;
    end loop;
    r:=r||jsonb_build_object('success_count',null,'success_amount',null,'success_available',false,
      'success_unavailable_reason',p_reason,'fee_available',false,'fee_unavailable_reason',p_reason);
  end if;
  foreach k in array array['items','fee_items'] loop
    if r ? k then
      if jsonb_typeof(r->k) is distinct from 'array' then raise exception 'prepared_secondary_invalid_children';end if;
      select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction,d,p_depth+1) order by n),'[]'::jsonb)
        into children from jsonb_array_elements(r->k) with ordinality t(x,n);
      r:=jsonb_set(r,array[k],children);
    end if;
  end loop;
  return r;
end;
$function$;

create or replace function private.prepared_aggregate_mask_secondary(
  p_payload jsonb,p_reason text,p_direction text default 'all'
) returns jsonb language plpgsql immutable security invoker set search_path='' as $function$
declare
  r jsonb:=p_payload; caps jsonb; groups jsonb; k text; rows jsonb; d text;
begin
  if jsonb_typeof(r) is distinct from 'object' or nullif(btrim(p_reason),'') is null
    or p_direction is null or p_direction not in ('all','charge','withdraw')
    or jsonb_typeof(r->'summary') is distinct from 'array'
    or jsonb_typeof(r->'groups') is distinct from 'object'
  then raise exception 'prepared_secondary_invalid_result';end if;
  select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction) order by n),'[]'::jsonb)
    into rows from jsonb_array_elements(r->'summary') with ordinality t(x,n);
  r:=jsonb_set(r,'{summary}',rows);groups:=r->'groups';
  for k in select jsonb_object_keys(groups) loop
    if jsonb_typeof(groups->k) is distinct from 'array' then raise exception 'prepared_secondary_invalid_group';end if;
    if k in ('latency','latency_thresholds','latency_custom') then
      select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into rows
        from jsonb_array_elements(groups->k) with ordinality t(x,n)
        where p_direction<>'all' and x->>'direction' in ('charge','withdraw') and x->>'direction'<>p_direction;
    elsif k in ('pending_age','pending_age_thresholds') then
      -- Pending age is based on creation and asOf, independent of success.
      continue;
    else
      select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction) order by n),'[]'::jsonb)
        into rows from jsonb_array_elements(groups->k) with ordinality t(x,n);
    end if;
    groups:=jsonb_set(groups,array[k],rows);
  end loop;
  r:=jsonb_set(r,'{groups}',groups);
  if r ? 'latencySummary' then
    if jsonb_typeof(r->'latencySummary') is distinct from 'array' then raise exception 'prepared_secondary_invalid_latency';end if;
    select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into rows
      from jsonb_array_elements(r->'latencySummary') with ordinality t(x,n)
      where p_direction<>'all' and x->>'direction' in ('charge','withdraw') and x->>'direction'<>p_direction;
    r:=jsonb_set(r,'{latencySummary}',rows);
  end if;
  caps:=coalesce(r->'capabilities','{}'::jsonb);
  if jsonb_typeof(caps)<>'object' then raise exception 'prepared_secondary_invalid_capabilities';end if;
  foreach d in array case when p_direction='all' then array['charge','withdraw'] else array[p_direction] end loop
    caps:=caps||jsonb_build_object(d||'SuccessTimeAvailable',false,d||'SecondaryTimeAvailable',false,
      d||'SecondaryTimeUnavailableReason',p_reason,d||'LatencyAvailable',false);
  end loop;
  if p_direction='all' then
    caps:=caps||jsonb_build_object('successTimeAvailable',false,'secondaryTimeAvailable',false,
      'secondaryTimeUnavailableReason',p_reason,'latencyAvailable',false);
  else
    caps:=caps||jsonb_build_object('secondaryTimeAvailability','partial');
  end if;
  r:=r||jsonb_build_object('capabilities',caps);
  if jsonb_typeof(r->'platform')='object' then
    r:=jsonb_set(r,'{platform,capabilities}',coalesce(r->'platform'->'capabilities','{}'::jsonb)||caps);
  end if;
  return r;
end;
$function$;
revoke all on function private.prepared_aggregate_mask_secondary_row(jsonb,text,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.prepared_aggregate_mask_secondary(jsonb,text,text) from public,anon,authenticated,service_role;
