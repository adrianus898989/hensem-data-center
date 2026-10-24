CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_all(p_request jsonb, p_scope jsonb, p_meta jsonb)
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
 
 v_cfg record;v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 -- Called only after the parent reader validates its request and obtains fresh scope.
 -- The helper itself has no external EXECUTE grant and never handles other sources.
 if p_meta->>'source' is distinct from 'newar' or v_kind<>'blocking' or nullif(p_request->>'reasonKey','')is not null or nullif(btrim(p_request->>'query'),'')is not null then return null;end if;
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
  select f.status_group,
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
   select source_record.raw
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
   case when source_reason ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_core(source_reason)
    else jsonb_build_object('reason','检测没备注') end details from normalized_labels
 ), reason_labels as materialized (
  select c.*,private.dashboard_admin_live_blocking_members(details,'newar',note_state) members
  from classified_labels c
 ), base_notes as materialized (
  select o.*,r.source_reason,r.note_state,r.details-'_members' legacy_details,r.members
  from source_orders o join reason_labels r on r.label=coalesce(o.source_label,'')
 ), notes as materialized (
  select b.*,m->>'reason' reason,m->>'reasonKey' reason_key,m->'details' details
  from base_notes b cross join lateral jsonb_array_elements(b.members)e(m)
 ), note_stats as (
  select count(*) filter(where note_state='present')::bigint present,
   count(*) filter(where note_state='unknown')::bigint unknown from base_notes
 ), groups as (
  select reason,reason_key "reasonKey",note_state "noteState",count(*)::bigint count,
   min(source_reason) as "sourceReason",count(distinct source_reason)::bigint "sourceVariantCount",
   count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from notes group by reason,reason_key,note_state
 ), label_counts as materialized (
  -- One classified label is stored once; no order/member identifiers enter the artifact.
  select coalesce(source_label,'') label,source_reason,note_state,members,legacy_details details,
   count(*)::bigint count,count(*) filter(where status_group='success')::bigint success,
   count(*) filter(where status_group in('failed','rejected'))::bigint rejected,
   count(*) filter(where status_group not in('success','failed','rejected'))::bigint other
  from base_notes group by coalesce(source_label,''),source_reason,note_state,members,legacy_details
 ), rendered as materialized (
  select to_jsonb(g)item,g.count sort_count,g.reason sort_text from groups g
 ), page as (
  select * from rendered order by sort_count desc,sort_text
 )
 select jsonb_build_object('available',e.collected>0 or e.complete,'source','NEWAR 已采集订单','basis','automaticReasonLabel',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,'reasonGrouping','atomic_rules_v1',
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'offset',v_offset,'limit',v_limit,
  'total',(select count(*) from rendered),'rows',coalesce((select jsonb_agg(item order by sort_count desc,sort_text) from page),'[]'::jsonb),
  '_newarLabelIndex',jsonb_build_object('format','newar-label-index-v2','rows',
   coalesce((select jsonb_agg(jsonb_build_array(label,nullif(source_reason,label),note_state,members,jsonb_strip_nulls(details-'reason'),count,success,rejected,other)order by label)from label_counts),'[]'::jsonb)),
  'noteCount',case when e.collected>0 or e.complete then e.manual end,'categories','[]'::jsonb,
  'summary',case when e.collected>0 or e.complete then jsonb_build_object(
   'ruleMembership',jsonb_build_object('unit','distinct_order_per_rule','overlapping',true,'hitCount',(select count(*) from notes)),
   'totalRejected',e.rejected,'selectedCount',(select count(*) from base_notes),
   'operatorBasis','verified_business_schema_v2','operatorCounts',jsonb_build_object('total',e.collected,'manual',e.manual,'system',e.system,'unknown',e.unknown,
    'manualWithReason',ns.present,'manualWithoutReason',ns.unknown),
   'blockingCounts',jsonb_build_object('raw',ns.present,'manual',ns.present,'system',0,'unknown',0)) else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',false,'canViewOperators',false,'timeBasis','created_at',
  'coverage',jsonb_build_object('collected',e.collected,'expected',null,'complete',e.complete,'rejected',case when e.collected>0 or e.complete then e.rejected end,
   'withManualRemark',case when e.collected>0 or e.complete then ns.present end,'state',case when e.complete then 'complete' when e.collected>0 then 'received_partial' else 'no_received_facts' end),
  'updatedAt',e.updated,'latestSnapshotDate',null,'snapshotFallback',false,
  'message',case when e.collected=0 and not e.complete then '所选日期尚无已入库提现明细；不能认定为零笔或已完整采集' end)
 into v_result from evidence e cross join note_stats ns;
 v_result:=jsonb_set(v_result,'{_newarLabelIndex,integrity}',to_jsonb(md5(jsonb_build_array('newar-label-index-v2',v_result->'_newarLabelIndex'->'rows')::text)));
 return v_result;
end;
$function$

