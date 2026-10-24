CREATE OR REPLACE FUNCTION private.withdraw_reason_ar_all(p_request jsonb, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
 v_country text:=p_request->>'country';v_platform text:=p_request->>'platform';v_code text:=p_context->'native'->>'scope_group';
 v_date date:=(p_request->>'date')::date;v_kind text:='blocking';v_offset integer:=0;v_limit integer:=500;
 v_aliases text[]:=ARRAY(SELECT jsonb_array_elements_text(p_context->'aliases'));v_expected bigint;
 v_blocking boolean:=true;v_ar_raw_only boolean:=true;v_category text;v_reason text;v_operator text;v_query text;
 v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_total bigint;v_rows jsonb;v_categories jsonb;v_summary jsonb;
BEGIN
 IF current_user<>'postgres' OR p_context->'native'->>'source'IS DISTINCT FROM'ar' OR NOT coalesce((p_context->>'rawOnly')::boolean,false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
  with detail_generation as materialized (
   select CASE WHEN EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure AND md5(p.prosrc)='393978c9146ae30019a87632d4d51998' AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=array['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}' AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prorettype='text'::regtype AND NOT p.proretset AND pg_get_function_arguments(p.oid)='' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')) THEN private.ar_withdraw_detail_evidence_generation() END id
  ), detail_evidence as materialized (
   select e.* from private.ar_withdraw_detail_operator_evidence e cross join detail_generation g
   where e.evidence_generation=g.id AND e.source_applied_at>=v_date::timestamp AND e.source_applied_at<(v_date+1)::timestamp
  ), source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then a.order_no end order_no,
    case when v_kind in('orders','blockingOrders') then private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) end amount,
    case when v_kind in('orders','blockingOrders') then a.status end status,
    CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN e.manual_submit_actor ELSE nullif(btrim(a.operator),'') END operator,
    a.operator listing_operator,CASE WHEN e.order_no IS NOT NULL AND btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' THEN 'detail_manual_submit' END detail_basis,
    case when v_kind in('orders','blockingOrders') then a.applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then a.completed_at end completed_at,
    nullif(btrim(a.manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(a.remark),'') else a.remark end end rejection_raw,
    a.updated_at,
    case when v_date>=DATE '2026-10-10' and e.order_no is not null and btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='' then 'manual' when v_date<DATE '2026-10-10' then case when nullif(regexp_replace(coalesce(a.operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(a.operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end else case when lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')) IN('','----','---','--','-','null','none','n/a') then
     case when (position('未通过' IN coalesce(a.status,''))>0 OR position('驳回' IN coalesce(a.status,''))>0 OR position('拒绝' IN coalesce(a.status,''))>0 OR position('reject' IN lower(coalesce(a.status,'')))>0 OR position('failed' IN lower(coalesce(a.status,'')))>0) AND NOT (position('已通过' IN coalesce(a.status,''))>0 OR position('已提交' IN coalesce(a.status,''))>0 OR (position('通过' IN coalesce(a.status,''))>0 AND position('未通过' IN coalesce(a.status,''))=0) OR position('success' IN lower(coalesce(a.status,'')))>0 OR position('submitted' IN lower(coalesce(a.status,'')))>0 OR position('成功' IN coalesce(a.status,''))>0) then 'manual' else 'unknown' end
     when position('system' IN lower(btrim(replace(replace(coalesce(a.operator,''),chr(8203),''),chr(65279),''),U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')))>0 then 'system' else 'manual' end end blocking_operator_class,
    case when a.status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (a.status in('失败','提现失败','出款失败') and coalesce(btrim(a.raw_channel),'') in ('','人工取消')) then 'rejected' when a.status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders a left join detail_evidence e ON
    (e.source_system,e.country_code,e.platform,e.order_kind,e.order_no,e.source_applied_at)=(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.applied_at)
   where a.source_system='AR' and a.country_code=v_code and a.platform=any(v_aliases) and a.order_kind='withdraw'
     and a.applied_at>=v_date::timestamp and a.applied_at<(v_date+1)::timestamp
  ), note_values as materialized (
   select distinct coalesce(manual_raw,'') raw_note from source_orders
   where v_blocking and blocking_operator_class='manual'
  ), note_flags as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
  ), orders as materialized (
   select o.*,f.normalized_note from source_orders o left join note_flags f on f.raw_note=coalesce(o.manual_raw,'')
  ), blocking_stats as (
   select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
   from orders where manual_raw ~ '[^[:space:]]'
  ), operator_stats as (
   select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
    count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
    count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
    count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
   from orders
  ), candidates as materialized (
   select * from orders where (v_blocking and blocking_operator_class='manual') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Reuse the normalization already computed once per distinct manual note.
   -- Rejection-only requests never normalize successful/system manual notes.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note,
    case when v_blocking then normalized_note end normalized_note from candidates
  ), normalized_reasons as materialized (
   select raw_note,case when v_blocking then normalized_note else private.dashboard_admin_live_rejection_exact_note(raw_note) end clean_note
   from distinct_reasons
  ), cleaned as materialized (
   select raw_note,case when v_blocking and not coalesce(clean_note ~ '[^[:space:]]',false) then null else clean_note end clean_note,
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_core(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select c.raw_note,c.clean_note,case when v_blocking then m->'details' else c.blocking_details end blocking_details,
    case when v_blocking then m->>'reason' else c.clean_note end group_note,m->>'reasonKey' rule_key,case when v_blocking then case when c.clean_note is null then 'unknown'else 'present'end end note_state,
    case when not v_blocking then coalesce(c.clean_note,'（源备注为空）') end category from cleaned c
   cross join lateral jsonb_array_elements(case when v_blocking then
    private.dashboard_admin_live_blocking_members(c.blocking_details,'ar',case when c.clean_note is null then 'unknown' else 'present' end)
    else '[{}]'::jsonb end)e(m)
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,o.listing_operator,o.detail_basis,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,c.note_state,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,case when v_kind in('orders','blockingOrders') then c.blocking_details end blocking_details,
    case when v_blocking then c.rule_key else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as not materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(note_state) "noteState",min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",min(note_state) "noteState",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note,note_key
  ), category_groups as (
   select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category,category_key
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category_key)::bigint "categoryCount",count(*) filter(where not v_blocking and rejection_note is null)::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select (to_jsonb(g)-'noteState')||case when v_blocking then jsonb_build_object('noteState',g."noteState")else '{}'::jsonb end item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end)||case when v_blocking then jsonb_build_object('noteState',note_state)else '{}'::jsonb end||CASE WHEN detail_basis IS NOT NULL THEN jsonb_build_object('listingOperator',listing_operator,'operatorClassificationBasis',detail_basis) ELSE '{}'::jsonb END,0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from candidates where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',case when v_blocking and v_reason is null then (select count(*) from candidates where (v_operator is null or md5(coalesce(operator,''))=v_operator)and(v_query is null or position(lower(v_query)in lower(order_no))>0))else(select count(*) from selected_notes)end)
     ||case when v_blocking then jsonb_build_object('ruleMembership',jsonb_build_object('unit','distinct_order_per_rule','overlapping',true,'hitCount',(select count(*)from notes)),'blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis',case when v_date>=DATE '2026-10-10' then 'ar_operator_rejected_or_verified_detail_manual_submit' else 'current_operator' end) else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',case when v_ar_raw_only then null else v_expected end,'complete',case when v_ar_raw_only then false else v_count=v_expected end,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else jsonb_build_object('reasonGrouping','atomic_rules_v1') end;end if;
  if v_ar_raw_only then
   -- Absence of received facts is not proof of zero; do not resurrect old reports.
   return jsonb_build_object('available',false,'source','AR 已采集订单','country',v_country,'platform',v_platform,
    'date',v_date,'kind',v_kind,'rows','[]'::jsonb,'total',0,'offset',v_offset,'limit',v_limit,
    'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
    'coverage',jsonb_build_object('collected',0,'expected',null,'complete',false,'state','no_received_facts'),
    'updatedAt',null,'latestSnapshotDate',null,'snapshotFallback',false,
    'message','所选日期尚无已入库提现明细；不能认定为零笔或已完整采集')||case when v_blocking then jsonb_build_object('reasonGrouping','atomic_rules_v1')else '{}'::jsonb end;
  end if;

 RETURN NULL;
END;$function$

