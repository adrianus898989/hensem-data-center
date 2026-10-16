-- Versioned source evidence only: neither field proves interception/rejection cause.
create or replace function private.duoli_source_note_field(p_field jsonb,p_state text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $duoli_field$
declare v_state text:=coalesce(p_state,p_field->>'state','missing');v_text text;v_redacted boolean:=false;v_truncated boolean:=false;
begin
 if v_state='present' then
  v_text:=private.dashboard_admin_order_business_text(p_field->>'text');
  v_redacted:=coalesce((p_field->>'redacted')::boolean,false) or v_text is distinct from left(btrim(p_field->>'text'),256);
  v_truncated:=coalesce((p_field->>'truncated')::boolean,false) or length(btrim(p_field->>'text'))>256;
  if v_text is null then v_state:='withheld';v_redacted:=true;v_truncated:=false;end if;
 elsif v_state='withheld' then v_redacted:=true;
 end if;
 return jsonb_build_object('state',v_state,'text',v_text,'redacted',v_redacted,'truncated',v_truncated);
end $duoli_field$;
revoke all on function private.duoli_source_note_field(jsonb,text) from public,anon,authenticated,service_role;

create or replace function private.duoli_withdraw_source_notes(p_request jsonb,p_scope jsonb,p_meta jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $duoli_notes$
declare
 v_platform text:=p_meta->>'source_name';v_date date:=(p_request->>'date')::date;
 v_kind text:=coalesce(p_request->>'kind','blocking');v_all boolean:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_offset integer:=coalesce((p_request->>'offset')::integer,0);v_limit integer:=coalesce((p_request->>'limit')::integer,20);
 v_category text:=nullif(p_request->>'category','');v_reason text:=nullif(p_request->>'reasonKey','');
 v_operator text:=nullif(p_request->>'operatorKey','');v_query text:=nullif(btrim(p_request->>'query'),'');
 v_result jsonb;
begin
 -- The caller validated filters and rechecked the session and visible platform.
 -- Check canonical native identity too; a display alias never becomes a source key.
 if p_meta->>'source' is distinct from 'duoli' then return null;end if;
 if p_meta->>'scope_group' is distinct from 'ID' or p_meta->>'timezone' is distinct from 'Asia/Jakarta'
  or v_platform is null or v_platform not in('UANG','FB168','FB333','HOT985','IND666')
  or not private.dashboard_scope_allows(p_scope,'ID',v_platform)
 then raise exception using errcode='42501',message='scope_denied';end if;
 with source_orders as materialized (
  select d.source_order_id,coalesce(nullif(d.order_no,''),d.source_order_id) order_number,
   d.created_at,d.updated_at,d.status_code,d.status_text,d.operator,d.observed_at,
   case when v_kind in('orders','blockingOrders') then private.dashboard_admin_duoli_amount('withdraw',d.currency,d.amount_source,d.amount_raw)::text end amount,
   private.dashboard_admin_duoli_status('withdraw',d.status_code) status_group,
   n.observed_at note_observed_at,n.note_projection,
   case when n.source_order_id is null then 'missing'
    when n.created_at is distinct from d.created_at or n.source_updated_at is distinct from d.updated_at
     or n.source_status_code is distinct from d.status_code or n.source_status_text is distinct from d.status_text
     or n.source_operator is distinct from d.operator then 'stale'
    when not private.duoli_business_notes_valid(n.note_projection) then 'invalid' end evidence_state
  from private.duoli_order_details d
  left join private.duoli_order_business_notes_v1 n on (n.platform,n.business,n.source_order_id)=(d.platform,d.business,d.source_order_id)
  where d.platform=v_platform and d.business='withdraw' and d.country='ID' and d.system_name='DOLI'
   and d.created_at>=v_date::timestamp at time zone 'Asia/Jakarta'
   and d.created_at<(v_date+1)::timestamp at time zone 'Asia/Jakarta'
 ), selected as materialized (
  select s.*,private.duoli_source_note_field(note_projection#>'{fields,condition}',evidence_state) condition_field,
   private.duoli_source_note_field(note_projection#>'{fields,remark}',evidence_state) remark_field
  from source_orders s where v_all or status_group='rejected'
 ), notes as materialized (
  select s.*,jsonb_build_object('condition',condition_field->'text','remark',remark_field->'text') source_notes,
   jsonb_build_object('condition',condition_field->'state','remark',remark_field->'state') states,
   jsonb_build_object('condition',condition_field-array['state','text'],'remark',remark_field-array['state','text']) flags,
   md5(jsonb_build_array(condition_field,remark_field)::text) note_key,
   md5(jsonb_build_array(operator)::text) operator_key,
   case when condition_field->>'state'='present' or remark_field->>'state'='present' then 'present'
    when condition_field->>'state'='withheld' or remark_field->>'state'='withheld' then 'withheld'
    when condition_field->>'state'='invalid' or remark_field->>'state'='invalid' then 'invalid'
    when evidence_state='stale' then 'stale'
    when condition_field->>'state'='missing' or remark_field->>'state'='missing' then 'missing' else 'empty' end note_state
  from selected s
 ), filtered as materialized (
  select * from notes where (v_category is null or note_key=v_category) and (v_reason is null or note_key=v_reason)
   and (v_operator is null or operator_key=v_operator)
   and (v_query is null or position(lower(v_query) in lower(order_number))>0)
 ), result_rows as (
  select created_at sort_time,source_order_id sort_key,0::bigint sort_count,
   jsonb_build_object('orderNumber',order_number,'amount',amount,'currency','IDR','status',status_text,'statusCode',status_code,
    'operator',private.dashboard_admin_order_business_text(operator),'createdAt',created_at,'updatedAt',updated_at,
    'sourceNotes',source_notes,'sourceNoteStates',states,'sourceNoteFlags',flags,'sourceNoteVersion',case when evidence_state is null then 1 end,
    'noteObservedAt',case when evidence_state is null then note_observed_at end,
    'rejectionReason',null,'automaticInterceptionReason',null,'categoryKey',note_key,'reasonKey',note_key,'operatorKey',operator_key) row
  from filtered where v_kind in('orders','blockingOrders')
  union all
  select null,operator_key,count(*),jsonb_build_object('operatorKey',operator_key,
   'operator',private.dashboard_admin_order_business_text(operator),'count',count(*),'missingReasonCount',count(*) filter(where note_state<>'present'))
  from filtered where v_kind='operators' group by operator_key,operator
  union all
  select null,note_key,count(*),jsonb_build_object('categoryKey',note_key,'reasonKey',note_key,
   'reason','来源字段组合','category','来源字段组合','sourceNotes',source_notes,'sourceNoteStates',states,'sourceNoteFlags',flags,
   'count',count(*),'noteState',note_state)
  from filtered where v_kind not in('orders','blockingOrders','operators')
  group by note_key,source_notes,states,flags,note_state
 ), paged as (select * from result_rows order by sort_count desc,sort_time desc nulls last,sort_key limit v_limit offset v_offset),
 totals as (select count(*) total,max(observed_at) updated_at from source_orders),
 note_totals as (select count(*) total,max(note_observed_at) filter(where evidence_state is null) observed_at,
  jsonb_build_object('present',count(*) filter(where note_state='present'),'empty',count(*) filter(where note_state='empty'),
   'withheld',count(*) filter(where note_state='withheld'),'missing',count(*) filter(where note_state='missing'),
   'invalid',count(*) filter(where note_state='invalid'),'stale',count(*) filter(where note_state='stale')) states from notes)
 select jsonb_build_object('available',t.total>0,'source','DUOLI','sourceNoteFormat','duoli_withdraw_source_notes_v1',
  'sourceNotesAvailable',true,'reasonAvailable',false,'classificationAvailable',false,'rejectionReasonAvailable',false,'autoInterceptionReasonAvailable',false,
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,'timezone','Asia/Jakarta',
  'noteCount',nt.total,'total',(select count(*) from result_rows),'rows',coalesce((select jsonb_agg(row order by sort_count desc,sort_time desc nulls last,sort_key) from paged),'[]'::jsonb),
  'offset',v_offset,'limit',v_limit,'canViewOrders',true,'canViewBlockingOrders',true,'canViewOperators',true,
  'summary',jsonb_build_object('totalOrders',t.total,'sourceNoteStates',nt.states),
  'coverage',jsonb_build_object('complete',false,'basis','created_at','state','received_only','collected',t.total,'expected',null),
  'updatedAt',nt.observed_at,'sourceUpdatedAt',t.updated_at,
  'message','当前日期没有已入库提现记录；不能据此判断源后台没有订单或原因。') into v_result
 from totals t cross join note_totals nt;
 return v_result;
end $duoli_notes$;
revoke all on function private.duoli_withdraw_source_notes(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
