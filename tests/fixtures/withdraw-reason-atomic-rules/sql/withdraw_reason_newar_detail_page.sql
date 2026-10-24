CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_detail_page(payload jsonb, q jsonb, p_scope jsonb, p_native jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE kind text:=q->>'kind';reason_key text:=q->>'reasonKey';cfg record;
 v_start timestamptz;v_end timestamptz;result jsonb;v_query text:=nullif(btrim(q->>'query'),'');
 v_offset integer:=coalesce((q->>'offset')::integer,0);v_limit integer:=coalesce((q->>'limit')::integer,20);
BEGIN
 IF current_user<>'postgres'OR p_native->>'source'IS DISTINCT FROM'newar'
 OR NOT private.dashboard_scope_allows(p_scope,q->>'country',q->>'platform')
 OR p_native->>'country'IS DISTINCT FROM q->>'country'
 OR payload->>'country'IS DISTINCT FROM q->>'country'OR payload->>'platform'IS DISTINCT FROM q->>'platform'
 OR payload->>'date'IS DISTINCT FROM q->>'date'
 OR NOT(private.dashboard_admin_live_withdraw_key(q->>'platform')=private.dashboard_admin_live_withdraw_key(p_native->>'name')
  OR private.dashboard_admin_live_withdraw_key(q->>'platform')=private.dashboard_admin_live_withdraw_key(p_native->>'source_name'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 IF kind NOT IN('blockingVariants','blockingOrders')OR coalesce(reason_key,'')!~'^[a-f0-9]{32}$'
 OR v_offset<0 OR v_limit NOT BETWEEN 1 AND 500 OR private.withdraw_reason_newar_index_valid(payload)IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='withdraw_reason_label_index_invalid';END IF;
 IF kind='blockingVariants'THEN
  IF v_query IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_request';END IF;
  WITH labels AS(SELECT x,case when x->>2='present' then coalesce(x->>1,x->>0)end source_reason,x->>2 note_state FROM jsonb_array_elements(payload->'_newarLabelIndex'->'rows')r(x)WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(x->3)e(m)WHERE m->>'reasonKey'=reason_key)),
  grp AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x)WHERE x->>'reasonKey'=reason_key),
  variants AS(SELECT jsonb_build_object('reason',g.x->>'reason','reasonKey',reason_key,'noteState',l.note_state,
    'sourceReason',l.source_reason,'canonicalReason',g.x->>'reason','count',sum((l.x->>5)::bigint),
    'success',sum((l.x->>6)::bigint),'rejected',sum((l.x->>7)::bigint),'other',sum((l.x->>8)::bigint))item,
    sum((l.x->>5)::bigint)n,coalesce(l.source_reason,'')txt
   FROM labels l CROSS JOIN grp g GROUP BY g.x,l.note_state,l.source_reason),
  page AS(SELECT *FROM variants ORDER BY n DESC,txt OFFSET v_offset LIMIT v_limit)
  SELECT(payload-ARRAY['rows','total','kind','offset','limit','_newarLabelIndex','summary'])||
   jsonb_build_object('kind',kind,'offset',v_offset,'limit',v_limit,'total',(SELECT count(*)FROM variants),
    'rows',coalesce((SELECT jsonb_agg(item ORDER BY n DESC,txt)FROM page),'[]'::jsonb),
    'summary',(payload->'summary')||jsonb_build_object('selectedCount',coalesce((SELECT sum(n)FROM variants),0)))INTO result;
  RETURN result;
 END IF;
 -- Same native/day projection and source fallback as the original reader. The
 -- sealed index replaces classification only; order fields stay live and paged.
 SELECT n.*INTO cfg FROM public.newar_detail_platforms n WHERE n.platform=p_native->>'source_name'AND n.enabled
  AND private.dashboard_scope_allows(p_scope,n.country_code,n.platform);
 IF NOT FOUND OR cfg.country IS DISTINCT FROM q->>'country'OR cfg.timezone IS DISTINCT FROM p_native->>'timezone'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='platform_denied';END IF;
 v_start:=(q->>'date')::date::timestamp AT TIME ZONE cfg.timezone;
 v_end:=((q->>'date')::date+1)::timestamp AT TIME ZONE cfg.timezone;
 WITH labels AS MATERIALIZED(SELECT x FROM jsonb_array_elements(payload->'_newarLabelIndex'->'rows')r(x)WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(x->3)e(m)WHERE m->>'reasonKey'=reason_key)),
 grp AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x)WHERE x->>'reasonKey'=reason_key),
 source_orders AS MATERIALIZED(
  SELECT f.record_id,f.status_group,f.account,f.created_at,
   CASE WHEN isfinite(f.submitted_at)AND isfinite(f.handled_at)AND f.handled_at>=f.submitted_at
    AND f.handled_at<=f.captured_at AND f.handled_at<=statement_timestamp()THEN f.handled_at END handled_at,
   CASE WHEN z.record_id IS NOT NULL THEN z.order_number ELSE n.order_number END order_no,
   CASE WHEN z.record_id IS NOT NULL THEN z.amount ELSE n.amount END amount,
   coalesce(CASE WHEN z.record_id IS NOT NULL THEN z.display_state
    ELSE CASE WHEN jsonb_typeof(n.raw->'withdrawDisplayState')IN('string','number')
     AND length(n.raw->>'withdrawDisplayState')BETWEEN 1 AND 200 AND n.raw->>'withdrawDisplayState'!~'[[:cntrl:]]'
     THEN n.raw->>'withdrawDisplayState'END END,f.status_group)status,
   CASE WHEN z.record_id IS NOT NULL THEN z.source_label ELSE
    CASE WHEN n.raw->>'businessSchemaVersion'='2'AND n.raw->>'automaticReasonSource'='remark'
     AND jsonb_typeof(n.raw->'automaticReasonLabel')='string'AND length(n.raw->>'automaticReasonLabel')<=256
     AND n.raw->>'automaticReasonLabel'!~'[[:cntrl:]]'THEN nullif(btrim(n.raw->>'automaticReasonLabel'),'')END END source_label
  FROM private.newar_withdraw_facts f LEFT JOIN private.newar_withdraw_reason_facts z ON z.record_id=f.record_id
   AND z.platform=cfg.platform AND z.created_at=f.created_at AND z.received_at=f.received_at
  LEFT JOIN LATERAL(SELECT source_record.order_number,source_record.amount,source_record.raw FROM public.newar_detail_records source_record
   WHERE z.record_id IS NULL AND source_record.id=f.record_id AND source_record.platform=cfg.platform AND source_record.dataset='withdraw'LIMIT 1)n ON true
  WHERE f.platform=cfg.platform AND f.method='manual'AND f.created_at>=v_start AND f.created_at<v_end
   AND(cfg.launch_at IS NULL OR f.created_at>=cfg.launch_at)
 ), selected AS MATERIALIZED(
  SELECT o.*,l.x idx,g.x group_row,(SELECT m->'details'FROM jsonb_array_elements(l.x->3)e(m)WHERE m->>'reasonKey'=reason_key)member_details FROM source_orders o JOIN labels l ON l.x->>0=coalesce(o.source_label,'')CROSS JOIN grp g
  WHERE v_query IS NULL OR position(lower(v_query)IN lower(coalesce(o.order_no,'')))>0
 ), page AS(SELECT *FROM selected ORDER BY created_at DESC,coalesce(order_no,''),record_id OFFSET v_offset LIMIT v_limit),
 rendered AS(SELECT jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',account,
  'operatorKey',md5(account),'createdAt',created_at,'completedAt',handled_at,'manualRemark',case when idx->>2='present' then coalesce(idx->>1,idx->>0)end,
  'reasonKey',reason_key,'blockingReason',group_row->>'reason','noteState',idx->>2,
  'blockingActualValue',member_details->>'actualValue','blockingActualField',member_details->>'actualField','blockingThreshold',member_details->>'threshold',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true)item,created_at,order_no,record_id FROM page)
 SELECT(payload-ARRAY['rows','total','kind','offset','limit','_newarLabelIndex','summary'])||
  jsonb_build_object('kind',kind,'offset',v_offset,'limit',v_limit,'total',(SELECT count(*)FROM selected),
   'rows',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,coalesce(order_no,''),record_id)FROM rendered),'[]'::jsonb),
   'summary',(payload->'summary')||jsonb_build_object('selectedCount',(SELECT count(*)FROM selected)))INTO result;
 RETURN result;
END;$function$

