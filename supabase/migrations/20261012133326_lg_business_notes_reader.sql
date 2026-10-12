-- LG business notes: explicit versioned fields, no inferred rejection cause.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
-- LG_HELPER_GUARD
do $helper_guard$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.lg_business_note_safe(text)');
 if p.oid is null or md5(p.prosrc)<>'f3b580e8a02841bd0398483cbd0220e1' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'lg_business_sanitizer_drift';end if;

 if to_regprocedure('private.dashboard_admin_lg_business_notes(jsonb)') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_lg_business_notes(jsonb)');
 if md5(p.prosrc)<>'ee464241b544ad6549c283c2594a4324' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'lg_business_helper_drift';end if;end if;

 if to_regprocedure('private.dashboard_admin_lg_business_fields(jsonb)') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_lg_business_fields(jsonb)');
 if md5(p.prosrc)<>'e4a4893995e52749b3db9550c55e7f3e' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'lg_business_helper_drift';end if;end if;

 if to_regprocedure('private.dashboard_admin_lg_withdraw_reasons(jsonb,jsonb,jsonb)') is not null then
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_lg_withdraw_reasons(jsonb,jsonb,jsonb)');
 if md5(p.prosrc)<>'4969eed5341e7be3e86588ff8a7e6758' or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.provolatile<>'s'
  or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'lg_business_helper_drift';end if;end if;
end $helper_guard$;
create or replace function private.dashboard_admin_lg_business_notes(p_raw jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $lg_note$
declare k text;v text;s text;notes jsonb:='{}';states jsonb:='{}';overall text;
begin
 foreach k in array array['remark','appRemark'] loop
  s:='missing';v:=null;
  if p_raw->'businessSchemaVersion'='1'::jsonb and jsonb_typeof(p_raw->k)='string'
   and jsonb_typeof(p_raw->(k||'State'))='string' and length(p_raw->>k)<=12000 then
   s:=p_raw->>(k||'State');
   if s='empty' and p_raw->>k='' then v:='';
   elsif s='redacted' and p_raw->>k='[已隐藏]' then v:='[已隐藏]';
   elsif s='present' and nullif(btrim(p_raw->>k),'') is not null then
    v:=private.lg_business_note_safe(p_raw->>k);
    if v is null or v='' then s:='missing';v:=null;
    elsif v='[已隐藏]' then s:='redacted';end if;
   else s:='missing';end if;
  end if;
  notes:=notes||jsonb_build_object(k,v);states:=states||jsonb_build_object(k,s);
 end loop;
 overall:=case when states->>'remark'='present' or states->>'appRemark'='present' then 'present'
  when states->>'remark'='redacted' or states->>'appRemark'='redacted' then 'redacted'
  when states->>'remark'='empty' and states->>'appRemark'='empty' then 'empty' else 'missing' end;
 return jsonb_build_object('sourceNotes',notes,'sourceNoteStates',states,'noteState',overall);
end $lg_note$;
revoke all on function private.dashboard_admin_lg_business_notes(jsonb) from public,anon,authenticated,service_role;
create or replace function private.dashboard_admin_lg_business_fields(p_raw jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $lg_fields$
declare k text;v text;g jsonb;clean_group jsonb;groups jsonb:='[]';result jsonb:='{}';
begin
 if p_raw->'businessSchemaVersion' is distinct from '1'::jsonb then return result;end if;
 -- Amount/flag/time names are source names, not interpreted settlement or fee semantics.
 foreach k in array array['orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money',
  'beforeRechargeWithdrawDiff','currentProfitAmount','rechargeWithdrawDiff'] loop
  if jsonb_typeof(p_raw->k) in('string','number') and p_raw->>k ~ '^-?[0-9]{1,30}(\.[0-9]{1,18})?$' then
   result:=result||jsonb_build_object(k,p_raw->>k);end if;
 end loop;
 foreach k in array array['status','firstFlag','successNo','totalOrderNum','lockType'] loop
  if (jsonb_typeof(p_raw->k)='number' or (k='status' and jsonb_typeof(p_raw->k)='string')) and p_raw->>k ~ '^-?[0-9]{1,18}$' then result:=result||jsonb_build_object(k,p_raw->>k);end if;
 end loop;
 foreach k in array array['createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'] loop
  v:=p_raw->>k;
  if jsonb_typeof(p_raw->k) in('string','number') and (v ~ '^[0-9]{1,16}$' or v ~ '^20[0-9]{2}[-/][0-9]{2}[-/][0-9]{2}([ T][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$') then
   result:=result||jsonb_build_object(k,v);end if;
 end loop;
 foreach k in array array['appCode','appName','transactionId','withdrawBankAppName','withdrawChannelName','withdrawMethodName','withdrawThirdName','withdrawTypeCode','withdrawTypeName',
  'rechargeChannelName','rechargeMethodName','rechargeThirdName','rechargeTypeName','thirdMethodName','operatorName','lockOperatorName'] loop
  if jsonb_typeof(p_raw->k)='string' and length(p_raw->>k)<=(case when k='transactionId' then 200 else 500 end) then
   v:=case when k='transactionId' and p_raw->>k ~ '^[A-Za-z0-9_.-]{0,200}$' then p_raw->>k else private.lg_business_note_safe(p_raw->>k) end;
   result:=result||jsonb_build_object(k,v);
  end if;
 end loop;
 if jsonb_typeof(p_raw->'groupList')='array' and jsonb_array_length(p_raw->'groupList')<=100 then
  for g in select value from jsonb_array_elements(p_raw->'groupList') loop
   if jsonb_typeof(g)<>'object' then continue;end if;clean_group:='{}';
   if jsonb_typeof(g->'groupId')='number' and g->>'groupId' ~ '^-?[0-9]{1,18}$' then clean_group:=clean_group||jsonb_build_object('groupId',g->>'groupId');end if;
   if jsonb_typeof(g->'groupName')='string' and length(g->>'groupName')<=500 then clean_group:=clean_group||jsonb_build_object('groupName',private.lg_business_note_safe(g->>'groupName'));end if;
   if jsonb_typeof(g->'colorTag')='string' and g->>'colorTag' ~ '^(#[A-Fa-f0-9]{3}|#[A-Fa-f0-9]{4}|#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{8}|[A-Za-z]{1,32})$' then clean_group:=clean_group||jsonb_build_object('colorTag',g->>'colorTag');end if;
   groups:=groups||jsonb_build_array(clean_group);
  end loop;
  result:=result||jsonb_build_object('groupList',groups);
  if p_raw->'groupListTruncated'='true'::jsonb then result:=result||jsonb_build_object('groupListTruncated',true);end if;
 end if;
 return result;
end $lg_fields$;
revoke all on function private.dashboard_admin_lg_business_fields(jsonb) from public,anon,authenticated,service_role;
create or replace function private.dashboard_admin_lg_withdraw_reasons(p_request jsonb,p_scope jsonb,p_meta jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $lg_notes$
declare v_date date;v_kind text;v_start timestamptz;v_end timestamptz;v_offset integer;v_limit integer;v_result jsonb;v_country text;v_zone text;
begin
 if p_meta->>'source' is distinct from 'lg' then return null;end if;
 v_country:=public.lg_platform_country(p_meta->>'source_name');v_zone:=public.lg_country_timezone(v_country);
 if btrim(p_request->>'country') is distinct from p_meta->>'country'
  or v_country is null or v_zone is null or p_meta->>'scope_group' is distinct from v_country
  or p_meta->>'timezone' is distinct from v_zone
  or private.dashboard_scope_allows(p_scope,p_meta->>'country',btrim(p_request->>'platform')) is not true
  or private.dashboard_scope_allows(p_scope,v_country,p_meta->>'source_name') is not true
  or not (private.dashboard_admin_live_withdraw_key(btrim(p_request->>'platform'))=any(array[private.dashboard_admin_live_withdraw_key(p_meta->>'name'),private.dashboard_admin_live_withdraw_key(p_meta->>'source_name')]))
  then raise exception using errcode='42501',message='scope_denied';end if;
 v_date:=(p_request->>'date')::date;v_kind:=coalesce(p_request->>'kind','blocking');
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_date is null or v_kind not in('blocking','blockingVariants','blockingOrders','categories','rejection','operators','orders') or v_offset not between 0 and 1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if v_kind in('blocking','blockingVariants','blockingOrders') then
  return jsonb_build_object('available',false,'sourceNoteFormat','lg_business_notes_v1','classificationAvailable',false,'rejectionReasonAvailable',false,
   'rows','[]'::jsonb,'noteCount',null,'total',0,'coverage',jsonb_build_object('complete',false,'expected',null,'state','received_only'),
   'message','LG 未提供已确认的自动出款拦截原因，请查看驳回订单业务备注。');
 end if;
 v_start:=v_date::timestamp at time zone v_zone;v_end:=(v_date+1)::timestamp at time zone v_zone;
 with all_orders as materialized (
  select w.order_no,w.metric_amount,w.status_class,w.status_text,w.created_at,w.updated_at,
   case when w.status_class='rejected' then private.dashboard_admin_lg_business_notes(w.raw) end notes,
   case when w.status_class='rejected' and (v_kind in('orders','operators') or nullif(p_request->>'operatorKey','') is not null)
    then private.dashboard_admin_order_business_text(w.operator_name) end operator
  from public.lg_orders w where w.source_system='LG' and w.country_code=v_country
   and w.platform=p_meta->>'source_name' and w.order_kind='withdraw' and w.created_at>=v_start and w.created_at<v_end
 ), rejected as materialized (
  select o.*,md5(jsonb_build_array('lg_business_notes_v1',o.notes)::text) note_key,md5(coalesce(o.operator,'')) operator_key
  from all_orders o where o.status_class='rejected'
 ), selected as (
  select * from rejected n where (nullif(p_request->>'category','') is null or n.note_key=p_request->>'category')
   and (nullif(p_request->>'reasonKey','') is null or n.note_key=p_request->>'reasonKey')
   and (nullif(p_request->>'operatorKey','') is null or n.operator_key=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(n.order_no))>0)
 ), groups as (
  select n.notes||jsonb_build_object('categoryKey',n.note_key,'reasonKey',n.note_key,'count',count(*),'sourceVariantCount',1) item,
   count(*) count,n.note_key sort_key from selected n group by n.notes,n.note_key
 ), operators as (
  select jsonb_build_object('operator',n.operator,'operatorKey',n.operator_key,'count',count(*),'categoryCount',count(distinct n.note_key),
   'missingReasonCount',count(*) filter(where n.notes->>'noteState'<>'present')) item,count(*) count,n.operator_key sort_key
  from selected n group by n.operator,n.operator_key
 ), order_rows as (
  select n.notes||jsonb_build_object('orderNumber',n.order_no,'amount',n.metric_amount::text,
   'currency',case v_country when 'PH' then 'PHP' when 'ID' then 'IDR' when 'PK' then 'PKR' end,
   'operator',n.operator,'status',coalesce(n.status_text,n.status_class),'createdAt',n.created_at,'updatedAt',n.updated_at,
   'completedAt',null,'rejectionReason',null,'manualRemark',null) item,n.created_at,n.order_no from selected n
 ), items as (
  select item,count,sort_key from groups where v_kind in('categories','rejection')
  union all select item,count,sort_key from operators where v_kind='operators'
 ), page as (select item from items order by count desc,sort_key offset v_offset limit v_limit),
 orders_page as (select item from order_rows order by created_at desc,order_no offset v_offset limit v_limit)
 select jsonb_build_object('available',true,'reasonAvailable',true,'source','LG 已入库提现订单','sourceNoteFormat','lg_business_notes_v1',
  'reasonTextFormat','sanitized_label_v1','reasonTextSanitized',true,'basis','rejected_order_business_notes',
  'classificationAvailable',false,'rejectionReasonAvailable',false,'date',v_date,'timezone',v_zone,'kind',v_kind,'noteCount',(select count(*) from rejected),
  'rows',case when v_kind='orders' then coalesce((select jsonb_agg(item) from orders_page),'[]'::jsonb) else coalesce((select jsonb_agg(item) from page),'[]'::jsonb) end,
  'total',case when v_kind='orders' then (select count(*) from selected) else (select count(*) from items) end,
  'summary',jsonb_build_object('totalOrders',(select count(*) from all_orders),'totalRejected',(select count(*) from rejected),
   'sourceNoteStates',jsonb_build_object('present',(select count(*) from rejected where notes->>'noteState'='present'),
    'empty',(select count(*) from rejected where notes->>'noteState'='empty'),'redacted',(select count(*) from rejected where notes->>'noteState'='redacted'),
    'missing',(select count(*) from rejected where notes->>'noteState'='missing'))),
  'coverage',jsonb_build_object('collected',(select count(*) from all_orders),'expected',null,'complete',false,'basis','created_at','state','received_only'),
  'updatedAt',(select max(updated_at) from all_orders),'canViewBlockingOrders',false,'canViewOrders',true,'canViewOperators',true) into v_result;
 if (v_result#>>'{summary,totalOrders}')::bigint=0 then v_result:=v_result||jsonb_build_object('available',false,'noteCount',null,'message','该日期没有已入库 LG 提现订单，不能推定源站没有数据。');end if;
 return v_result;
end $lg_notes$;
revoke all on function private.dashboard_admin_lg_withdraw_reasons(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
-- LG_PATCHES
do $patch_dashboard_admin_live_withdraw_reasons$
declare p record;d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc) not in('100dd15063ed4560470f76418ab89c5c','2c8bb2274650a53f8e5fb80b57e00fd2') or md5(pg_get_functiondef(p.oid)) not in('994ee2a02619f403a075a6c14b393eae','dd7cc26e9b452db2313a2a663d84c694')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from true
  or p.provolatile<>'s' or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'lg_business_dashboard_admin_live_withdraw_reasons_contract_drift';end if;
 if md5(p.prosrc)='2c8bb2274650a53f8e5fb80b57e00fd2' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old$ if v_meta.source='ar' then$old$,'')))/length($old$ if v_meta.source='ar' then$old$)<>1 then raise exception 'lg_business_anchor_drift';end if;
 d:=replace(d,$old$ if v_meta.source='ar' then$old$,$new$ -- lg_business_notes_v1: original request, authorization and native catalog checks ran above.
 if v_meta.source='lg' then
  v_rows:=private.dashboard_admin_lg_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));
  if v_rows is not null then return v_rows;end if;
 end if;
 if v_meta.source='ar' then$new$);execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'2c8bb2274650a53f8e5fb80b57e00fd2' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'lg_business_postcondition';end if;
end $patch_dashboard_admin_live_withdraw_reasons$;

do $patch_dashboard_admin_live_auto_withdraw$
declare p record;d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc) not in('58e087fc9d04dec9256899b442ad22ad','94cdc64949dff5d1a14ac680ee6c956b') or md5(pg_get_functiondef(p.oid)) not in('c65fbf2ff539b38b39eb668ba1dca6a0','57ac3ed21721f55a2f41dcee0c532109')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from true
  or p.provolatile<>'s' or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'lg_business_dashboard_admin_live_auto_withdraw_contract_drift';end if;
 if md5(p.prosrc)='94cdc64949dff5d1a14ac680ee6c956b' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old$ return v_result;$old$,'')))/length($old$ return v_result;$old$)<>1 then raise exception 'lg_business_anchor_drift';end if;
 d:=replace(d,$old$ return v_result;$old$,$new$ -- lg_business_notes_metadata_v1: only tag existing rows with an exact authorized native LG identity.
 with lg_catalog as materialized (select p.* from private.dashboard_admin_live_platforms() p where p.source='lg'),
 tagged as (select x.ordinality,x.value||case when exists(select 1 from lg_catalog p
  where p.country=x.value->>'country' and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)
   and private.dashboard_admin_live_withdraw_key(x.value->>'platform')=any(array[private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)]))
  then jsonb_build_object('reasonAvailable',true,'sourceNotesAvailable',true,'sourceNoteFormat','lg_business_notes_v1') else '{}'::jsonb end value
  from jsonb_array_elements(v_result->'rows') with ordinality x)
 select jsonb_set(v_result,'{rows}',coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)) into v_result from tagged;
 return v_result;$new$);execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'94cdc64949dff5d1a14ac680ee6c956b' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'lg_business_postcondition';end if;
end $patch_dashboard_admin_live_auto_withdraw$;

do $patch_dashboard_admin_order_business_result$
declare p record;d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_order_business_result(jsonb,text,text,text,uuid)'::regprocedure;
 if md5(p.prosrc) not in('5ccde0d571d96dc48580c85881c351db','ccd454c7f7c2c3bf264640da318365e8') or md5(pg_get_functiondef(p.oid)) not in('04070a32f0cddbcd005f13aef4abe174','eb354a8c4c9bf79dcd19b26ff69545ab')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from false
  or p.provolatile<>'s' or p.proparallel<>'u' or p.procost<>100 or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'lg_business_dashboard_admin_order_business_result_contract_drift';end if;
 if md5(p.prosrc)='ccd454c7f7c2c3bf264640da318365e8' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old$  if r->>'direction'='withdraw' then
   if p_source='lg' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
     'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
     'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
     'processing_time_basis','source_processing','processing_method_available',true)
    into b from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind='withdraw' and d.order_no=r->>'order_number';
   elsif p_source='duoli'$old$,'')))/length($old$  if r->>'direction'='withdraw' then
   if p_source='lg' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
     'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
     'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
     'processing_time_basis','source_processing','processing_method_available',true)
    into b from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind='withdraw' and d.order_no=r->>'order_number';
   elsif p_source='duoli'$old$)<>1 then raise exception 'lg_business_anchor_drift';end if;
 d:=replace(d,$old$  if r->>'direction'='withdraw' then
   if p_source='lg' then
    select jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
     'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
     'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
     'processing_time_basis','source_processing','processing_method_available',true)
    into b from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind='withdraw' and d.order_no=r->>'order_number';
   elsif p_source='duoli'$old$,$new$  if p_source='lg' and r->>'direction' in('withdraw','charge') then
   with source_order as materialized (
    select d.operator_name,d.operator_kind,d.finished_at,d.handle_seconds,
     private.dashboard_admin_lg_business_notes(d.raw) notes,private.dashboard_admin_lg_business_fields(d.raw) business_fields
    from public.lg_orders d where d.source_system='LG' and d.country_code=p_country and d.platform=p_platform
     and d.order_kind=case r->>'direction' when 'withdraw' then 'withdraw' else 'recharge' end and d.order_no=r->>'order_number'
   )
   select (case when r->>'direction'='withdraw' then jsonb_build_object('operator_name',private.dashboard_admin_order_business_text(d.operator_name),
    'operator_class',case when d.operator_kind in('auto','manual') then d.operator_kind end,
    'processing_completed_at',d.finished_at,'processing_duration_seconds',case when d.handle_seconds>=0 then d.handle_seconds end,
    'processing_time_basis','source_processing','processing_method_available',true) else '{}'::jsonb end)
    ||jsonb_build_object('lg_remark',d.notes#>'{sourceNotes,remark}','lg_remark_state',d.notes#>'{sourceNoteStates,remark}',
     'lg_app_remark',d.notes#>'{sourceNotes,appRemark}','lg_app_remark_state',d.notes#>'{sourceNoteStates,appRemark}',
     'source_business_fields',d.business_fields) into b from source_order d;
  elsif r->>'direction'='withdraw' then
   if p_source='duoli'$new$);execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_order_business_result(jsonb,text,text,text,uuid)'::regprocedure;
 if md5(p.prosrc)<>'ccd454c7f7c2c3bf264640da318365e8' or to_jsonb(p)-'prosrc' is distinct from before_meta then raise exception 'lg_business_postcondition';end if;
end $patch_dashboard_admin_order_business_result$;
commit;
