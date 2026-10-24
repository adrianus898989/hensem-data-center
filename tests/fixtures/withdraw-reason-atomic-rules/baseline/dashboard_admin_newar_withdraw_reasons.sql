CREATE OR REPLACE FUNCTION private.dashboard_admin_newar_withdraw_reasons(p_request jsonb, p_scope jsonb, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
 v_country text:=btrim(p_request->>'country');v_platform text:=btrim(p_request->>'platform');
 v_kind text:=coalesce(p_request->>'kind','blocking');v_date date:=(p_request->>'date')::date;
 v_offset integer:=coalesce((p_request->>'offset')::integer,0);v_limit integer:=coalesce((p_request->>'limit')::integer,20);
 v_reason text:=nullif(p_request->>'reasonKey','');v_query text:=nullif(btrim(p_request->>'query'),'');
 v_cfg record;v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 -- Called only after the parent reader validates its request and obtains fresh scope.
 -- The helper itself has no external EXECUTE grant and never handles other sources.
 if p_meta->>'source' is distinct from 'newar' or v_kind not in('blocking','blockingVariants','blockingOrders') then return null;end if;
 if p_meta->>'country' is distinct from v_country
  or not private.dashboard_scope_allows(p_scope,v_country,v_platform)
  or not (private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'name')
   or private.dashboard_admin_live_withdraw_key(v_platform)=private.dashboard_admin_live_withdraw_key(p_meta->>'source_name'))
  then raise exception using errcode='42501',message='scope_denied';end if;
 select n.* into v_cfg from public.newar_detail_platforms n
  where n.platform=p_meta->>'source_name' and n.enabled
   and private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 if not found or v_cfg.country is distinct from v_country or v_cfg.timezone is distinct from p_meta->>'timezone'
  then raise exception using errcode='22023',message='platform_denied';end if;
 v_start:=v_date::timestamp at time zone v_cfg.timezone;v_end:=(v_date+1)::timestamp at time zone v_cfg.timezone;
 with scope_facts as materialized (
  -- The existing narrow indexed projection locates one platform/day. Automatic
  -- and unverified orders are counted without reading their wide source JSON.
  select f.* from private.newar_withdraw_facts f
  where f.platform=v_cfg.platform and f.created_at>=v_start and f.created_at<v_end
   and (v_cfg.launch_at is null or f.created_at>=v_cfg.launch_at)
 ), totals as (
  select count(*)::bigint collected,count(*) filter(where method='auto')::bigint system,
   count(*) filter(where method='manual')::bigint manual,count(*) filter(where method is null)::bigint unknown,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   max(captured_at) captured,max(received_at) received from scope_facts
 ), coverage as (
  select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) seen
  from private.newar_detail_coverage_runs c where c.platform=v_cfg.platform and c.dataset='withdraw'
   and c.invalidated_at is null and c.observed_at<=statement_timestamp()
   and c.effective_start_at<v_end and c.end_at>v_start
 ), evidence as (
  select t.*,greatest(t.received,c.seen) updated,
   v_end<=statement_timestamp() and (v_cfg.launch_at is null or v_start>=v_cfg.launch_at)
    and coalesce(c.ranges @> tstzrange(v_start,v_end,'[)'),false)
    and coalesce(t.captured<=statement_timestamp(),true) complete from totals t cross join coverage c
 ), source_orders as materialized (
  select f.record_id,f.status_group,f.account,f.created_at,
   case when isfinite(f.submitted_at) and isfinite(f.handled_at) and f.handled_at>=f.submitted_at
    and f.handled_at<=f.captured_at and f.handled_at<=statement_timestamp() then f.handled_at end handled_at,
   case when v_kind='blockingOrders' or v_query is not null then case when z.record_id is not null then z.order_number else n.order_number end end order_no,
   case when v_kind='blockingOrders' then case when z.record_id is not null then z.amount else n.amount end end amount,
   case when v_kind='blockingOrders' then coalesce(case when z.record_id is not null then z.display_state
    else case when jsonb_typeof(n.raw->'withdrawDisplayState') in('string','number')
     and length(n.raw->>'withdrawDisplayState') between 1 and 200 and n.raw->>'withdrawDisplayState' !~ '[[:cntrl:]]'
     then n.raw->>'withdrawDisplayState' end end,f.status_group) end status,
   -- newar_reason_projection_v1: source updates maintain this narrow sidecar in the same transaction.
   -- Missing projection rows retain the existing source fallback; null labels do not borrow member notes.
   case when z.record_id is not null then z.source_label else
    case when n.raw->>'businessSchemaVersion'='2' and n.raw->>'automaticReasonSource'='remark'
     and jsonb_typeof(n.raw->'automaticReasonLabel')='string'
     and length(n.raw->>'automaticReasonLabel')<=256 and n.raw->>'automaticReasonLabel' !~ '[[:cntrl:]]'
     then nullif(btrim(n.raw->>'automaticReasonLabel'),'') end end source_label
  from scope_facts f left join private.newar_withdraw_reason_facts z on z.record_id=f.record_id
   and z.platform=v_cfg.platform and z.created_at=f.created_at and z.received_at=f.received_at
  left join lateral (
   select source_record.order_number,source_record.amount,source_record.raw
   from public.newar_detail_records source_record
   where z.record_id is null and source_record.id=f.record_id
    and source_record.platform=v_cfg.platform and source_record.dataset='withdraw'
   limit 1
  ) n on true
  where f.method='manual'
 ), distinct_labels as materialized (
  select distinct coalesce(source_label,'') label from source_orders
 ), normalized_labels as materialized (
  select label,private.dashboard_admin_live_clean_note(label) source_reason from distinct_labels
 ), classified_labels as materialized (
  select label,nullif(source_reason,'') source_reason,
   case when source_reason ~ '[^[:space:]]' then 'present' else 'unknown' end note_state,
   case when source_reason ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(source_reason)
    else jsonb_build_object('reason','检测没备注') end details from normalized_labels
 ), reason_labels as materialized (
  select c.*,coalesce(details->>'reason',source_reason,'检测没备注') reason,
   md5(jsonb_build_array('newar_blocking_sanitized_v1',note_state,coalesce(details->>'reason',source_reason,'检测没备注'))::text) reason_key
  from classified_labels c
 ), notes as materialized (
  select o.*,r.source_reason,r.note_state,r.reason,r.reason_key,r.details
  from source_orders o join reason_labels r on r.label=coalesce(o.source_label,'')
 ), note_stats as (
  select count(*) filter(where note_state='present')::bigint present,
   count(*) filter(where note_state='unknown')::bigint unknown from notes
 ), selected_notes as materialized (
  select * from notes where (v_reason is null or reason_key=v_reason)
   and (v_query is null or position(lower(v_query) in lower(coalesce(order_no,'')))>0)
 ), groups as (
  select reason,reason_key "reasonKey",note_state "noteState",count(*)::bigint count,
   min(source_reason) as "sourceReason",count(distinct source_reason)::bigint "sourceVariantCount",
   count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state
 ), variants as (
  select reason,reason_key "reasonKey",note_state "noteState",source_reason "sourceReason",reason "canonicalReason",
   count(*)::bigint count,count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from selected_notes group by reason,reason_key,note_state,source_reason
 ), rendered as materialized (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time,null::uuid sort_id
  from groups g where v_kind='blocking'
  union all select to_jsonb(g),g.count,coalesce(g."sourceReason",''),null::timestamptz,null::uuid
  from variants g where v_kind='blockingVariants'
  union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',account,
   'operatorKey',md5(account),'createdAt',created_at,'completedAt',handled_at,
   'manualRemark',source_reason,'reasonKey',reason_key,'blockingReason',reason,'noteState',note_state,
   'blockingActualValue',details->>'actualValue','blockingActualField',details->>'actualField','blockingThreshold',details->>'threshold',
   'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true),0,coalesce(order_no,''),created_at,record_id
  from selected_notes where v_kind='blockingOrders'
 ), page as (
  select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text,sort_id
  offset v_offset limit v_limit
 )
 select jsonb_build_object('available',e.collected>0 or e.complete,'source','NEWAR 已采集订单','basis','automaticReasonLabel',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'offset',v_offset,'limit',v_limit,
  'total',(select count(*) from rendered),'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text,sort_id) from page),'[]'::jsonb),
  'noteCount',case when e.collected>0 or e.complete then e.manual end,'categories','[]'::jsonb,
  'summary',case when e.collected>0 or e.complete then jsonb_build_object(
   'totalRejected',e.rejected,'selectedCount',(select count(*) from selected_notes),
   'operatorBasis','verified_business_schema_v2','operatorCounts',jsonb_build_object('total',e.collected,'manual',e.manual,'system',e.system,'unknown',e.unknown,
    'manualWithReason',ns.present,'manualWithoutReason',ns.unknown),
   'blockingCounts',jsonb_build_object('raw',ns.present,'manual',ns.present,'system',0,'unknown',0)) else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',false,'canViewOperators',false,'timeBasis','created_at',
  'coverage',jsonb_build_object('collected',e.collected,'expected',null,'complete',e.complete,'rejected',case when e.collected>0 or e.complete then e.rejected end,
   'withManualRemark',case when e.collected>0 or e.complete then ns.present end,'state',case when e.complete then 'complete' when e.collected>0 then 'received_partial' else 'no_received_facts' end),
  'updatedAt',e.updated,'latestSnapshotDate',null,'snapshotFallback',false,
  'message',case when e.collected=0 and not e.complete then '所选日期尚无已入库提现明细；不能认定为零笔或已完整采集' end)
 into v_result from evidence e cross join note_stats ns;
 return v_result;
end;
$function$

