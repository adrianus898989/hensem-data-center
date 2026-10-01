-- Reviewed production function definitions only; no production records or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;v_blocking boolean;v_grouped_snapshot jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or p_request-array['date','country','platform','kind','offset','limit','category','reasonKey','operatorKey','query']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['date','country','platform','kind','category','reasonKey','operatorKey','query'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if coalesce(p_request->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_time';end if;
 v_date:=(p_request->>'date')::date;v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_kind:=coalesce(p_request->>'kind','blocking');v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 v_blocking:=v_kind in('blocking','blockingOrders','blockingVariants');
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or (v_kind in('blockingOrders','blockingVariants') and (v_reason is null or v_category is not null or v_operator is not null))
  or (v_kind='blockingVariants' and v_query is not null)
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 -- wg_existing_reasons_v1: existing request validation and scope checks ran above.
 v_rows:=private.dashboard_admin_wg_withdraw_reasons(p_request,v_scope);
 if v_rows is not null then return v_rows;end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 select total into v_expected from public.auto_withdraw_daily where (country=v_country or (v_country='胖虎巴西' and upper(country) in ('巴西','BR','BR_PANGHU','PANGHU BRAZIL'))) and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 if v_meta.source='ar' then
  with orders as materialized (
   select order_no,amount,status,nullif(btrim(operator),'') operator,applied_at,completed_at,nullif(btrim(manual_remark),'') manual_raw,nullif(btrim(remark),'') rejection_raw,
    updated_at,
    case when status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (status in('失败','提现失败','出款失败') and coalesce(btrim(raw_channel),'') in ('','人工取消')) then 'rejected' when status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders where source_system='AR' and country_code=v_code and platform=any(v_aliases) and order_kind='withdraw'
     and applied_at>=v_date::timestamp and applied_at<(v_date+1)::timestamp
  ), candidates as materialized (
   select * from orders where (v_blocking and manual_raw ~ '[^[:space:]]') or (not v_blocking and status_group='rejected')
  ), distinct_reasons as materialized (
   -- Classify distinct source text only after selecting the relevant orders.
   -- A busy platform's successful orders do not need rejection-note processing.
   select distinct coalesce(case when v_blocking then manual_raw else rejection_raw end,'') raw_note from candidates
  ), cleaned as materialized (
   select raw_note,private.dashboard_admin_live_clean_note(raw_note) clean_note,
    case when v_blocking then private.dashboard_admin_live_blocking_details(raw_note) end blocking_details
   from distinct_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then private.dashboard_admin_live_rejection_category(v_code,clean_note) end category from cleaned
  ), notes as materialized (
   select o.*,case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,c.blocking_details
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as materialized (
   select * from notes where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(note)=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,md5(note) as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",md5(note) as "reasonKey",count(*)::bigint count,
    count(*) filter(where status_group='success')::bigint success,count(*) filter(where status_group='rejected')::bigint rejected,count(*) filter(where status_group='other')::bigint other
   from selected_notes group by note,source_note
  ), category_groups as (
   select category,md5(category) "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
    count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from selected_notes group by category
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category)::bigint "categoryCount",count(*) filter(where category='源备注为空')::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',private.dashboard_admin_live_clean_note(manual_raw),
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',md5(category),'reasonKey',md5(note),
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end),0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select count(*) from orders where manual_raw ~ '[^[:space:]]'),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,md5(category) "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where category='源备注为空'),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',v_expected,'complete',v_count=v_expected,'rejected',v_rejected,'withManualRemark',v_noted),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true);end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 if not v_blocking then
  select * into v_snapshot from public.withdraw_reasons_daily_grouped where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
   and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 elsif v_snapshot.source_system='PANDA' then
  select snapshot into v_grouped_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_snapshot.country_code and platform=v_snapshot.platform and stat_date=v_date and source_system=v_snapshot.source_system
   and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 end if;
 if v_snapshot.platform is null or v_kind in('orders','operators','blockingOrders') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (not v_blocking and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_blocking and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
   'message',case when v_kind='blockingOrders' then '当前来源只有原因汇总，可查看全部原文及笔数；没有逐笔订单编号' when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when not v_blocking then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with original_groups as materialized (
  select private.dashboard_admin_live_clean_note(g->>'reason_label') source_reason,
   case when v_blocking then private.dashboard_admin_live_blocking_category(coalesce(
    (select gg->>'reason_label' from jsonb_array_elements(v_grouped_snapshot->'groups') gg
     where gg->>'operator_class'=g->>'operator_class' and (gg->>'reason_label'=g->>'reason_label'
      or exists(select 1 from jsonb_array_elements(gg->'variants') vv where vv->>'reason_label'=g->>'reason_label')) limit 1),g->>'reason_label'))
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end reason,
   case when not v_blocking then private.dashboard_admin_live_rejection_category(v_code,private.dashboard_admin_live_clean_note(g->>'reason_label')) end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from jsonb_array_elements(v_snapshot.snapshot->'groups')g
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'<>'auto') group by 1,2,3
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(reason)=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',md5(category),'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category
  union all select jsonb_build_object('reason',reason,'reasonKey',md5(reason),'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',md5(reason),
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,md5(category) "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest);
end;
$function$;
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
 with orders as materialized (
  select d.order_number,d.member_amount as amount,d.status_code,d.status_group,d.created_at,d.captured_at,
   nullif(btrim(d.business_fields->>'operator_name'),'') as operator,
   nullif(btrim(d.business_fields->>'interception_reason'),'') as blocking_note,
   case when d.status_code=7 then nullif(btrim(d.business_fields->>'rejection_reason'),'') end as rejection_note
  from public.wg_withdraw_details d where d.site_code=s.site_code
   and d.created_at>=day::timestamp at time zone s.timezone and d.created_at<(day+1)::timestamp at time zone s.timezone
 ), notes as materialized (
  select o.*,case when blocking then blocking_note else coalesce(rejection_note,'（源备注为空）') end note,
   case when not blocking then coalesce(rejection_note,'源备注为空') end category
  from orders o where (blocking and blocking_note is not null) or (not blocking and status_code=7)
 ), selected as materialized (
  select * from notes where (nullif(p_request->>'reasonKey','') is null or md5(note)=p_request->>'reasonKey')
   and (nullif(p_request->>'category','') is null or md5(category)=p_request->>'category')
   and (nullif(p_request->>'operatorKey','') is null or md5(coalesce(operator,''))=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(order_number))>0)
 ), reason_groups as (
  select note reason,md5(note) "reasonKey",count(*) count,note "sourceReason",1::bigint "sourceVariantCount",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other from selected group by note
 ), categories as (
  select category,md5(category) "categoryKey",count(*) count,min(rejection_note) "sourceReason",
   count(distinct rejection_note) "sourceVariantCount" from selected group by category
 ), operators as (
  select operator,md5(coalesce(operator,'')) "operatorKey",count(*) count,count(distinct category) "categoryCount",
   count(*) filter(where rejection_note is null) "missingReasonCount" from selected group by operator
 ), rendered as (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where k in('blocking','rejection')
  union all select to_jsonb(g)||jsonb_build_object('canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'
  union all select to_jsonb(g),g.count,g.category,null::timestamptz from categories g where k='categories'
  union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamptz from operators g where k='operators'
  union all select jsonb_build_object('orderNumber',order_number,'amount',amount,'currency',s.currency,'status',status_group,'statusCode',status_code,
   'operator',operator,'operatorKey',md5(coalesce(operator,'')),'createdAt',created_at,'completedAt',null,
   'manualRemark',blocking_note,'rejectionReason',rejection_note,'category',category,'categoryKey',md5(category),'reasonKey',md5(note),
   'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null),
   0,order_number,created_at from selected where k in('orders','blockingOrders')
 )
 select jsonb_build_object('available',true,'source','WG 实时明细（脱敏业务文本）','basis',case when blocking then 'interception_reason' else 'rejection_reason' end,
  'country',s.country,'platform',s.platform,'date',day,'kind',k,'total',(select count(*) from rendered),'offset',off,'limit',lim,
  'rows',coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
   (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset off limit lim) p),'[]'::jsonb),
  'noteCount',(select count(*) from notes),'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.count desc,c.category) from categories c),'[]'::jsonb),
  'summary',jsonb_build_object('totalRejected',(select count(*) from orders where status_code=7),
   'missingReason',(select count(*) from notes where rejection_note is null and not blocking),
   'withOperator',(select count(*) from notes where operator is not null),'operators',(select count(distinct operator) from notes),
   'selectedCount',(select count(*) from selected)),
  'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','created_at','operatorBasis','current_latest_operator',
  'coverage',jsonb_build_object('collected',(select count(*) from orders),'expected',null,'complete',completed,
   'rejected',(select count(*) from orders where status_code=7),'withManualRemark',(select count(*) from orders where blocking_note is not null)),
  'updatedAt',(select max(captured_at) from orders),'latestSnapshotDate',null,'snapshotFallback',false) into answer;
 return answer;
end;
$function$;