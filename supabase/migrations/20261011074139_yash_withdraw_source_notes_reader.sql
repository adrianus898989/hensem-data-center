-- YASH source notes use their own provenance, never inferred processing class.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $notes_prerequisite$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.yash_order_ingest(text,jsonb)') and md5(prosrc)='302257476efa96609f79686637ea7548' and pg_get_userbyid(proowner)='postgres' and not prosecdef and provolatile='v' and proparallel='u' and proconfig=array['search_path=""']::text[] and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_yash_note_text(text,text[])') and md5(prosrc)='7b2723a2b53e979d89fcfdf51f647650' and pg_get_userbyid(proowner)='postgres' and not prosecdef and provolatile='i' and proconfig=array['search_path=""']::text[] and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}')
  or (select count(*) from pg_attribute where attrelid=to_regclass('private.yash_orders') and not attisdropped and attname in ('order_note','risk_note') and atttypid='text'::regtype and not attnotnull)<>2
 then raise exception 'yash_source_notes_prerequisite_drift';end if;
end $notes_prerequisite$;
do $reader_helper_guard$
begin
 if to_regprocedure('private.dashboard_admin_yash_withdraw_reasons(jsonb,jsonb,jsonb)') is not null and not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_yash_withdraw_reasons(jsonb,jsonb,jsonb)') and md5(prosrc)='55ed38bbb4ce7988b745de111d58505e' and pg_get_userbyid(proowner)='postgres' and not prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[] and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'yash_note_reader_contract_drift';end if;
end $reader_helper_guard$;
create or replace function private.dashboard_admin_yash_withdraw_reasons(p_request jsonb,p_scope jsonb,p_meta jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $yash_notes$
declare v_date date;v_kind text;v_blocking boolean;v_start timestamptz;v_end timestamptz;v_offset integer;v_limit integer;v_result jsonb;v_evidence jsonb;
begin
 if p_meta->>'source' is distinct from 'kb' then return null;end if;
 if p_meta->>'id' is distinct from md5('kb:IN:YASH.BET')::uuid::text or p_meta->>'scope_group' is distinct from 'IN' or p_meta->>'source_name' is distinct from 'YASH.BET' or p_meta->>'country' is distinct from '印度'
  or btrim(p_request->>'country') is distinct from p_meta->>'country' or not (btrim(p_request->>'platform')=any(array[p_meta->>'name','YASH.BET']))
  or private.dashboard_scope_allows(p_scope,'IN','YASH.BET') is not true then raise exception using errcode='42501',message='scope_denied';end if;
 v_date:=(p_request->>'date')::date;v_kind:=coalesce(p_request->>'kind','blocking');v_blocking:=v_kind in('blocking','blockingVariants','blockingOrders');
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_date is null or v_kind not in('blocking','blockingVariants','blockingOrders','categories','rejection','operators','orders') or v_offset not between 0 and 1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 v_start:=v_date::timestamp at time zone 'Asia/Kolkata';v_end:=(v_date+1)::timestamp at time zone 'Asia/Kolkata';
 v_evidence:=private.dashboard_admin_yash_day_evidence('IN','YASH.BET','withdraw',v_date);
 with all_orders as materialized (
  select y.order_no,y.operator,y.amount,y.currency,y.created_at,y.completed_at,y.status,y.received_at,
   y.order_note,y.risk_note,private.dashboard_admin_yash_status(y.order_type,y.status) status_group
  from private.yash_orders y where y.source_site='yash' and y.order_type='withdrawal' and y.created_at>=v_start and y.created_at<v_end
 ), notes as materialized (
  select o.*,case when v_blocking then o.risk_note else o.order_note end note,
   case when (case when v_blocking then o.risk_note else o.order_note end) is null then 'missing'
    when (case when v_blocking then o.risk_note else o.order_note end)='' then 'empty' else 'present' end note_state
  from all_orders o where v_blocking or o.status_group='rejected'
 ), keyed as materialized (
  select n.*,md5(jsonb_build_array(case when v_blocking then 'yash:risk_note' else 'yash:order_note' end,n.note_state,n.note)::text) note_key,
   md5(coalesce(n.operator,'')) operator_key from notes n
 ), selected as (
  select * from keyed n where (nullif(p_request->>'category','') is null or n.note_key=p_request->>'category')
   and (nullif(p_request->>'reasonKey','') is null or n.note_key=p_request->>'reasonKey')
   and (nullif(p_request->>'operatorKey','') is null or n.operator_key=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(n.order_no))>0)
 ), groups as (
  select jsonb_build_object('reason',case when n.note_state='missing' then '未采集'||case when v_blocking then '风控备注' else '订单备注' end
    when n.note_state='empty' then '源'||case when v_blocking then '风控备注' else '订单备注' end||'为空' else n.note end,
   'sourceReason',n.note,'categoryKey',n.note_key,'reasonKey',n.note_key,'count',count(*),'sourceVariantCount',1,
   'noteState',n.note_state,'riskNoteState',case when v_blocking then n.note_state end,'orderNoteState',case when not v_blocking then n.note_state end,
   'success',count(*) filter(where n.status_group='success'),'rejected',count(*) filter(where n.status_group='rejected'),
   'other',count(*) filter(where n.status_group not in('success','rejected'))) item,count(*) count,n.note_key sort_key from selected n group by n.note,n.note_state,n.note_key
 ), operators as (
  select jsonb_build_object('operator',n.operator,'operatorKey',n.operator_key,'count',count(*),'categoryCount',count(distinct n.note_key),
   'missingReasonCount',count(*) filter(where n.note_state<>'present')) item,count(*) count,n.operator_key sort_key
  from selected n group by n.operator,n.operator_key
 ), order_rows as (
  select jsonb_build_object('orderNumber',n.order_no,'amount',n.amount::text,'currency',n.currency,'operator',n.operator,'status',n.status,
   'createdAt',n.created_at,'completedAt',n.completed_at,'sourceReason',n.note,'noteState',n.note_state,
   'orderNote',n.order_note,'riskNote',n.risk_note,'orderNoteState',case when n.order_note is null then 'missing' when n.order_note='' then 'empty' else 'present' end,
   'riskNoteState',case when n.risk_note is null then 'missing' when n.risk_note='' then 'empty' else 'present' end,
   'rejectionReason',case when not v_blocking then n.order_note end,'manualRemark',null) item,n.created_at,n.order_no from selected n
 ), items as (
  select item,count,sort_key from groups where v_kind in('blocking','blockingVariants','categories','rejection')
  union all select item,count,sort_key from operators where v_kind='operators'
 ), page as (
  select item from items order by count desc,sort_key offset v_offset limit v_limit
 ), orders_page as (
  select item from order_rows order by created_at desc,order_no offset v_offset limit v_limit
 )
 select jsonb_build_object('available',true,'reasonAvailable',true,'source','YASH 已采集提现订单','sourceNoteFormat','yash_withdraw_notes_v1',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,'basis',case when v_blocking then 'source_risk_note' else 'rejected_order_note' end,
  'classificationAvailable',false,'date',v_date,'kind',v_kind,'noteCount',(select count(*) from notes),
  'rows',case when v_kind in('orders','blockingOrders') then coalesce((select jsonb_agg(item) from orders_page),'[]'::jsonb) else coalesce((select jsonb_agg(item) from page),'[]'::jsonb) end,
  'total',case when v_kind in('orders','blockingOrders') then (select count(*) from selected) else (select count(*) from items) end,
  'categories',coalesce((select jsonb_agg(item order by count desc,sort_key) from groups),'[]'::jsonb),
  'summary',jsonb_build_object('totalOrders',(select count(*) from all_orders),'totalRejected',(select count(*) from all_orders where status_group='rejected'),
   'sourceNoteStates',jsonb_build_object('present',(select count(*) from notes where note_state='present'),'empty',(select count(*) from notes where note_state='empty'),'missing',(select count(*) from notes where note_state='missing'))),
  'coverage',jsonb_build_object('collected',(select count(*) from all_orders),'expected',v_evidence->'sourceCount','complete',v_evidence->'complete','basis','created_at'),
  'updatedAt',(select max(received_at) from all_orders),'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true) into v_result;
 if (v_result#>>'{summary,totalOrders}')::bigint=0 and (v_evidence->>'complete')::boolean is not true then v_result:=v_result||jsonb_build_object('available',false,'noteCount',null,'message','该日期尚未收到可核验的 YASH 提现订单，不能推定源站没有数据。');end if;
 return v_result;
end $yash_notes$;
revoke all on function private.dashboard_admin_yash_withdraw_reasons(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
do $patch_reasons$
declare p record;d text;before_acl aclitem[];before_owner oid;pair record;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc) not in ('f24047cc2ac6669a2cc251e6ecb6851c','b1b3aa50ae5c05ab9c98acf446c601ab') or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'yash_source_notes_reasons_contract_drift';end if;
 if md5(p.prosrc)='b1b3aa50ae5c05ab9c98acf446c601ab' then return;end if;
 before_acl:=p.proacl;before_owner:=p.proowner;d:=pg_get_functiondef(p.oid);
 for pair in select * from (values
 ($old$ if v_meta.source='ar' then$old$,$new$ -- yash_received_source_notes_v1: validated request and fresh scoped native metadata.
 if v_meta.source='kb' then
  v_rows:=private.dashboard_admin_yash_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then$new$,1)
 ) x(old_text,new_text,occurrences) loop
  if (length(d)-length(replace(d,pair.old_text,'')))/length(pair.old_text)<>pair.occurrences then raise exception 'yash_source_notes_reasons_anchor_drift';end if;
  d:=replace(d,pair.old_text,pair.new_text);
 end loop;
 execute d;select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'b1b3aa50ae5c05ab9c98acf446c601ab' then raise exception 'yash_source_notes_reasons_checksum';end if;
 if p.proacl is distinct from before_acl or p.proowner<>before_owner or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] then raise exception 'yash_source_notes_reasons_metadata_changed';end if;
end $patch_reasons$;
do $patch_auto$
declare p record;d text;before_acl aclitem[];before_owner oid;pair record;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc) not in ('0e3fa774f1db0759dbd5211c7b0bcfe7','f9ac67304f2b5fae66a8b35f080ab981') or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'yash_source_notes_auto_contract_drift';end if;
 if md5(p.prosrc)='f9ac67304f2b5fae66a8b35f080ab981' then return;end if;
 before_acl:=p.proacl;before_owner:=p.proowner;d:=pg_get_functiondef(p.oid);
 for pair in select * from (values
 ($old$'source','KB','classificationAvailable',false,'reasonAvailable',false$old$,$new$'source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true$new$,2),
($old$'classificationAvailable',false,'reasonAvailable',false,
    'currentComplete'$old$,$new$'classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,
    'currentComplete'$new$,1)
 ) x(old_text,new_text,occurrences) loop
  if (length(d)-length(replace(d,pair.old_text,'')))/length(pair.old_text)<>pair.occurrences then raise exception 'yash_source_notes_auto_anchor_drift';end if;
  d:=replace(d,pair.old_text,pair.new_text);
 end loop;
 execute d;select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'f9ac67304f2b5fae66a8b35f080ab981' then raise exception 'yash_source_notes_auto_checksum';end if;
 if p.proacl is distinct from before_acl or p.proowner<>before_owner or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']::text[] then raise exception 'yash_source_notes_auto_metadata_changed';end if;
end $patch_auto$;
commit;
