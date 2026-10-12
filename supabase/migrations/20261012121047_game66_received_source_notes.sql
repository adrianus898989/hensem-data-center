-- GAME66 source-note display only. Existing auth/scope and all other source branches remain unchanged.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $helper_guard$
declare p record;
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_yash_note_text(text,text[])') and md5(prosrc)='7b2723a2b53e979d89fcfdf51f647650' and pg_get_userbyid(proowner)='postgres' and not prosecdef and provolatile='i' and proconfig=array['search_path=""']::text[] and proacl::text='{postgres=X/postgres,service_role=X/postgres}') then raise exception 'game66_note_sanitizer_drift';end if;
 if to_regprocedure('private.dashboard_admin_game66_note(text,text[])') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_game66_note(text,text[])');
 if md5(p.prosrc)<>'3c423f2ffcfb0216db37cc1efc327355' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.provolatile<>'i' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'game66_note_helper_drift';end if;end if;
 if to_regprocedure('private.dashboard_admin_game66_withdraw_reasons(jsonb,jsonb,jsonb)') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_game66_withdraw_reasons(jsonb,jsonb,jsonb)');
 if md5(p.prosrc)<>'45f3d63142f68c2f2295725c3e27a49a' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'game66_note_helper_drift';end if;end if;
end $helper_guard$;
-- Read existing scalar business notes only; never inspect the wide raw payload.
create or replace function private.dashboard_admin_game66_note(p_text text,p_sensitive text[])
returns text language plpgsql immutable security invoker set search_path='' as $note$
declare v text:=p_text;s text;
begin
 if v is null then return null;end if;
 if length(v)>2000 or v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then return null;end if;
 -- Remove known customer/account identifiers before applying the existing
 -- credential/contact sanitizer. No identifiers are preserved as exceptions.
 for s in select distinct x from unnest(coalesce(p_sensitive,'{}'::text[]))x where length(btrim(x))>=2 order by x loop
  v:=replace(v,s,'[已隐藏]');
 end loop;
 return private.dashboard_admin_yash_note_text(v,'{}'::text[]);
end $note$;
revoke all on function private.dashboard_admin_game66_note(text,text[]) from public,anon,authenticated,service_role;
create or replace function private.dashboard_admin_game66_withdraw_reasons(p_request jsonb,p_scope jsonb,p_meta jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $game66_notes$
declare v_date date;v_kind text;v_blocking boolean;v_start timestamptz;v_end timestamptz;v_offset integer;v_limit integer;v_result jsonb;v_cfg record;
begin
 if p_meta->>'source' is distinct from 'game66' then return null;end if;
 if btrim(p_request->>'country') is distinct from p_meta->>'country'
  or private.dashboard_scope_allows(p_scope,p_meta->>'country',btrim(p_request->>'platform')) is not true
  or not (private.dashboard_admin_live_withdraw_key(btrim(p_request->>'platform'))=any(array[private.dashboard_admin_live_withdraw_key(p_meta->>'name'),private.dashboard_admin_live_withdraw_key(p_meta->>'source_name')]))
  then raise exception using errcode='42501',message='scope_denied';end if;
 select g.* into v_cfg from public.game66_platforms g where g.id::text=p_meta->>'id'
  and g.team_name=p_meta->>'country' and g.platform_name=p_meta->>'source_name'
  and case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end=p_meta->>'scope_group'
  and private.dashboard_scope_allows(p_scope,case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name);
 if not found or p_meta->>'timezone' is distinct from 'Asia/Kolkata' then raise exception using errcode='42501',message='scope_denied';end if;
 v_date:=(p_request->>'date')::date;v_kind:=coalesce(p_request->>'kind','blocking');v_blocking:=v_kind in('blocking','blockingVariants','blockingOrders');
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_date is null or v_kind not in('blocking','blockingVariants','blockingOrders','categories','rejection','operators','orders') or v_offset not between 0 and 1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 v_start:=v_date::timestamp at time zone 'Asia/Kolkata';v_end:=(v_date+1)::timestamp at time zone 'Asia/Kolkata';
 with all_orders as materialized (
  select w.id,w.order_num,w.amount_display,w.status_code,w.status_text,w.auto_commit,w.create_time,w.submit_time,w.update_time,w.last_seen_at,
   case when (v_kind in('orders','blockingOrders','operators') or nullif(p_request->>'operatorKey','') is not null) and (v_blocking or w.status_code='-1') then private.dashboard_admin_game66_note(coalesce(nullif(btrim(w.audit_admin),''),nullif(btrim(w.lock_admin),''),nullif(btrim(w.lock_user_admin),'')),array[w.uid,w.account,w.account_name,w.cpf]) end operator,
   case when v_blocking or (v_kind='orders' and w.status_code='-1') then private.dashboard_admin_game66_note(case when btrim(w.auto_reason) in('[]','{}','null') then '' else w.auto_reason end,array[w.uid,w.account,w.account_name,w.cpf]) end auto_note,
   case when (not v_blocking and w.status_code='-1') or v_kind='blockingOrders' then private.dashboard_admin_game66_note(w.audit_remark,array[w.uid,w.account,w.account_name,w.cpf]) end audit_note,
   case when (not v_blocking and w.status_code='-1') or v_kind='blockingOrders' then private.dashboard_admin_game66_note(w.reason,array[w.uid,w.account,w.account_name,w.cpf]) end reason_note,
   case when (not v_blocking and w.status_code='-1') or v_kind='blockingOrders' then private.dashboard_admin_game66_note(w.withdraw_remark,array[w.uid,w.account,w.account_name,w.cpf]) end withdraw_note
  from public.game66_withdraw_orders w where w.platform_id=v_cfg.id and w.create_time>=v_start and w.create_time<v_end
 ), notes as materialized (
  select o.*,case when v_blocking then jsonb_build_object('auto_reason',o.auto_note)
   else jsonb_build_object('audit_remark',o.audit_note,'reason',o.reason_note,'withdraw_remark',o.withdraw_note) end note,
   case when v_blocking then case when o.auto_note is null then 'missing' when o.auto_note='' then 'empty' else 'present' end
    else case when coalesce(nullif(o.audit_note,''),nullif(o.reason_note,''),nullif(o.withdraw_note,'')) is not null then 'present'
     when o.audit_note is null or o.reason_note is null or o.withdraw_note is null then 'missing' else 'empty' end end note_state
  from all_orders o where v_blocking or o.status_code='-1'
 ), keyed as materialized (
  select n.*,md5(jsonb_build_array('game66_source_notes',v_blocking,n.note_state,n.note)::text) note_key,
   md5(coalesce(n.operator,'')) operator_key from notes n
 ), selected as (
  select * from keyed n where (nullif(p_request->>'category','') is null or n.note_key=p_request->>'category')
   and (nullif(p_request->>'reasonKey','') is null or n.note_key=p_request->>'reasonKey')
   and (nullif(p_request->>'operatorKey','') is null or n.operator_key=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(n.order_num))>0)
 ), groups as (
  select jsonb_build_object('sourceNotes',n.note,'categoryKey',n.note_key,'reasonKey',n.note_key,'count',count(*),'sourceVariantCount',1,
   'noteState',n.note_state,'success',count(*) filter(where n.status_code in('1','3')),'rejected',count(*) filter(where n.status_code='-1'),
   'other',count(*) filter(where n.status_code is null or n.status_code not in('1','3','-1'))) item,count(*) count,n.note_key sort_key
  from selected n group by n.note,n.note_state,n.note_key
 ), operators as (
  select jsonb_build_object('operator',n.operator,'operatorKey',n.operator_key,'count',count(*),'categoryCount',count(distinct n.note_key),
   'missingReasonCount',count(*) filter(where n.note_state<>'present')) item,count(*) count,n.operator_key sort_key
  from selected n group by n.operator,n.operator_key
 ), order_rows as (
  select jsonb_build_object('orderNumber',n.order_num,'amount',n.amount_display::text,'currency','INR','operator',n.operator,'status',coalesce(n.status_text,n.status_code),
   'createdAt',n.create_time,'submittedAt',n.submit_time,'updatedAt',n.update_time,'completedAt',null,
   'sourceNotes',jsonb_build_object('auto_reason',n.auto_note,'audit_remark',n.audit_note,'reason',n.reason_note,'withdraw_remark',n.withdraw_note),'noteState',n.note_state,
   'rejectionReason',null,'manualRemark',null) item,n.create_time,n.order_num,n.id from selected n
 ), items as (
  select item,count,sort_key from groups where v_kind in('blocking','blockingVariants','categories','rejection')
  union all select item,count,sort_key from operators where v_kind='operators'
 ), page as (select item from items order by count desc,sort_key offset v_offset limit v_limit),
 orders_page as (select item from order_rows order by create_time desc,order_num,id offset v_offset limit v_limit)
 select jsonb_build_object('available',true,'reasonAvailable',true,'source','GAME66 已入库提现订单','sourceNoteFormat','game66_withdraw_notes_v1',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,'basis',case when v_blocking then 'source_auto_reason_note' else 'rejected_order_business_notes' end,
  'classificationAvailable',false,'rejectionReasonAvailable',false,'date',v_date,'kind',v_kind,'noteCount',(select count(*) from notes),
  'rows',case when v_kind in('orders','blockingOrders') then coalesce((select jsonb_agg(item) from orders_page),'[]'::jsonb) else coalesce((select jsonb_agg(item) from page),'[]'::jsonb) end,
  'total',case when v_kind in('orders','blockingOrders') then (select count(*) from selected) else (select count(*) from items) end,
  'summary',jsonb_build_object('totalOrders',(select count(*) from all_orders),'totalRejected',(select count(*) from all_orders where status_code='-1'),
   'sourceNoteStates',jsonb_build_object('present',(select count(*) from notes where note_state='present'),'empty',(select count(*) from notes where note_state='empty'),'missing',(select count(*) from notes where note_state='missing'))),
  'coverage',jsonb_build_object('collected',(select count(*) from all_orders),'expected',null,'complete',false,'basis','created_at','state','received_only'),
  'updatedAt',(select max(last_seen_at) from all_orders),'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true) into v_result;
 if (v_result#>>'{summary,totalOrders}')::bigint=0 then v_result:=v_result||jsonb_build_object('available',false,'noteCount',null,'message','该日期没有已入库 GAME66 提现订单，不能推定源站没有数据。');end if;
 return v_result;
end $game66_notes$;
revoke all on function private.dashboard_admin_game66_withdraw_reasons(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
do $patch_reasons$
declare p record;d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc) not in ('e5d7ffe578bf503374334b8097e8095f','dc349a32d5a9863b90920a7bf69781bb') or md5(pg_get_functiondef(p.oid)) not in ('6a91049ab4ccd5e8f95344e3009e47ff','c590060f409f4c2d9c22c4fc9546669e')
  or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'game66_notes_reasons_contract_drift';end if;
 if md5(p.prosrc)='dc349a32d5a9863b90920a7bf69781bb' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old$ if v_meta.source='ar' then$old$,'')))/length($old$ if v_meta.source='ar' then$old$)<>1 then raise exception 'game66_notes_anchor_drift';end if;
 d:=replace(d,$old$ if v_meta.source='ar' then$old$,$new$ -- game66_received_source_notes_v1: request, scope and native identity were checked above.
 if v_meta.source='game66' then
  v_rows:=private.dashboard_admin_game66_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then$new$);execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'dc349a32d5a9863b90920a7bf69781bb' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'game66_notes_postcondition';end if;
end $patch_reasons$;
commit;
