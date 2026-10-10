-- Frozen WG production function code only; no source rows, notes, users or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_withdraw_reasons(p_request jsonb, p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; day date:=(p_request->>'date')::date; k text:=coalesce(p_request->>'kind','blocking');
 blocking boolean:=k in('blocking','blockingOrders','blockingVariants'); off integer:=coalesce((p_request->>'offset')::integer,0);
 lim integer:=coalesce((p_request->>'limit')::integer,20); answer jsonb; completed boolean; observed boolean;
begin
 select * into s from private.dashboard_admin_wg_sites() t where t.country=p_request->>'country'
  and private.dashboard_admin_live_withdraw_key(t.platform)=private.dashboard_admin_live_withdraw_key(p_request->>'platform')
  and private.dashboard_scope_allows(p_scope,t.country_code,t.platform);
 if not found then return null;end if;
 select coalesce(bool_or(c.complete),false),count(*)>0 into completed,observed from public.wg_detail_coverage c
  where c.site_code=s.site_code and c.business='withdraw' and c.basis='created' and c.business_date=day;
 completed:=completed and ((day+1)::timestamp at time zone s.timezone)<=statement_timestamp();
 if not observed and not exists(select 1 from public.wg_withdraw_details d where d.site_code=s.site_code
  and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone) then return null;end if;
 with source_orders as materialized (
  select d.order_number,d.member_amount as amount,d.status_code,d.status_group,d.created_at,d.captured_at,
   nullif(btrim(d.business_fields->>'operator_name'),'') as operator,
   case when lower(regexp_replace(coalesce(d.business_fields->>'operator_name',''),'^[[:space:]]+|[[:space:]]+$','','g'))='system'
      or d.business_fields->>'operator_class'='auto' then 'system'
    when d.business_fields->>'operator_class'='manual' and (d.business_fields->>'operator_name') ~ '[^[:space:]]' then 'manual' else 'unknown' end blocking_operator_class,
   nullif(btrim(d.business_fields->>'interception_reason'),'') as blocking_note,
   case when d.status_code=7 then case when blocking then nullif(btrim(d.business_fields->>'rejection_reason'),'') else coalesce(private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason'),v.note_text) end end as rejection_note,
   case when d.status_code=7 then case when not blocking and v.note_text is not null and private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') is null then v.note_text else d.business_fields->>'rejection_reason' end end raw_rejection_note,
   d.business_fields as source_business_fields,
   case when v.note_text is not null and private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') is null
    then jsonb_build_object('sourceField',v.source_field,'verificationMethod',v.verification_method,'verifiedAt',v.verified_at) end verified_rejection_note
  from public.wg_withdraw_details d
  left join private.wg_verified_front_rejection_notes v on not blocking and d.status_code=7
   and v.site_code=d.site_code and v.order_number=d.order_number and v.source_status_code=d.status_code
   and v.source_content_hash=d.content_hash and v.source_version_at=d.version_at
   and private.wg_business_note_allowed(v.note_text)
  where d.site_code=s.site_code
   and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone
 ), note_values as materialized (
  select distinct coalesce(blocking_note,'') raw_note from source_orders
 ), note_flags as materialized (
  select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
 ), orders as materialized (
  select o.*,f.normalized_note from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')
 ), blocking_stats as (
  select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
   count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
  from orders where blocking_note ~ '[^[:space:]]'
 ), operator_stats as (
  select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
   count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
   count(*) filter(where blocking_operator_class='manual' and normalized_note ~ '[^[:space:]]')::bigint "manualWithReason",
   count(*) filter(where blocking_operator_class='manual' and not coalesce(normalized_note ~ '[^[:space:]]',false))::bigint "manualWithoutReason"
  from orders
 ), source_note_states as materialized (
  -- A withheld state alone also means a missing source key. Only its own
  -- sanitized field containing a known notice is evidence of hidden content.
  select o.*,array(select slot from (values
   ('remark',source_business_fields->>'note_state',source_business_fields->>'remark_sanitized'),
   ('front',source_business_fields->>'front_note_state',source_business_fields->>'front_note_sanitized'),
   ('back',source_business_fields->>'back_note_state',source_business_fields->>'back_note_sanitized')
  ) v(slot,state,sanitized) where state in('withheld','redacted') and (
   position('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实' in coalesce(sanitized,''))>0
   or position('未识别拦截原因，原文已隐藏，待核实' in coalesce(sanitized,''))>0)) hidden_note_sources,
  coalesce(source_business_fields->>'note_state','')='empty'
   and coalesce(source_business_fields->>'front_note_state','')='empty'
   and coalesce(source_business_fields->>'back_note_state','')='empty' all_notes_empty,
  jsonb_build_object('remark',case when source_business_fields->>'note_state' in('empty','template','redacted','withheld') then source_business_fields->>'note_state' else 'missing' end,
   'front',case when source_business_fields->>'front_note_state' in('empty','template','redacted','withheld') then source_business_fields->>'front_note_state' else 'missing' end,
   'back',case when source_business_fields->>'back_note_state' in('empty','template','redacted','withheld') then source_business_fields->>'back_note_state' else 'missing' end) source_note_states
  from orders o
 ), classified_orders as materialized (
  select o.*,case when rejection_note is not null then 'present' when cardinality(hidden_note_sources)>0 then 'withheld'
   when all_notes_empty then 'empty' else 'missing' end rejection_note_state from source_note_states o
 ), notes as materialized (
  select o.*,case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else
   coalesce(rejection_note,case rejection_note_state when 'withheld' then '（源业务备注已隐藏，驳回备注待核对）' when 'empty' then '（源备注为空）' else '（未采集到明确驳回备注）' end) end note,
   case when not blocking then coalesce(rejection_note,case rejection_note_state when 'withheld' then '（源业务备注已隐藏，驳回备注待核对）' when 'empty' then '（源备注为空）' else '（未采集到明确驳回备注）' end) end category
  from classified_orders o where (blocking and blocking_operator_class='manual') or (not blocking and status_code=7)
 ), keyed_notes as materialized (
  select n.*,case when blocking then md5(note) when rejection_note is not null or rejection_note_state='empty' then private.dashboard_admin_live_rejection_exact_key(rejection_note)
   else md5(jsonb_build_array('wg_source_rejection_note_state_v1',rejection_note_state)::text) end note_key,
   case when not blocking then case when rejection_note is not null or rejection_note_state='empty' then private.dashboard_admin_live_rejection_exact_key(rejection_note)
    else md5(jsonb_build_array('wg_source_rejection_note_state_v1',rejection_note_state)::text) end end category_key from notes n
 ), selected as materialized (
  select * from keyed_notes where (nullif(p_request->>'reasonKey','') is null or note_key=p_request->>'reasonKey')
   and (nullif(p_request->>'category','') is null or category_key=p_request->>'category')
   and (nullif(p_request->>'operatorKey','') is null or md5(coalesce(operator,''))=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(order_number))>0)
 ), reason_groups as (
  select note reason,note_key "reasonKey",count(*) count,min(rejection_note_state) rejection_note_state,
   case when not blocking then min(rejection_note) when note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when not blocking and min(rejection_note_state)<>'present' then null when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other from selected group by note,note_key
 ), categories as (
  select category,category_key "categoryKey",count(*) count,min(rejection_note) "sourceReason",min(rejection_note_state) rejection_note_state,
   case when not blocking and min(rejection_note_state)<>'present' then null else count(distinct rejection_note) end "sourceVariantCount" from selected group by category,category_key
 ), operators as (
  select operator,md5(coalesce(operator,'')) "operatorKey",count(*) count,case when blocking then count(distinct category_key) else count(distinct rejection_note) end "categoryCount",
   count(*) filter(where rejection_note is null) "missingReasonCount" from selected group by operator
 ), rendered as (
  select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where k in('blocking','rejection')
  union all select (to_jsonb(g)-'rejection_note_state')||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'
  union all select (to_jsonb(g)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',g.rejection_note_state) else '{}'::jsonb end,g.count,g.category,null::timestamptz from categories g where k='categories'
  union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamptz from operators g where k='operators'
  union all select jsonb_build_object('orderNumber',order_number,'amount',amount,'currency',s.currency,'status',status_group,'statusCode',status_code,
   'operator',operator,'operatorKey',md5(coalesce(operator,'')),'createdAt',created_at,'completedAt',null,
   'manualRemark',blocking_note,'rejectionReason',rejection_note,'category',category,'categoryKey',category_key,'reasonKey',note_key,
   'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null)||case when not blocking then jsonb_build_object('rawRejectionReason',raw_rejection_note,'rejectionNoteState',rejection_note_state,'sourceNoteStates',source_note_states,'hiddenNoteSources',to_jsonb(hidden_note_sources),'verifiedRejectionNote',verified_rejection_note) else '{}'::jsonb end,
   0,order_number,created_at from selected where k in('orders','blockingOrders')
 )
 select jsonb_build_object('available',true,'source','WG 实时明细（脱敏业务文本）','basis',case when blocking then 'interception_reason' else 'rejection_reason' end,
  'country',s.country,'platform',s.platform,'date',day,'kind',k,'total',(select count(*) from rendered),'offset',off,'limit',lim,
  'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
   (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset off limit lim) p),'[]'::jsonb),
  'noteCount',(select count(*) from notes),'categories',coalesce((select jsonb_agg((to_jsonb(c)-'rejection_note_state')||case when not blocking then jsonb_build_object('rejectionNoteState',c.rejection_note_state) else '{}'::jsonb end order by c.count desc,c.category) from categories c),'[]'::jsonb),
  'summary',jsonb_build_object('totalRejected',(select count(*) from orders where status_code=7),
   'missingReason',(select count(*) from notes where rejection_note is null and not blocking),
   'withOperator',(select count(*) from notes where operator is not null),'operators',(select count(distinct operator) from notes),
   'selectedCount',(select count(*) from selected))
    ||case when blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis','current_latest_operator') else jsonb_build_object(
     'missingReason',(select count(*) from notes where rejection_note_state='missing'),
     'withheldReason',(select count(*) from notes where rejection_note_state='withheld'),
     'emptyReason',(select count(*) from notes where rejection_note_state='empty'),
     'presentReason',(select count(*) from notes where rejection_note_state='present'),
     'knownReasonCount',(select count(distinct rejection_note) from notes)) end,
  'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','created_at','operatorBasis','current_latest_operator',
  'coverage',jsonb_build_object('collected',(select count(*) from orders),'expected',null,'complete',completed,
   'rejected',(select count(*) from orders where status_code=7),'withManualRemark',case when blocking then (select "manualWithReason" from operator_stats) else (select count(*) from orders where blocking_note is not null) end),
  'updatedAt',(select max(captured_at) from orders),'latestSnapshotDate',null,'snapshotFallback',false)||case when not blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1','rejectionNoteStateVersion','wg_source_note_state_v1') else '{}'::jsonb end into answer;
 return answer;
end;
$function$
;
revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated,service_role;

