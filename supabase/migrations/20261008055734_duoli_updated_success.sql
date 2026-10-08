-- Owner-requested DUOLI daily success basis: successful status + order update time.
-- This does not claim an actual payment/callback timestamp or payment latency.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.dashboard_admin_duoli_success_updated_at(
 p_business text,p_status text,p_created timestamptz,p_updated timestamptz,p_asof timestamptz)
returns timestamptz language sql immutable set search_path='' as $function$
 select case when ((p_business='recharge' and p_status='2') or (p_business='withdraw' and p_status in('6','2')))
  and isfinite(p_created) and isfinite(p_updated) and isfinite(p_asof)
  and p_updated>=p_created and p_updated<=p_asof then p_updated end;
$function$;
revoke all on function private.dashboard_admin_duoli_success_updated_at(text,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_duoli_patch_once(d text,a text,b text)
returns text language plpgsql immutable set search_path='' as $function$
begin
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then
  raise exception 'duoli_updated_success_anchor_drift: %',left(a,100);
 end if;
 return replace(d,a,b);
end;
$function$;
revoke all on function private.dashboard_admin_duoli_patch_once(text,text,text) from public,anon,authenticated,service_role;

do $patch$
declare item text;p record;d text;old_acl aclitem[];old_owner oid;new_acl aclitem[];new_owner oid;
begin
 foreach item in array array['private.dashboard_admin_duoli_order_source()',
  'private.dashboard_admin_duoli_capabilities()',
  'private.dashboard_admin_duoli_order_result(jsonb)',
  'private.dashboard_admin_live_query_raw(jsonb)',
  'private.dashboard_admin_live_drilldown_raw(jsonb)',
  'private.dashboard_admin_live_analysis_orders_raw(jsonb)'] loop
  select * into strict p from pg_proc where oid=to_regprocedure(item);
  if p.prosecdef is distinct from (item like 'private.dashboard_admin_live_%')
   or p.provolatile is distinct from (case when item like 'private.dashboard_admin_live_%' then 's'::"char" else 'i'::"char" end)
   or p.proconfig is distinct from (case when item like 'private.dashboard_admin_live_%' then array['search_path=""','jit=off'] else array['search_path=""'] end)
   or p.prolang<>(select oid from pg_language where lanname=case when item like 'private.dashboard_admin_live_%' or item='private.dashboard_admin_duoli_order_result(jsonb)' then 'plpgsql' else 'sql' end)
   or md5(p.prosrc) is distinct from (case item
    when 'private.dashboard_admin_duoli_order_source()' then 'f27f113d340edf84f3caaca1cc90e411'
    when 'private.dashboard_admin_duoli_capabilities()' then 'b8a13fdd967874f017a6aeeffde169f3'
    when 'private.dashboard_admin_duoli_order_result(jsonb)' then '0162a6988a4a27dfd8985854649f84a2'
    when 'private.dashboard_admin_live_query_raw(jsonb)' then 'f7e657d02f4e843a18ed2510950c1823'
    when 'private.dashboard_admin_live_drilldown_raw(jsonb)' then '15aa8805740551e25dc5b31be828dc8d'
    when 'private.dashboard_admin_live_analysis_orders_raw(jsonb)' then '30484804dba9a7ef95e6315ab74dfa5a'
   end) then raise exception 'duoli_updated_success_production_baseline_drift: %',item;end if;
  d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
  if item='private.dashboard_admin_duoli_order_source()' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$d.created_at,null::timestamptz as success_at,$old$,$new$d.created_at,t.success_at,$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  from private.duoli_order_details d
  where$old$,$new$  from private.duoli_order_details d
  cross join lateral(select private.dashboard_admin_duoli_success_updated_at(d.business,d.status_code,d.created_at,d.updated_at,$20) success_at)t
  where$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$   and d.created_at >= $5 and d.created_at < $6$old$,$new$   and ((d.created_at >= $5 and d.created_at < $6) or (($19='aggregate' or $8='success') and d.updated_at >= $5 and d.updated_at < $6
      and t.success_at >= $5 and t.success_at < $6))$new$);
  elsif item='private.dashboard_admin_duoli_capabilities()' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$'successTimeAvailable',false,'chargeSuccessTimeAvailable',false,'withdrawSuccessTimeAvailable',false,$old$,$new$'successTimeAvailable',true,'chargeSuccessTimeAvailable',true,'withdrawSuccessTimeAvailable',true,
  'paymentSuccessTimeAvailable',false,'latencyAvailable',false,$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$'successTimeBasis','not_provided','successCohort','unavailable_without_payment_success_timestamp',$old$,$new$'successTimeBasis','order_updated_at','successCohort','successful_status_updated_at_in_selected_range',$new$);
  elsif item='private.dashboard_admin_duoli_order_result(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$'success_count',null,'success_amount',null,'success_time_available',false,$old$,$new$'success_time_available',true,'success_time_basis','order_updated_at',$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$ return v_result||jsonb_build_object('nativeSource','DOLI','sourcePolicy','details_only',
  'successTimeAvailable',false,'chargeSuccessTimeAvailable',false,'withdrawSuccessTimeAvailable',false);$old$,$new$ -- Updating a successful order is a statistical clock, not payment latency.
 if v_result?'latencySummary' then v_result:=jsonb_set(v_result,'{latencySummary}','[]'::jsonb);end if;
 for v_key in select unnest(array['latency','latency_thresholds','latency_custom']) loop
  if v_result->'groups'?v_key then v_result:=jsonb_set(v_result,array['groups',v_key],'[]'::jsonb);end if;
 end loop;
 return v_result||jsonb_build_object('nativeSource','DOLI','sourcePolicy','details_only',
  'successTimeAvailable',true,'chargeSuccessTimeAvailable',true,'withdrawSuccessTimeAvailable',true,
  'successTimeBasis','order_updated_at','paymentSuccessTimeAvailable',false,'latencyAvailable',false);$new$);
  elsif item='private.dashboard_admin_live_query_raw(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$    if v_status='success' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$old$,$new$    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  execute v_sql into v_result using$old$,$new$  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using$new$);
  elsif item='private.dashboard_admin_live_drilldown_raw(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$    if v_status='success' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$old$,$new$    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';$old$,$new$  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  execute v_sql into v_result using$old$,$new$  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using$new$);
  elsif item='private.dashboard_admin_live_analysis_orders_raw(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$    if v_status='success' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$old$,$new$    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  if v_platform.source='duoli' and v_basis='success' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';$old$,$new$  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  execute v_sql into v_result using$old$,$new$  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using$new$);
  end if;
  execute d;
  select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
  if new_acl is distinct from old_acl or new_owner is distinct from old_owner then
   raise exception 'duoli_updated_success_acl_changed: %',item;end if;
 end loop;
end;$patch$;
drop function private.dashboard_admin_duoli_patch_once(text,text,text);
notify pgrst,'reload schema';
commit;
