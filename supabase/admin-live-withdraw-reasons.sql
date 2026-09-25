-- Source notes are separate: AR manual_remark explains interception/manual review;
-- AR remark explains the rejected order. Never infer one from the other.
begin;
-- Scraped tooltips may contain a shortened preview followed by the complete note.
-- Remove only an identical line or a truncated prefix repeated in a later line.
create or replace function private.dashboard_admin_live_clean_note(p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 with parts as materialized (
  select btrim(regexp_replace(line,'^[[:space:]]+|[[:space:]]+$','','g')) as line,ordinality as position
  from regexp_split_to_table(coalesce(p_note,''),E'\\r?\\n') with ordinality as p(line,ordinality)
 ), kept as (
  select p.* from parts p where p.line<>'' and not exists (
   select 1 from parts later where later.position>p.position and (
    later.line=p.line or (p.line ~ '([.]{3}|…+)$'
     and length(regexp_replace(p.line,'([.]{3}|…+)$',''))>0
     and starts_with(later.line,regexp_replace(p.line,'([.]{3}|…+)$','')))))
 ) select nullif(string_agg(line,E'\n' order by position),'') from kept
$$;
revoke all on function private.dashboard_admin_live_clean_note(text) from public,anon,authenticated;
-- Source headings from the user's arwd.py remark whitelist (2026-09-19).
-- A heading describes a reason, never proves that rejecting an order was correct.
-- Both bracket styles/case variants share a category; the complete note is retained.
create or replace function private.dashboard_admin_live_rejection_category(p_country_code text,p_note text)
returns text language sql immutable parallel safe set search_path='' as $$
 with heading as (
  select lower(btrim(regexp_replace(substring(translate(coalesce(p_note,''),'【】','[]')
    from '^[[:space:]]*\[([^]]{1,100})\]'),'[[:space:]]+',' ','g'))) tag
 ) select case
  when lower(btrim(coalesce(p_note,''))) in ('','--','---','----','无','空','n/a','na','详情') then '源备注为空'
  else coalesce(private.dashboard_admin_live_rejection_template(p_country_code,p_note),case tag
   when 'gift code' then '红包 / 兑换码（Gift Codes）' when 'gift codes' then '红包 / 兑换码（Gift Codes）'
   when 'return rewards' then '回归奖励（Return Rewards）'
   when 'sign-up bonus' then '注册奖励（Sign-up Bonus）'
   when 'vip member monthly rewards' then 'VIP 月度奖励（VIP Member Monthly Rewards）'
   when 'illegal bet' then '违规投注（Illegal Bet）'
   when 'abnormal bet' then '异常投注（Abnormal Bet）'
   when 'arbitrage activity' then '套利行为（Arbitrage Activity）'
   when 'resubmit order' then '重新提交（Resubmit Order）'
   when 'ifsc code incorrect' then 'IFSC 错误（IFSC Code Incorrect）'
   when 'bank incorrect' then '银行资料错误（Bank Incorrect）'
   when 'upi data invalid' then 'UPI 资料错误（UPI Data Invalid）'
   when 'e-wallet data incorrect' then '钱包资料错误（E-Wallet Data Incorrect）'
   when 'e-wallet limit' then '钱包额度限制（E-Wallet Limit）'
   when 'maintenance bank' then '银行维护（Maintenance Bank）'
   when 'maintenance e-wallet' then '钱包维护（Maintenance E-Wallet）'
   when 'arb maintenance' then 'ARB 维护（ARB Maintenance）'
   when 'fail become agent' then '代理条件未满足（Fail become Agent）'
   when 'first withdraw' then '首次提现方式（First Withdraw）'
   when 'withdraw incorrect method' then '提现方式错误（Withdrawal Method Incorrect）'
   when 'withdrawal method incorrect' then '提现方式错误（Withdrawal Method Incorrect）'
   when 'verify usdt' then 'USDT 待验证（Verify USDT）'
   when 'withdrawal cancelled successfully' then '取消提现（Withdrawal Cancelled Successfully）'
   when 'withdrawal failed' then '提现失败 / 联系上级（Withdrawal Failed）'
   end,case when tag is not null then '其他标签 · '||tag else '其他未归类备注' end)
  end from heading
$$;
revoke all on function private.dashboard_admin_live_rejection_category(text,text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_withdraw_reasons(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_country text;v_platform text;v_code text;v_date date;v_kind text;
 v_offset integer;v_limit integer;v_meta record;v_aliases text[];v_snapshot record;v_expected bigint;v_latest date;
 v_rows jsonb;v_categories jsonb;v_summary jsonb;v_total bigint;v_count bigint;v_rejected bigint;v_noted bigint;v_updated timestamptz;v_key text;
 v_category text;v_reason text;v_operator text;v_query text;
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
 v_category:=nullif(p_request->>'category','');v_reason:=nullif(p_request->>'reasonKey','');v_operator:=nullif(p_request->>'operatorKey','');v_query:=nullif(btrim(p_request->>'query'),'');
 foreach v_key in array array[v_category,v_reason,v_operator] loop
  if v_key is not null and v_key !~ '^[0-9a-f]{32}$' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 if v_country is null or v_platform is null or v_kind not in('blocking','categories','rejection','operators','orders')
  or (v_kind='blocking' and (v_category is not null or v_reason is not null or v_operator is not null or v_query is not null))
  or v_offset>1000000 or v_limit not in(20,30,50,100,500) then raise exception using errcode='22023',message='invalid_filter';end if;
 if not private.dashboard_scope_allows(v_scope,v_country,v_platform) then raise exception using errcode='42501',message='scope_denied';end if;
 select * into v_meta from private.dashboard_admin_live_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
     or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform)) order by p.source limit 1;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));
 if v_code is null then raise exception using errcode='22023',message='platform_denied';end if;
 v_aliases:=array[v_platform,v_meta.name,v_meta.source_name];
 select total into v_expected from public.auto_withdraw_daily where country=v_country and data_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform) order by updated_at desc limit 1;
 if v_meta.source='ar' then
  with orders as materialized (
   select order_no,amount,status,nullif(btrim(operator),'') operator,applied_at,completed_at,nullif(btrim(manual_remark),'') manual_raw,nullif(btrim(remark),'') rejection_raw,
    private.dashboard_admin_live_clean_note(manual_remark) manual_note,private.dashboard_admin_live_clean_note(remark) rejection_note,updated_at,
    case when status in('未通过','拒绝','驳回','已拒绝','人工取消','已取消')
      or (status in('失败','提现失败','出款失败') and coalesce(btrim(raw_channel),'') in ('','人工取消')) then 'rejected' when status in('已通过','已出款','已完成','成功','已支付','已打款') then 'success' else 'other' end status_group
   from public.ar_collected_orders where source_system='AR' and country_code=v_code and platform=any(v_aliases) and order_kind='withdraw'
     and applied_at>=v_date::timestamp and applied_at<(v_date+1)::timestamp
  ), distinct_reasons as materialized (
   select distinct coalesce(rejection_note,'') as rejection_note from orders where v_kind<>'blocking' and status_group='rejected'
  ), classified as materialized (
   select rejection_note,private.dashboard_admin_live_rejection_category(v_code,rejection_note) category from distinct_reasons
  ), notes as materialized (
   select o.*,case when v_kind='blocking' then o.manual_note else coalesce(o.rejection_note,'（源备注为空）') end as note,
    c.category
   from orders o left join classified c on c.rejection_note=coalesce(o.rejection_note,'') where (v_kind='blocking' and manual_note is not null) or (v_kind<>'blocking' and status_group='rejected')
  ), selected_notes as materialized (
   select * from notes where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(note)=v_reason)
    and (v_operator is null or md5(coalesce(operator,''))=v_operator)
    and (v_query is null or position(lower(v_query) in lower(order_no))>0)
  ), groups as (
   select note as reason,md5(note) as "reasonKey",count(*)::bigint as count,count(*) filter(where status_group='success')::bigint as success,
    count(*) filter(where status_group='rejected')::bigint as rejected,count(*) filter(where status_group='other')::bigint as other
   from selected_notes group by note
  ), category_groups as (
   select category,md5(category) "categoryKey",count(*)::bigint count from selected_notes group by category
  ), operator_groups as (
   select operator,md5(coalesce(operator,'')) "operatorKey",count(*)::bigint count,
    count(distinct category)::bigint "categoryCount",count(*) filter(where category='源备注为空')::bigint "missingReasonCount"
   from selected_notes group by operator
  ), rendered as materialized (
   select to_jsonb(g) item,g.count as sort_count,g.reason as sort_text,null::timestamp as sort_time from groups g where v_kind in('blocking','rejection')
   union all select to_jsonb(g),g.count,g.category,null::timestamp from category_groups g where v_kind='categories'
   union all select to_jsonb(g),g.count,coalesce(g.operator,''),null::timestamp from operator_groups g where v_kind='operators'
   union all select jsonb_build_object('orderNumber',order_no,'amount',amount,'status',status,'operator',operator,
    'operatorKey',md5(coalesce(operator,'')),'createdAt',applied_at,'completedAt',completed_at,'manualRemark',manual_note,
    'rejectionReason',rejection_note,'rawRejectionReason',rejection_raw,'rawManualRemark',manual_raw,'category',category,'categoryKey',md5(category),'reasonKey',md5(note)),0,order_no,applied_at
   from selected_notes where v_kind='orders'
  )
  select (select count(*) from orders),(select count(*) from orders where status_group='rejected'),(select count(*) from orders where manual_note is not null),
   (select max(updated_at) from orders),(select count(*) from rendered),
   coalesce((select jsonb_agg(item order by sort_time desc nulls last,sort_count desc,sort_text) from
    (select * from rendered order by sort_time desc nulls last,sort_count desc,sort_text offset v_offset limit v_limit)p),'[]'::jsonb),
   coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
    (select category,md5(category) "categoryKey",count(*)::bigint count from notes group by category)g),'[]'::jsonb),
   jsonb_build_object('totalRejected',(select count(*) from orders where status_group='rejected'),
    'missingReason',(select count(*) from notes where category='源备注为空'),
    'withOperator',(select count(*) from notes where nullif(btrim(operator),'') is not null),
    'operators',(select count(distinct operator) from notes where nullif(btrim(operator),'') is not null),
    'selectedCount',(select count(*) from selected_notes))
  into v_count,v_rejected,v_noted,v_updated,v_total,v_rows,v_categories,v_summary;
  if v_count>0 then return jsonb_build_object('available',true,'source','AR 已采集订单','basis',case when v_kind='blocking' then 'manual_remark' else 'remark' end,
   'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'total',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows,
   'noteCount',case when v_kind='blocking' then v_noted else v_rejected end,'categories',v_categories,'summary',v_summary,
   'canViewOrders',true,'canViewOperators',true,'timeBasis','applied_at',
   'coverage',jsonb_build_object('collected',v_count,'expected',v_expected,'complete',v_count=v_expected,'rejected',v_rejected,'withManualRemark',v_noted),
   'updatedAt',v_updated,'latestSnapshotDate',null,'snapshotFallback',true);end if;
 end if;
 select max(stat_date) into v_latest from public.withdraw_reasons_daily where country_code=v_code and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform);
 select * into v_snapshot from public.withdraw_reasons_daily_grouped where country_code=v_code and stat_date=v_date
  and private.dashboard_admin_live_withdraw_key(platform)=private.dashboard_admin_live_withdraw_key(v_platform)
  and private.dashboard_scope_allows(v_scope,country_code,platform) order by updated_at desc limit 1;
 if v_snapshot.platform is null or v_kind in('orders','operators') or v_operator is not null or v_query is not null
   or (v_snapshot.source_system='NEWAR' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_kind<>'blocking' and v_snapshot.snapshot->>'note_field' is distinct from 'remark')
   or (v_kind='blocking' and v_snapshot.snapshot->>'note_field'='remark') then
  return jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0,'date',v_date,'kind',v_kind,'latestSnapshotDate',v_latest,
   'message',case when v_kind in('orders','operators') then '当前来源尚未采集逐笔驳回备注及对应操作人，只有原因汇总时不能还原订单详情'
    when v_kind<>'blocking' then '当前来源尚未单独采集驳回订单的备注字段' else '所选日期尚无自动出款拦截原因采集记录' end);
 end if;
 with original_groups as materialized (
  select private.dashboard_admin_live_clean_note(g->>'reason_label') reason,case when v_kind<>'blocking' then private.dashboard_admin_live_rejection_category(v_code,private.dashboard_admin_live_clean_note(g->>'reason_label')) end category,
   sum(case when v_kind<>'blocking' then (g->>'reject')::bigint else (g->>'count')::bigint end)::bigint count,
   sum((g->>'success')::bigint)::bigint success,sum((g->>'reject')::bigint)::bigint rejected,sum((g->>'other')::bigint)::bigint other
  from jsonb_array_elements(v_snapshot.snapshot->'groups')g
  where (v_kind<>'blocking' and (g->>'reject')::bigint>0) or (v_kind='blocking' and g->>'operator_class'<>'auto') group by 1,2
 ), selected_groups as materialized (
  select * from original_groups where (v_category is null or md5(category)=v_category) and (v_reason is null or md5(reason)=v_reason)
 ), rendered as (
  select jsonb_build_object('category',category,'categoryKey',md5(category),'count',sum(count)::bigint) item,sum(count) count,category label
   from selected_groups where v_kind='categories' group by category
  union all select to_jsonb(g)||jsonb_build_object('reasonKey',md5(reason)),count,reason from selected_groups g where v_kind<>'categories'
 ) select (select count(*) from rendered),
  coalesce((select jsonb_agg(item order by count desc,label) from (select * from rendered order by count desc,label offset v_offset limit v_limit)p),'[]'::jsonb),
  (select coalesce(sum(count),0) from original_groups),
  coalesce((select jsonb_agg(to_jsonb(g) order by count desc,category) from
   (select category,md5(category) "categoryKey",sum(count)::bigint count from original_groups group by category)g),'[]'::jsonb),
  jsonb_build_object('totalRejected',v_snapshot.snapshot->'totals'->'reject','selectedCount',(select coalesce(sum(count),0) from selected_groups))
 into v_total,v_rows,v_noted,v_categories,v_summary;
 return jsonb_build_object('available',true,'source',v_snapshot.source_system||' 原因采集快照','basis',coalesce(v_snapshot.snapshot->>'note_field','source_note'),
  'country',v_country,'platform',v_platform,'date',v_date,'kind',v_kind,'rows',v_rows,'total',v_total,'offset',v_offset,'limit',v_limit,
  'noteCount',case when v_kind='blocking' then v_noted else coalesce((v_snapshot.snapshot->'totals'->>'reject')::bigint,v_noted) end,
  'categories',v_categories,'summary',v_summary,'canViewOrders',false,'canViewOperators',false,
  'coverage',v_snapshot.snapshot->'coverage','updatedAt',v_snapshot.updated_at,'latestSnapshotDate',v_latest);
end;
$$;
revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;
create or replace function public.dashboard_admin_live_withdraw_reasons(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_withdraw_reasons(p_request)$$;
revoke all on function public.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
