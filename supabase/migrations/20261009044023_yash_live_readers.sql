-- Native YASH/KB orders, using the existing authorized dashboard readers.
-- Completion is the source order completion time; it is not bank-arrival proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Status labels verified from both deposit and withdrawal source HTML select options.
create or replace function private.dashboard_admin_yash_status(p_kind text,p_status text)
returns text language sql immutable set search_path='' as $$
 select case
  when p_kind='deposit' and p_status in('充值成功','人工确认成功') then 'success'
  when p_kind='withdrawal' and p_status in('已提现','人工确认成功') then 'success'
  when p_kind='deposit' and p_status in('已创建','处理中') then 'pending'
  when p_kind='withdrawal' and p_status in('审核中','提现中','审核通过') then 'pending'
  when p_kind='deposit' and p_status in('充值失败','订单过期') then 'failed'
  when p_kind='deposit' and p_status='用户取消' then 'rejected'
  when p_kind='withdrawal' and p_status in('已驳回','已退币') then 'rejected'
  when p_kind='withdrawal' and p_status in('已罚没','提现失败') then 'failed'
  else 'unknown' end;
$$;
create or replace function private.dashboard_admin_yash_provider(p_supplier text)
returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(btrim(p_supplier),''),'未识别通道');
$$;
create or replace function private.dashboard_admin_yash_completed_at(p_kind text,p_status text,p_created timestamptz,p_completed timestamptz,p_asof timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select case when private.dashboard_admin_yash_status(p_kind,p_status)='success'
  and isfinite(p_created) and isfinite(p_completed) and isfinite(p_asof)
  and p_completed>=p_created and p_completed<=p_asof then p_completed end;
$$;
create or replace function private.dashboard_admin_yash_capabilities()
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('sourceDetailSystem','KB','sourcePriority','native_details_only',
  'systemOrderId',false,'thirdPartyOrderNumber',true,'utr',false,'actualAmount',true,'recordedFee',true,
  'historicalFees',false,'amountBasis','source_amount_with_verified_currency',
  'successTimeAvailable',true,'chargeSuccessTimeAvailable',true,'withdrawSuccessTimeAvailable',true,
  'successTimeBasis','source_completed_at','successCohort','successful_status_and_completed_at_in_selected_range',
  'paymentSuccessTimeAvailable',false,'customerPaymentTime',false,
  'latencyAvailable',true,'latencyBasis','order_processing_duration',
  'pendingBasis','selected_created_cohort_current_stored_status',
  'sourceCompletenessVerified',false,'coverageBasis','acknowledged_created_windows',
  'memberDailyAvailable',true,'analysisOrdersAvailable',true,'autoWithdrawAvailable',false,'workordersAvailable',false);
$$;
create or replace function private.dashboard_admin_yash_order_source()
returns text language sql immutable set search_path='' as $function$
 select $source$
 select md5(jsonb_build_array('KB','YASH.BET',y.order_type,y.order_no)::text)::uuid as id,
  null::text as system_order_id,y.order_no as order_number,y.supplier_order_no as third_party_order_number,
  y.uid as member_id,private.dashboard_admin_yash_provider(y.supplier) as provider,
  coalesce(nullif(btrim(y.channel),''),'其他类型') as channel_type,
  case y.order_type when 'deposit' then 'charge' else 'withdraw' end as direction,
  y.status,private.dashboard_admin_yash_status(y.order_type,y.status) as status_group,y.created_at,t.success_at,
  case when y.currency is not null then y.amount end as amount,
  case when y.currency is not null then y.credited_amount end as actual_amount,
  case when y.currency is not null then y.fee end as withdraw_fee,y.currency,y.received_at as synced_at,
  null::text as utr,private.dashboard_admin_yash_provider(y.supplier) as raw_provider
 from private.yash_orders y
 cross join lateral(select private.dashboard_admin_yash_completed_at(y.order_type,y.status,y.created_at,y.completed_at,$20) success_at)t
 where $3='IN' and $22='YASH.BET' and y.source_site='yash'
  and y.order_type=any(case $7 when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
  and ((y.created_at >= $5 and y.created_at < $6) or
   (($19='aggregate' or $8='success') and y.completed_at >= $5 and y.completed_at < $6 and t.success_at >= $5 and t.success_at < $6))
  and ($9 is null or y.uid=$9) and ($10 is null or y.order_no=$10)
  and ($23 is null or y.supplier_order_no=$23)
 $source$;
$function$;
create or replace function private.dashboard_admin_yash_day_evidence(p_country text,p_platform text,p_kind text,p_day date)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_start timestamptz;v_end timestamptz;v_count bigint;v_seen timestamptz;v_covered boolean;v_complete boolean;v_progress jsonb;v_type text;
begin
 if p_country is distinct from 'IN' or p_platform is distinct from 'YASH.BET' or p_kind not in('recharge','withdraw') or p_day is null then
  raise exception using errcode='22023',message='invalid_yash_coverage_identity';end if;
 v_type:=case p_kind when 'recharge' then 'deposit' else 'withdrawal' end;
 v_start:=p_day::timestamp at time zone 'Asia/Kolkata';v_end:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';
 select count(*),max(received_at) into v_count,v_seen from private.yash_orders
  where source_site='yash' and order_type=v_type and created_at>=v_start and created_at<v_end;
 select coalesce(range_agg(tstzrange(start_at,end_exclusive,'[)')) @> tstzrange(v_start,v_end,'[)'),false)
 into v_covered from private.yash_sync_windows w
  where order_type=v_type and stream='createTime' and complete
   and source_count=uploaded_count and uploaded_count=stored_count
   and start_at<end_exclusive and isfinite(start_at) and isfinite(end_exclusive)
   and start_at<v_end and end_exclusive>v_start
   and stored_count=(select count(*) from private.yash_orders y where y.source_site='yash' and y.order_type=v_type and y.created_at>=w.start_at and y.created_at<w.end_exclusive);
 select coalesce(jsonb_agg(jsonb_build_object('stream',stream,'startAt',start_at,'endExclusive',end_exclusive,
  'complete',complete,'sourceCount',source_count,'uploadedCount',uploaded_count,'storedCount',stored_count,
  'receivedAt',received_at) order by start_at,stream),'[]'),greatest(v_seen,max(received_at)) into v_progress,v_seen
 from private.yash_sync_windows where order_type=v_type and start_at<v_end and end_exclusive>v_start;
 v_complete:=v_covered and v_end<=date_trunc('day',statement_timestamp() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
 return jsonb_build_object('received',v_count>0 or v_complete,'seen',v_seen,'count',v_count,
  'status',case when v_complete then 'complete' when v_count>0 then 'received' else 'unverified' end,
  'evidence',case when v_complete and v_count=0 then 'yash_created_windows_zero_confirmed'
   when v_complete then 'yash_created_windows_complete' when v_count>0 then 'yash_created_windows_incomplete'
   else 'no_created_orders_received' end,
  'complete',v_complete,'zeroConfirmed',v_complete and v_count=0,'progress',v_progress,'createdCoverageAvailable',true,
  'creationDayWindowCovered',v_covered);
end;
$$;
revoke all on function private.dashboard_admin_yash_status(text,text),private.dashboard_admin_yash_provider(text),
 private.dashboard_admin_yash_completed_at(text,text,timestamptz,timestamptz,timestamptz),
 private.dashboard_admin_yash_capabilities(),private.dashboard_admin_yash_order_source(),
 private.dashboard_admin_yash_day_evidence(text,text,text,date) from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_yash_patch_once(d text,a text,b text)
returns text language plpgsql immutable set search_path='' as $$
begin
 if a='' or (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'yash_live_readers_anchor_drift: %',left(a,100);end if;
 return replace(d,a,b);
end;$$;
revoke all on function private.dashboard_admin_yash_patch_once(text,text,text) from public,anon,authenticated,service_role;
do $patch$
declare p record;d text;old_acl aclitem[];old_owner oid;new_acl aclitem[];new_owner oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_platforms()'::regprocedure;
 if md5(p.prosrc)<>'77425b6523c5f9c7acfbe9be17d3b904' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_platforms';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$;
end;$old$,$new$
 union all
 select md5('kb:IN:YASH.BET')::uuid,coalesce(m.platform_name,'YASH.BET'),m.team_name,'印度'::text,'IN'::text,
  'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text
 from (values(1))s(n)
 left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='KB' and t.country_code='IN' and upper(btrim(t.source_platform))='YASH.BET'
  order by (t.source_country='IN') desc,t.source_country limit 1)m on true
 where private.dashboard_scope_allows(v_scope,'IN','YASH.BET')
;
end;$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_platforms';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'7cf57d520d1a10c326b175c7aa9a8124' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_query_raw';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$v_platform.source not in ('newar','game66','wg')$old$,$new$v_platform.source not in ('newar','game66','wg','kb')$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  elsif v_platform.source='duoli' then
    v_source:=$old$,$new$  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  v_meta:=jsonb_build_object('id',v_platform.id,$old$,$new$  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  v_meta:=jsonb_build_object('id',v_platform.id,$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$case when p->>'source'='duoli' then$old$,$new$case when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_query_raw';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'f43827896041e36555756fe3696582c2' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_drilldown_raw';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$v_platform.source not in ('newar','game66','wg')$old$,$new$v_platform.source not in ('newar','game66','wg','kb')$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  elsif v_platform.source='duoli' then
    v_source:=$old$,$new$  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  v_meta:=jsonb_build_object('id',v_platform.id,$old$,$new$  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  v_meta:=jsonb_build_object('id',v_platform.id,$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$v_platform.source in('lg','wg','duoli')$old$,$new$v_platform.source in('lg','wg','duoli','kb')$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_drilldown_raw';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_analysis_orders_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'668bc22d819a2849f37d4b1d07b8a31e' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_analysis_orders_raw';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$v_platform.source not in ('newar','game66','wg')$old$,$new$v_platform.source not in ('newar','game66','wg','kb')$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  elsif v_platform.source='duoli' then
    v_source:=$old$,$new$  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  v_meta:=jsonb_build_object('id',v_platform.id,$old$,$new$  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  v_meta:=jsonb_build_object('id',v_platform.id,$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$v_platform.source in('lg','wg','duoli')$old$,$new$v_platform.source in('lg','wg','duoli','kb')$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_analysis_orders_raw';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'849c0ed6e607eb7fc8ffb994901d2220' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_provider_options';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$p.source not in('lg','wg','duoli')$old$,$new$p.source not in('lg','wg','duoli','kb')$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$  )
  select jsonb_build_object('providers'$old$,$new$
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,private.dashboard_admin_yash_provider(y.supplier))
    from platforms p join private.yash_orders y on p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
    where y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
  )
  select jsonb_build_object('providers'$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_provider_options';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'fe73441f94e7238e152bd2ac5cb15f2c' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_expand_provider_filter';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$  if v_platform.source='duoli' then$old$,$new$  if v_platform.source='kb' then
    with names as materialized (
     select distinct private.dashboard_admin_yash_provider(y.supplier) provider
     from private.yash_orders y where v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and y.source_site='yash'
      and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    ), matches as (
     select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='duoli' then$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_expand_provider_filter';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_order_intake()'::regprocedure;
 if md5(p.prosrc)<>'c374cbc2fb002383e5e17ffa45d9ce96' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_order_intake';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$   elsif p.source='duoli' then$old$,$new$   elsif p.source='kb' then
    select max(y.created_at),max(y.received_at) into v_created,v_updated from private.yash_orders y
     where p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
      and y.order_type=case d when 'charge' then 'deposit' else 'withdrawal' end;
    select greatest(v_updated,max(w.received_at)) into v_updated from private.yash_sync_windows w
     where w.order_type=case d when 'charge' then 'deposit' else 'withdrawal' end;
    v_found:=v_created is not null or v_updated is not null;
   elsif p.source='duoli' then$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_order_intake';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'ec3facabe26e034f5c6e71c384506d3d' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_intake_coverage';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$    if dataset='orders' and source_system='duoli' then$old$,$new$    if dataset='orders' and source_system='kb' then
     select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     complete:=(v_run.value->>'complete')::boolean;zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='duoli' then$new$);
 d:=private.dashboard_admin_yash_patch_once(d,$old$when dataset='orders' and source_system='duoli' then jsonb_build_object('sourceWindowCoverage'$old$,$new$when dataset='orders' and source_system in('duoli','kb') then jsonb_build_object('sourceWindowCoverage'$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_intake_coverage';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_member_daily(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'477dc1efd988b2985032974976299ce5' or not p.prosecdef or p.provolatile<>'s' or not('search_path=""'=any(p.proconfig)) or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'yash_live_readers_contract_drift: dashboard_admin_live_member_daily';end if;
 d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
 d:=private.dashboard_admin_yash_patch_once(d,$old$    elsif v_platform.source='game66' then$old$,$new$    elsif v_platform.source='kb' then
      v_axis:=case v_basis when 'created' then 'created_at' else 'completed_at' end;
      v_source:=replace(replace(replace($q$
       select '$basis$'::text basis,y.$axis$ event_at,
        case y.order_type when 'deposit' then 'charge' else 'withdraw' end direction,
        y.uid member_id,private.dashboard_admin_yash_provider(y.supplier) provider,y.currency
       from private.yash_orders y where $2='IN' and $3='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case $6 when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
        and y.$axis$ >= $5 and y.$axis$ < $11 $success$
       $q$,'$basis$',v_basis),'$axis$',v_axis),'$success$',case when v_basis='success' then
        'and private.dashboard_admin_yash_completed_at(y.order_type,y.status,y.created_at,y.completed_at,statement_timestamp()) is not null' else '' end);
    elsif v_platform.source='game66' then$new$);
 execute d;
 select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
 if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'yash_live_readers_acl_changed: dashboard_admin_live_member_daily';end if;
end;$patch$;
drop function private.dashboard_admin_yash_patch_once(text,text,text);
notify pgrst,'reload schema';
commit;
