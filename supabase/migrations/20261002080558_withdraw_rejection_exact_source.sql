-- Rejection distributions and order drilldown use complete source text, not guessed categories.
-- No source rows, collector APIs, role grants, manual blocking rules or money calculations change.
-- Captured live baselines are guarded before replacing either reader; keep existing owners/ACLs.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
DO $guard$
declare p record;
begin
 select f.*,r.rolname owner_name into p from pg_proc f join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('private.dashboard_admin_live_withdraw_reasons(jsonb)');
 if not found or p.prokind<>'f' or p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] or md5(p.prosrc) not in ('7d47d0aff9c221d76775b4d0a84476f7','f5f74d918a82636e1d312cd55ff277da') then
  raise exception 'withdraw rejection exact-source baseline changed: dashboard_admin_live_withdraw_reasons';
 end if;
 select f.*,r.rolname owner_name into p from pg_proc f join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)');
 if not found or p.prokind<>'f' or p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] or md5(p.prosrc) not in ('64f8c050192c10303730c3d4518ce402','eaa58b63c49c9372d9b65bf22118b36f') then
  raise exception 'withdraw rejection exact-source baseline changed: dashboard_admin_wg_withdraw_reasons';
 end if;
 select f.*,r.rolname owner_name into p from pg_proc f join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('private.dashboard_admin_live_rejection_exact_note(text)');
 if found and (p.prokind<>'f' or p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proconfig is distinct from array['search_path=""']::text[] or md5(p.prosrc)<>'bb2fbdac3746296ed927ff58e50a5bf6') then
  raise exception 'withdraw rejection exact-source helper baseline changed: dashboard_admin_live_rejection_exact_note';
 end if;
 select f.*,r.rolname owner_name into p from pg_proc f join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('private.dashboard_admin_live_rejection_exact_key(text)');
 if found and (p.prokind<>'f' or p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'i'
  or p.proconfig is distinct from array['search_path=""']::text[] or md5(p.prosrc)<>'1f404c235faa34ae95cd6c5f229b5900') then
  raise exception 'withdraw rejection exact-source helper baseline changed: dashboard_admin_live_rejection_exact_key';
 end if;
end;
$guard$;

create or replace function private.dashboard_admin_live_rejection_exact_note(p_note text)
returns text language sql immutable set search_path='' as $exact_note$
 select case when p_note ~ '[^[:space:]]' then p_note end;
$exact_note$;
create or replace function private.dashboard_admin_live_rejection_exact_key(p_note text)
returns text language sql immutable set search_path='' as $exact_key$
 select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note(p_note))::text);
$exact_key$;
revoke all on function private.dashboard_admin_live_rejection_exact_note(text),private.dashboard_admin_live_rejection_exact_key(text) from public,anon,authenticated,service_role;

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
  with source_orders as materialized (
   select case when v_kind in('orders','blockingOrders') or v_query is not null then order_no end order_no,
    case when v_kind in('orders','blockingOrders') then amount end amount,
    case when v_kind in('orders','blockingOrders') then status end status,
    nullif(btrim(operator),'') operator,
    case when v_kind in('orders','blockingOrders') then applied_at end applied_at,
    case when v_kind in('orders','blockingOrders') then completed_at end completed_at,
    nullif(btrim(manual_remark),'') manual_raw,case when not v_blocking or v_kind='blockingOrders' then case when v_blocking then nullif(btrim(remark),'') else remark end end rejection_raw,
    updated_at,
    case when nullif(regexp_replace(coalesce(operator,''),'^[[:space:]]+|[[:space:]]+$','','g'),'') is null then 'unknown'
     when lower(regexp_replace(operator,'^[[:space:]]+|[[:space:]]+$','','g'))='system' then 'system' else 'manual' end blocking_operator_class,
    case when status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (status in('失败','提现失败','出款失败') and coalesce(btrim(raw_channel),'') in ('','人工取消')) then 'rejected' when status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders where source_system='AR' and country_code=v_code and platform=any(v_aliases) and order_kind='withdraw'
     and applied_at>=v_date::timestamp and applied_at<(v_date+1)::timestamp
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
    case when v_blocking then case when clean_note ~ '[^[:space:]]' then private.dashboard_admin_live_blocking_details_cleaned(clean_note)
     else jsonb_build_object('reason','检测没备注') end end blocking_details
   from normalized_reasons
  ), classified as materialized (
   select raw_note,clean_note,blocking_details,case when v_blocking then blocking_details->>'reason' else clean_note end group_note,
    case when not v_blocking then coalesce(clean_note,'（源备注为空）') end category from cleaned
  ), notes as materialized (
   select o.order_no,o.amount,o.status,o.operator,o.applied_at,o.completed_at,
    case when v_kind in('orders','blockingOrders') then o.manual_raw end manual_raw,
    case when v_kind in('orders','blockingOrders') then o.rejection_raw end rejection_raw,
    case when v_kind in('orders','blockingOrders') then o.normalized_note end normalized_note,
    o.status_group,
    case when v_blocking then c.group_note else coalesce(c.clean_note,'（源备注为空）') end as note,
    case when not v_blocking then c.clean_note end rejection_note,c.clean_note source_note,c.category,c.blocking_details,
    case when v_blocking then md5(c.group_note) else private.dashboard_admin_live_rejection_exact_key(c.clean_note) end note_key,
    case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(c.clean_note) end category_key
   from candidates o join classified c on c.raw_note=coalesce(case when v_blocking then o.manual_raw else o.rejection_raw end,'')
  ), selected_notes as materialized (
   select * from notes where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,note_key as "reasonKey",count(*)::bigint as count,min(source_note) as "sourceReason",count(distinct source_note)::bigint as "sourceVariantCount",
    count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note,note_key
  ), variant_groups as (
   select source_note as reason,source_note as "sourceReason",note as "canonicalReason",note_key as "reasonKey",count(*)::bigint count,
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
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.reason,null::timestamp from variant_groups g where v_kind='blockingVariants'
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',case when v_blocking then normalized_note else private.dashboard_admin_live_clean_note(manual_raw) end,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',category_key,'reasonKey',note_key,
    'blockingReason',case when v_blocking then note end,
    'blockingActualValue',case when v_blocking then blocking_details->>'actualValue' end,
    'blockingActualField',case when v_blocking then blocking_details->>'actualField' end,
    'blockingThreshold',case when v_blocking then blocking_details->>'threshold' end),0,order_no,applied_at
   from selected_notes where v_kind in('orders','blockingOrders')
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select case when v_blocking then (select manual from operator_stats) else raw end from blocking_stats),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,category_key "categoryKey",count(*)::bigint count,min(rejection_note) filter(where rejection_note is not null) as "sourceReason",
      count(distinct rejection_note) filter(where rejection_note is not null)::bigint as "sourceVariantCount" from notes group by category,category_key)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where not v_blocking and rejection_note is null),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
     ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis','current_operator') else '{}'::jsonb end
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_blocking then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_blocking then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',v_expected,'complete',v_count=v_expected,'rejected',v_rejected,'withManualRemark',case when v_blocking then (v_summary->'operatorCounts'->>'manualWithReason')::bigint else v_noted end),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily where (country_code=v_code or (v_code='BR_PANGHU' and country_code='BR')) and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 -- Rejection snapshots retain the complete source reason_label. A semantic grouped
 -- view cannot prove which original text a caller selected.
 if v_blocking and v_snapshot.source_system='PANDA' then
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
 with source_groups as materialized (
  -- Empty categories are included only when the snapshot explicitly records a manual group.
  -- Missing groups cannot be inferred from a source total or a different operator class.
  select g from jsonb_array_elements(v_snapshot.snapshot->'groups')g
 ), blocking_stats as (
  select coalesce(sum((g->>'count')::bigint),0)::bigint raw,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='manual'),0)::bigint manual,
   coalesce(sum((g->>'count')::bigint) filter(where g->>'operator_class'='auto'),0)::bigint system,
   coalesce(sum((g->>'count')::bigint) filter(where coalesce(g->>'operator_class','unknown') not in('manual','auto')),0)::bigint unknown
  from source_groups where g->>'classification' is distinct from 'empty' and private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]'
 ), base_original_groups as materialized (
  select case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then null
    when not v_blocking then case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end
    else private.dashboard_admin_live_clean_note(g->>'reason_label') end source_reason,
   case when v_blocking and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)) then '检测没备注'
    when v_blocking then private.dashboard_admin_live_blocking_category(coalesce(
    (select gg->>'reason_label' from jsonb_array_elements(v_grouped_snapshot->'groups') gg
     where gg->>'operator_class'=g->>'operator_class' and (gg->>'reason_label'=g->>'reason_label'
      or exists(select 1 from jsonb_array_elements(gg->'variants') vv where vv->>'reason_label'=g->>'reason_label')) limit 1),g->>'reason_label'))
    else coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end reason,
   case when not v_blocking then coalesce(case when g->>'classification'='empty' then null else private.dashboard_admin_live_rejection_exact_note(g->>'reason_label') end,'（源备注为空）') end category,
   sum(case when not v_blocking then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from source_groups
  where (not v_blocking and (g->>'reject')::bigint>0) or (v_blocking and g->>'operator_class'='manual') group by 1,2,3
 ), original_groups as materialized (
  select b.*,case when v_blocking then md5(reason) else private.dashboard_admin_live_rejection_exact_key(source_reason) end note_key,
   case when not v_blocking then private.dashboard_admin_live_rejection_exact_key(source_reason) end category_key
  from base_original_groups b
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or category_key=v_category) and (v_reason is null or note_key=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',category_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category,category_key
  union all select jsonb_build_object('reason',reason,'reasonKey',note_key,'count',sum(count)::bigint,
    'sourceReason',min(source_reason),'sourceVariantCount',count(distinct source_reason)::bigint,
    'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint) item,sum(count),reason
   from selected_groups g where v_kind in('blocking','rejection') group by reason,note_key
  union all select jsonb_build_object('reason',source_reason,'sourceReason',source_reason,'canonicalReason',reason,'reasonKey',note_key,
    'count',sum(count)::bigint,'success',sum(success)::bigint,'rejected',sum(rejected)::bigint,'other',sum(other)::bigint),sum(count),source_reason
   from selected_groups where v_kind='blockingVariants' group by source_reason,reason,note_key
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,category_key "categoryKey",sum(count)::bigint count,min(source_reason) as "sourceReason",
     count(distinct source_reason)::bigint as "sourceVariantCount" from original_groups group by category,category_key)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
   ||case when v_blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),
    -- Reason snapshots do not prove the complete operator universe. Never infer totals from note groups.
    'operatorCounts',jsonb_build_object('total',null,'manual',null,'system',null,'unknown',null,
      'manualWithReason',(select manual from blocking_stats),'manualWithoutReason',
       (select sum((g->>'count')::bigint) from source_groups where g->>'operator_class'='manual'
        and (g->>'classification'='empty' or not coalesce(private.dashboard_admin_live_clean_note(g->>'reason_label') ~ '[^[:space:]]',false)))),'operatorBasis','snapshot_classification') else '{}'::jsonb end
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_blocking then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewBlockingOrders',false,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest)||case when not v_blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end;
end;
$function$
;

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
   case when d.status_code=7 then case when blocking then nullif(btrim(d.business_fields->>'rejection_reason'),'') else private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') end end as rejection_note,
   case when d.status_code=7 then d.business_fields->>'rejection_reason' end raw_rejection_note
  from public.wg_withdraw_details d where d.site_code=s.site_code
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
 ), notes as materialized (
  select o.*,case when blocking then case when normalized_note ~ '[^[:space:]]' then blocking_note else '检测没备注' end else coalesce(rejection_note,'（源备注为空）') end note,
   case when not blocking then coalesce(rejection_note,'（源备注为空）') end category
  from orders o where (blocking and blocking_operator_class='manual') or (not blocking and status_code=7)
 ), keyed_notes as materialized (
  select n.*,case when blocking then md5(note) else private.dashboard_admin_live_rejection_exact_key(rejection_note) end note_key,
   case when not blocking then private.dashboard_admin_live_rejection_exact_key(rejection_note) end category_key from notes n
 ), selected as materialized (
  select * from keyed_notes where (nullif(p_request->>'reasonKey','') is null or note_key=p_request->>'reasonKey')
   and (nullif(p_request->>'category','') is null or category_key=p_request->>'category')
   and (nullif(p_request->>'operatorKey','') is null or md5(coalesce(operator,''))=p_request->>'operatorKey')
   and (nullif(btrim(p_request->>'query'),'') is null or position(lower(btrim(p_request->>'query')) in lower(order_number))>0)
 ), reason_groups as (
  select note reason,note_key "reasonKey",count(*) count,case when blocking and note='检测没备注' then min(blocking_note) filter(where normalized_note ~ '[^[:space:]]') else note end "sourceReason",
   case when blocking and note='检测没备注' then count(distinct blocking_note) filter(where normalized_note ~ '[^[:space:]]') else 1::bigint end "sourceVariantCount",
   count(*) filter(where status_code=4) success,count(*) filter(where status_code=7) rejected,
   count(*) filter(where status_code not in(4,7)) other from selected group by note,note_key
 ), categories as (
  select category,category_key "categoryKey",count(*) count,min(rejection_note) "sourceReason",
   count(distinct rejection_note) "sourceVariantCount" from selected group by category,category_key
 ), operators as (
  select operator,md5(coalesce(operator,'')) "operatorKey",count(*) count,count(distinct category_key) "categoryCount",
   count(*) filter(where rejection_note is null) "missingReasonCount" from selected group by operator
 ), rendered as (
  select to_jsonb(g) item,g.count sort_count,g.reason sort_text,null::timestamptz sort_time from reason_groups g where k in('blocking','rejection')
  union all select to_jsonb(g)||jsonb_build_object('reason',g."sourceReason",'canonicalReason',g.reason),g.count,g.reason,null::timestamptz from reason_groups g where k='blockingVariants'
  union all select to_jsonb(g),g.count,g.category,null::timestamptz from categories g where k='categories'
  union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamptz from operators g where k='operators'
  union all select jsonb_build_object('orderNumber',order_number,'amount',amount,'currency',s.currency,'status',status_group,'statusCode',status_code,
   'operator',operator,'operatorKey',md5(coalesce(operator,'')),'createdAt',created_at,'completedAt',null,
   'manualRemark',blocking_note,'rejectionReason',rejection_note,'category',category,'categoryKey',category_key,'reasonKey',note_key,
   'blockingReason',case when blocking then note end,'blockingActualValue',null,'blockingActualField',null,'blockingThreshold',null)||case when not blocking then jsonb_build_object('rawRejectionReason',raw_rejection_note) else '{}'::jsonb end,
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
   'selectedCount',(select count(*) from selected))
    ||case when blocking then jsonb_build_object('blockingCounts',(select to_jsonb(b) from blocking_stats b),'operatorCounts',(select to_jsonb(o) from operator_stats o),'operatorBasis','current_latest_operator') else '{}'::jsonb end,
  'canViewBlockingOrders',true,'canViewOrders',true,'canViewOperators',true,'timeBasis','created_at','operatorBasis','current_latest_operator',
  'coverage',jsonb_build_object('collected',(select count(*) from orders),'expected',null,'complete',completed,
   'rejected',(select count(*) from orders where status_code=7),'withManualRemark',case when blocking then (select "manualWithReason" from operator_stats) else (select count(*) from orders where blocking_note is not null) end),
  'updatedAt',(select max(captured_at) from orders),'latestSnapshotDate',null,'snapshotFallback',false)||case when not blocking then jsonb_build_object('rejectionGrouping','exact_source_text_v1') else '{}'::jsonb end into answer;
 return answer;
end;
$function$
;


notify pgrst,'reload schema';
commit;
