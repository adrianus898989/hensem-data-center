-- Exact raw orders for a selected analysis segment, with an explicit event clock.
-- Reuse the reviewed, source-native drilldown predicates and safe source field
-- allowlist. Source/collector tables and existing analytical functions are unchanged.
begin;
set local statement_timeout='30s';
do $install$
declare d text;q text;latency_q text;business_q text;execute_q text;r record;n integer;a integer;b integer;cat jsonb;cat_def text;
begin
 d:=pg_get_functiondef('private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure);
 if position('custom_analysis_ranges_v1' in d)=0 or position('custom_ar_date_union_v1' in d)=0
  or position('analytical_query_contract_drift' in d)=0 then raise exception 'analysis_orders_source_contract_drift';end if;
 for r in select * from (values
  ($old$private.dashboard_admin_live_drilldown_raw(p_request jsonb)$old$,$new$private.dashboard_admin_live_analysis_orders_raw(p_request jsonb)$new$),
  ($old$  v_action text; v_options jsonb;$old$,$new$  v_basis text; v_action text; v_options jsonb;$new$),
  ($old$'offset','limit','view','kind'$old$,$new$'offset','limit','basis','kind'$new$),
  ($old$v_duration:=private.dashboard_admin_validate_duration(p_request);$old$,$new$v_duration:=private.dashboard_admin_validate_duration(p_request||jsonb_build_object('action','aggregate','view','drilldown'));$new$),
  ($old$  if v_action<>'aggregate' or p_request->>'view' is distinct from 'drilldown' then
    raise exception using errcode='22023',message='invalid_drilldown_view';
  end if;$old$,$new$  v_basis:=p_request->>'basis';
  if v_action<>'analysisOrders' or jsonb_typeof(p_request->'basis') is distinct from 'string'
    or v_basis not in ('created','success') then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  -- Keep the independent creation/success source union. The final cohort below
  -- chooses exactly one clock, including success events created on another day.
  v_action:='aggregate';$new$),
  ($old$    or v_offset<0 or v_limit not in (20,30,50,100,500)$old$,$new$    or v_offset<0 or v_limit<>20$new$),
  ($old$v_status<>'all' or v_offset<>0$old$,$new$v_status<>'all'$new$),
  ($old$  if v_kind='latency' then
    -- Materialize only latency inputs.$old$,$new$  if v_kind='latency' and v_basis<>'success' then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs.$new$),
  ($old$      select provider,direction,currency,
        case when amount::text$old$,$new$      select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,status_group,created_at,success_at,actual_amount,withdraw_fee,utr,provider,direction,currency,
        case when amount::text$new$),
  ($old$    select provider,direction,currency,status_group,created_at,success_at,$old$,$new$    select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,actual_amount,withdraw_fee,utr,provider,direction,currency,status_group,created_at,success_at,$new$)
 ) x(old_text,new_text) loop
  n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
  if n<>1 then raise exception 'analysis_orders_source_contract_drift: %',left(r.old_text,80);end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 a:=position($start$  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as ($start$ in d);
 b:=position('  execute v_sql into v_result using ' in d);
 if a=0 or b<=a then raise exception 'analysis_orders_query_contract_drift';end if;
 q:=substring(d from a for b-a);
 latency_q:=split_part(split_part(q,'v_sql:=v_prefix||$q$',2),'), metrics as (',1);
 business_q:=split_part(split_part(q,'v_sql:=v_prefix||$q$',3),'), contributions as (',1);
 if position('segment_match' in latency_q)=0 or position('created_match' in business_q)=0
  or position('canonical_provider' in business_q)=0 then raise exception 'analysis_orders_cohort_contract_drift';end if;
 execute_q:=substring(d from b for position('v_max_exclusive,v_hour_min,v_hour_max;' in substring(d from b))+length('v_max_exclusive,v_hour_min,v_hour_max;')-1);
 if position('v_max_exclusive,v_hour_min,v_hour_max;' in execute_q)=0 then raise exception 'analysis_orders_binding_contract_drift';end if;
 execute_q:=replace(execute_q,'v_max_exclusive,v_hour_min,v_hour_max;','v_max_exclusive,v_hour_min,v_hour_max,v_basis;');
 d:=left(d,a-1)||$new$  -- analysis_segment_orders_v1: stable source keys, numeric money, exact count.
  if v_kind='latency' then
    v_sql:=v_prefix||$q$$new$||latency_q||$new$), eligible as materialized (
      select * from selected where segment_match
    )
    $q$;
  else
    v_sql:=v_prefix||$q$$new$||business_q||$new$), eligible as materialized (
      select * from selected where case when $40::text='success' then success_match else created_match end
    )
    $q$;
  end if;
  v_sql:=v_sql||$q$, page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,canonical_provider as provider,raw_provider,
      channel_type,direction,status,status_group,created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,
      currency,synced_at,utr,latency_ms,case when $40::text='success' then success_at else created_at end as event_at
    from eligible
    order by case when $40::text='success' then success_at else created_at end desc nulls last,direction desc,id desc
    limit $18 offset $17
  ) select jsonb_build_object(
    'total',(select count(*) from eligible),
    'hasMore',(select count(*)>$17+$18 from eligible),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by event_at desc nulls last,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;
$new$||execute_q||$new$  return v_result||jsonb_build_object('version',1,'platform',v_meta,'basis',v_basis,
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'offset',v_offset,'limit',v_limit,'complete',true,
    'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,
      'amountMin',v_min,'amountMax',v_max,'amountMaxExclusive',case when v_max is not null then v_max_exclusive end,
      'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,
      'cumulative',v_cumulative,'durationRange',case when v_duration_custom then v_duration->'range' end,
      'durationVersion',v_duration_version)),
    'capabilities',v_capabilities);
end;
$function$;
$new$;
 execute d;
 revoke all on function private.dashboard_admin_live_analysis_orders_raw(jsonb) from public,anon,authenticated,service_role;
end;$install$;
create or replace function private.dashboard_admin_live_analysis_orders(p_request jsonb)
 returns jsonb language sql stable security definer set search_path=''
as $$select private.dashboard_admin_live_analysis_orders_raw(
 private.dashboard_admin_live_expand_provider_filter(p_request||jsonb_build_object('action','analysisOrders')))$$;
create or replace function public.dashboard_admin_live_analysis_orders(p_request jsonb)
 returns jsonb language sql stable set search_path=''
as $$select private.dashboard_admin_live_analysis_orders(p_request)$$;
revoke all on function private.dashboard_admin_live_analysis_orders(jsonb),public.dashboard_admin_live_analysis_orders(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_analysis_orders(jsonb),public.dashboard_admin_live_analysis_orders(jsonb) to authenticated;

-- Preserve all catalog changes (including delegated IP editing); add this query
-- only to pages that already support aggregate reads and detailed records.
do $roles$
declare d text;cat jsonb;r record;n integer;
begin
 if to_regprocedure('private.dashboard_role_catalog()') is null then return;end if;
 select private.dashboard_role_catalog() into cat;
 select jsonb_set(cat,'{pages}',jsonb_agg(
  case when value->'requests' ? 'aggregate' and exists(select 1 from jsonb_array_elements(value->'actions') a where a->>'id'='detail')
    and not value->'requests' ? 'analysisOrders'
   then jsonb_set(value,'{requests}',(value->'requests')||'"analysisOrders"'::jsonb) else value end order by ordinality))
  into cat from jsonb_array_elements(cat->'pages') with ordinality;
 execute 'create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as '
  ||quote_literal('select '||quote_literal(cat::text)||'::jsonb');
 d:=pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure);
 if position('dashboard_admin_live_analysis_orders' in d)>0 then return;end if;
 for r in select * from (values
  ($old$if action in ('details','query')$old$,$new$if action in ('details','query','analysisOrders')$new$),
  ($old$  when 'aggregate' then case$old$,$new$  when 'analysisOrders' then 'dashboard_admin_live_analysis_orders'
  when 'aggregate' then case$new$)
 ) x(old_text,new_text) loop
  n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
  if n<>1 then raise exception 'analysis_orders_role_gateway_contract_drift';end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
end;$roles$;
comment on function public.dashboard_admin_live_analysis_orders(jsonb) is
 'Raw order pagination for an authorized analysis segment, exact creation or success clock; no aggregation substituted as orders.';
commit;
