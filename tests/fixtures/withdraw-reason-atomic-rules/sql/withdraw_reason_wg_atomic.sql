CREATE OR REPLACE FUNCTION private.withdraw_reason_wg_atomic(p_request jsonb, p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare s record; day date:=(p_request->>'date')::date; k text:=coalesce(p_request->>'kind','blocking');
 off integer:=coalesce((p_request->>'offset')::integer,0);
 lim integer:=coalesce((p_request->>'limit')::integer,20); answer jsonb; completed boolean; observed boolean;
begin
 if k not in('blocking','blockingOrders','blockingVariants')then return null;end if;
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
   case when d.status_code=7 then nullif(btrim(d.business_fields->>'rejection_reason'),'')end rejection_note,
   d.business_fields source_business_fields
  from public.wg_withdraw_details d
  where d.site_code=s.site_code
   and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone
 ), note_values as materialized (
  select distinct coalesce(blocking_note,'') raw_note from source_orders
 ), note_flags as materialized (
  select raw_note,private.dashboard_admin_live_clean_note(raw_note) normalized_note from note_values
 ), blocking_values as materialized (
  -- Classify once per distinct manual source note; other detail paths stay in the original WG reader.
  select f.raw_note,case when f.normalized_note ~ '[^[:space:]]'
   then private.dashboard_admin_live_blocking_core(f.normalized_note)
   else jsonb_build_object('reason','检测没备注') end blocking_details
  from note_flags f where f.raw_note in (
   select coalesce(o.blocking_note,'') from source_orders o where o.blocking_operator_class='manual')
 ), orders as materialized (
  select o.*,f.normalized_note,b.blocking_details,
   case when f.normalized_note ~ '[^[:space:]]' then
    case when o.source_business_fields->>'note_state' in('withheld','redacted') and (
     position('未识别拦截原因，原文已隐藏，待核实' in f.normalized_note)>0
     or position('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实' in f.normalized_note)>0)
     then 'withheld' else 'present' end
    when o.source_business_fields->>'note_state'='empty'
     and o.source_business_fields->>'front_note_state'='empty'
     and o.source_business_fields->>'back_note_state'='empty' then 'empty' else 'missing' end blocking_note_state
  from source_orders o join note_flags f on f.raw_note=coalesce(o.blocking_note,'')
  left join blocking_values b on b.raw_note=f.raw_note
 ), blocking_stats as (
  select count(*)::bigint raw,count(*) filter(where blocking_operator_class='manual')::bigint manual,
   count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown
  from orders where blocking_note ~ '[^[:space:]]'
 ), operator_stats as (
  select count(*)::bigint total,count(*) filter(where blocking_operator_class='manual')::bigint manual,
   count(*) filter(where blocking_operator_class='system')::bigint system,count(*) filter(where blocking_operator_class='unknown')::bigint unknown,
   count(*) filter(where blocking_operator_class='manual' and blocking_note_state='present')::bigint "manualWithReason",
  count(*) filter(where blocking_operator_class='manual' and blocking_note_state in('empty','missing'))::bigint "manualWithoutReason",
  count(*) filter(where blocking_operator_class='manual' and blocking_note_state='withheld')::bigint "manualWithheldReason"
  from orders
 ), notes as materialized (
  select o.*,case when blocking_note_state='withheld'then '拦截说明已隐藏'when blocking_note_state in('empty','missing')then '检测没备注'else coalesce(blocking_details->>'reason',normalized_note)end note
  from orders o where blocking_operator_class='manual'
 ), rule_inputs as materialized (
  select distinct normalized_note,blocking_note_state,
   case when blocking_note_state='present' then blocking_details
    else jsonb_build_object('reason',note,'actualValue',null,'actualField',null,'threshold',null)end core
  from notes
 ), rule_values as materialized (
  select normalized_note,blocking_note_state,private.dashboard_admin_live_blocking_members(core,'wg',
   case when blocking_note_state in('empty','missing')then 'unknown'else blocking_note_state end)members
  from rule_inputs
 ), rule_notes as materialized (
  select n.*,m->>'reason' rule_note,m->>'reasonKey' rule_key,m->'details' rule_details
  from notes n join rule_values r on r.normalized_note is not distinct from n.normalized_note
   and r.blocking_note_state=n.blocking_note_state
  cross join lateral jsonb_array_elements(r.members)e(m)
 ), selected as materialized (
  select * from rule_notes where (nullif(p_request->>'reasonKey','') is null or rule_key=p_request->>'reasonKey')
   and (nullif(p_request->>'operatorKey','') is null or md5(coalesce(operator,''))=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(order_number))>0)
 ), reason_groups as (
  select rule_note reason,rule_key "reasonKey",count(*) count,
   min(blocking_note)filter(where blocking_note_state='present')"sourceReason",
   case when bool_and(blocking_note_state='withheld')then null else count(distinct blocking_note)filter(where blocking_note_state='present')end "sourceVariantCount",
  case when count(distinct blocking_note_state)=1 then min(blocking_note_state) else 'mixed' end blocking_note_state,
  jsonb_build_object('empty',count(*) filter(where blocking_note_state='empty'),'missing',count(*) filter(where blocking_note_state='missing'),
   'withheld',count(*) filter(where blocking_note_state='withheld'),'present',count(*) filter(where blocking_note_state='present')) blocking_note_states,
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other from selected group by rule_note,rule_key
 ), variant_groups as (
  -- Drill by the same canonical key; retain each provided original note.
  -- Empty/missing/hidden source text is unavailable, not an invented rule.
  select case when blocking_note_state='present' then blocking_note end reason,
   case when blocking_note_state='present' then blocking_note end "sourceReason",
   rule_note "canonicalReason",rule_key "reasonKey",count(*) count,
   case when count(distinct blocking_note_state)=1 then min(blocking_note_state) else 'mixed' end "blockingNoteState",
   jsonb_build_object('empty',count(*) filter(where blocking_note_state='empty'),'missing',count(*) filter(where blocking_note_state='missing'),
    'withheld',count(*) filter(where blocking_note_state='withheld'),'present',count(*) filter(where blocking_note_state='present')) "blockingNoteStates",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other
  from selected group by 1,2,3,4
 ), categories as (
  select null::text category,null::text "categoryKey",count(*)count,min(rejection_note)"sourceReason",count(distinct rejection_note)"sourceVariantCount"from(select distinct order_number,rejection_note from selected)unique_selected having count(*)>0
 ), rendered as (
  select (to_jsonb(g)-'blocking_note_state'-'blocking_note_states')||jsonb_build_object('blockingNoteState',g.blocking_note_state,'blockingNoteStates',g.blocking_note_states)item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where k='blocking'
  union all select to_jsonb(g),g.count,g.reason,null::timestamptz from variant_groups g where k='blockingVariants'
  union all select jsonb_build_object('orderNumber',order_number,'amount',amount,'currency',s.currency,'status',status_group,'statusCode',status_code,
   'operator',operator,'operatorKey',md5(coalesce(operator,'')),'createdAt',created_at,'completedAt',null,
   'manualRemark',blocking_note,'rejectionReason',rejection_note,'category',null,'categoryKey',null,'reasonKey',rule_key,
   'blockingReason',rule_note,
   'blockingActualValue',case when blocking_note_state='present' then rule_details->>'actualValue' end,
   'blockingActualField',case when blocking_note_state='present' then rule_details->>'actualField' end,
   'blockingThreshold',case when blocking_note_state='present' then rule_details->>'threshold' end)
   ||jsonb_build_object('blockingNoteState',blocking_note_state),
   0,order_number,created_at from selected where k='blockingOrders'
 )
 select jsonb_build_object('available',true,'source','WG 实时明细（脱敏业务文本）','basis','interception_reason',
  'country',s.country,'platform',s.platform,'date',day,'kind',k,'total',(select count(*) from rendered),'offset',off,'limit',lim,
  'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
   (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset off limit lim) p),'[]'::jsonb),
  'noteCount',(select count(*) from notes),'categories',coalesce((select jsonb_agg(to_jsonb(c)order by c.count desc,c.category)from categories c),'[]'::jsonb),
  'summary',jsonb_build_object('totalRejected',(select count(*) from orders where status_code=7),
   'missingReason',0,
   'withOperator',(select count(*) from notes where operator is not null),'operators',(select count(distinct operator) from notes),
   'selectedCount',case when nullif(p_request->>'reasonKey','')is null then (select count(*)from notes where (nullif(p_request->>'operatorKey','')is null or md5(coalesce(operator,''))=p_request->>'operatorKey')and(nullif(btrim(p_request->>'query'),'')is null or position(lower(btrim(p_request->>'query'))in lower(order_number))>0))else(select count(*)from selected)end)
    ||jsonb_build_object('ruleMembership',jsonb_build_object('unit','distinct_order_per_rule','overlapping',true,'hitCount',(select count(*)from rule_notes)),'blockingCounts',(select to_jsonb(b)from blocking_stats b),'operatorCounts',(select to_jsonb(o)from operator_stats o),'operatorBasis','current_latest_operator'),
  'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','created_at','operatorBasis','current_latest_operator',
  'coverage',jsonb_build_object('collected',(select count(*) from orders),'expected',null,'complete',completed,
   'rejected',(select count(*) from orders where status_code=7),'withManualRemark',(select "manualWithReason" from operator_stats)),
  'updatedAt',(select max(captured_at) from orders),'latestSnapshotDate',null,'snapshotFallback',false)||jsonb_build_object('reasonGrouping','atomic_rules_v1') into answer;
 return answer;
end;
$function$

