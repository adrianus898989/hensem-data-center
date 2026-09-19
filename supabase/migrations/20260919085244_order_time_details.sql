-- Replace, rather than overload, the previously deployed seven-argument RPC.
-- PostgREST must see one unambiguous callable signature.
-- Keep ongoing collector writes unblocked: reuse existing platform/time indexes.
-- Evaluate identifier indexes separately with EXPLAIN and a concurrent build
-- plan; never add blocking index creation to this function-only rollout.
drop function if exists public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz);
drop function if exists private.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz);

create or replace function private.dashboard_order_time_query(
  p_platform uuid default null, p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null,
  p_member_id text default null, p_order_number text default null,
  p_status text default 'all', p_cross_day_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb;
  v_platform public.game66_platforms%rowtype;
  v_options jsonb;
  v_rows jsonb;
  v_charge_axis text;
  v_withdraw_axis text;
  v_member_id text := nullif(btrim(p_member_id),'');
  v_order_number text := nullif(btrim(p_order_number),'');
begin
  if (select auth.uid()) is null then
    raise exception using errcode='28000', message='请先登录';
  end if;
  if not public.dashboard_has_permission('third_party') then
    raise exception using errcode='42501', message='没有三方查询权限';
  end if;
  v_scope := private.dashboard_current_data_scope();
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.platform_name,'team',g.team_name)
           order by g.team_name,g.platform_name), '[]'::jsonb) into v_options
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    g.platform_name);
  if p_platform is null then
    return jsonb_build_object('platforms',v_options,'rows','[]'::jsonb,'timezone','Asia/Kolkata');
  end if;
  select * into v_platform from public.game66_platforms g where g.id=p_platform
    and private.dashboard_scope_allows(v_scope,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
      g.platform_name);
  if not found then raise exception using errcode='42501',message='无权查看此平台'; end if;
  if p_basis is null or p_basis not in ('created','success') or p_direction is null or p_direction not in ('all','charge','withdraw')
    or p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
    or p_start_at >= p_end_at or p_end_at-p_start_at > interval '31 days'
    or (p_created_start is not null and not isfinite(p_created_start))
    or (p_created_end is not null and not isfinite(p_created_end))
    or (p_created_start is not null and p_created_end is not null and p_created_start >= p_created_end)
    or (p_basis='created' and (p_created_start is not null or p_created_end is not null))
    or p_status is null or p_status not in ('all','success','pending','failed','rejected','unknown')
    or p_cross_day_only is null or length(v_member_id)>200 or length(v_order_number)>200 then
    raise exception using errcode='22023',message='时间范围无效；一次查询最多31天';
  end if;
  v_charge_axis := case when p_basis='created' then 'create_time' else 'pay_time' end;
  v_withdraw_axis := case when p_basis='created' then 'create_time' else 'update_time' end;
  -- Only the two whitelisted identifiers above are interpolated. Values bind
  -- separately so each request gets an indexed platform/time plan.
  execute format($query$
    with orders as (
      select 'charge'::text as direction,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider, coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        c.status_code='0' as pending,
        case c.status_code when '1' then 'success' when '0' then 'pending' else 'unknown' end as status_group,
        c.create_time, case when c.status_code='1' then c.pay_time end as success_time,
        c.status_code='1' as succeeded,
        coalesce(c.amount_display,c.amount_minor/100.0,0) as amount,
        0::numeric as actual, 0::numeric as fee, c.last_seen_at
      from public.game66_charge_orders c
      where c.platform_id=$1 and $4 in ('all','charge') and c.%I >= $2 and c.%I < $3
        and ($5='created' or c.status_code='1')
        and ($6 is null or c.create_time >= $6) and ($7 is null or c.create_time < $7)
        and ($8 is null or c.uid=$8) and ($9 is null or c.order_num=$9 or c.out_trade_no=$9)
      union all
      select 'withdraw', coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道'), coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),
        w.status_code='1',
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then 'failed' when '-1' then 'rejected' else 'unknown' end,
        w.create_time, case when w.status_code='3' then w.update_time end,
        w.status_code='3',coalesce(w.amount_display,w.amount_minor/100.0,0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0,0),
        coalesce(w.fee_display,w.fee_minor/100.0,0),w.last_seen_at
      from public.game66_withdraw_orders w
      where w.platform_id=$1 and $4 in ('all','withdraw') and w.%I >= $2 and w.%I < $3
        and ($5='created' or w.status_code='3')
        and ($6 is null or w.create_time >= $6) and ($7 is null or w.create_time < $7)
        and ($8 is null or w.uid=$8) and ($9 is null or w.order_num=$9 or w.out_trade_no=$9)
    ), cohorts as (
      select direction,provider,channel_type,
        (create_time at time zone 'Asia/Kolkata')::date as created_date,
        (success_time at time zone 'Asia/Kolkata')::date as success_date,
        count(*) as submitted_count,sum(amount) as submitted_amount,
        count(*) filter(where pending) as pending_count, coalesce(sum(amount) filter(where pending),0) as pending_amount,
        count(*) filter(where succeeded) as success_count,
        coalesce(sum(amount) filter(where succeeded),0) as success_amount,
        coalesce(sum(actual) filter(where succeeded),0) as actual_amount,
        coalesce(sum(fee) filter(where succeeded),0) as withdraw_fee,
        count(*) filter(where succeeded and (create_time at time zone 'Asia/Kolkata')::date < (success_time at time zone 'Asia/Kolkata')::date) as cross_day_count,
        coalesce(sum(amount) filter(where succeeded and (create_time at time zone 'Asia/Kolkata')::date < (success_time at time zone 'Asia/Kolkata')::date),0) as cross_day_amount,
        count(*) filter(where succeeded and create_time < $2) as earlier_count,
        coalesce(sum(amount) filter(where succeeded and create_time < $2),0) as earlier_amount,
        count(*) filter(where succeeded and success_time is null) as missing_success_time_count,
        min(create_time) as first_created_at,max(create_time) as last_created_at,
        min(success_time) as first_success_at,max(success_time) as last_success_at,
        max(last_seen_at) as last_synced_at
      from orders
      where ($10='all' or status_group=$10)
        and (not $11 or (succeeded and (create_time at time zone 'Asia/Kolkata')::date < (success_time at time zone 'Asia/Kolkata')::date))
      group by 1,2,3,4,5
    ) select coalesce(jsonb_agg(to_jsonb(cohorts) order by direction,provider,created_date,success_date),'[]'::jsonb) from cohorts
  $query$,v_charge_axis,v_charge_axis,v_withdraw_axis,v_withdraw_axis)
  into v_rows using p_platform,p_start_at,p_end_at,p_direction,p_basis,p_created_start,p_created_end,
    v_member_id,v_order_number,p_status,p_cross_day_only;
  return jsonb_build_object('platforms',v_options,'platform',v_platform.platform_name,'team',v_platform.team_name,
    'timezone','Asia/Kolkata','basis',p_basis,'start',p_start_at,'endExclusive',p_end_at,'rows',v_rows);
end;
$$;

create or replace function public.dashboard_order_time_query(
  p_platform uuid default null, p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null,
  p_member_id text default null, p_order_number text default null,
  p_status text default 'all', p_cross_day_only boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_order_time_query(p_platform,p_start_at,p_end_at,p_basis,p_direction,p_created_start,p_created_end,p_member_id,p_order_number,p_status,p_cross_day_only);
$$;
revoke all on function private.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,text,text,boolean) from public,anon;
revoke all on function public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,text,text,boolean) from public,anon;
grant execute on function private.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,text,text,boolean) to authenticated;
grant execute on function public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,text,text,boolean) to authenticated;
notify pgrst,'reload schema';

-- Order-level drilldown exposes the requested member/order identifiers, but
-- never bank accounts, phone numbers, raw payloads or login material.
-- Platform permissions are rechecked on every page.
create or replace function private.dashboard_order_time_details(
  p_platform uuid, p_start_at timestamptz, p_end_at timestamptz,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null,
  p_providers text[] default null, p_types text[] default null,
  p_cursor jsonb default null, p_limit integer default 50,
  p_member_id text default null, p_order_number text default null,
  p_status text default 'all', p_cross_day_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb; v_platform public.game66_platforms%rowtype;
  v_charge_axis text; v_withdraw_axis text; v_rows jsonb; v_more boolean;
  v_member_id text := nullif(btrim(p_member_id),'');
  v_order_number text := nullif(btrim(p_order_number),'');
  v_cursor_at timestamptz; v_cursor_id uuid;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  if not public.dashboard_has_permission('third_party') then raise exception using errcode='42501',message='没有三方查询权限'; end if;
  v_scope := private.dashboard_current_data_scope();
  select * into v_platform from public.game66_platforms g where g.id=p_platform
    and private.dashboard_scope_allows(v_scope,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name);
  if not found then raise exception using errcode='42501',message='无权查看此平台'; end if;
  if p_basis is null or p_basis not in ('created','success') or p_direction is null or p_direction not in ('all','charge','withdraw')
    or p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
    or p_start_at >= p_end_at or p_end_at-p_start_at > interval '31 days'
    or (p_created_start is not null and not isfinite(p_created_start))
    or (p_created_end is not null and not isfinite(p_created_end))
    or (p_created_start is not null and p_created_end is not null and p_created_start >= p_created_end)
    or (p_basis='created' and (p_created_start is not null or p_created_end is not null))
    or p_limit is null or p_limit not between 1 and 200
    or p_status is null or p_status not in ('all','success','pending','failed','rejected','unknown')
    or p_cross_day_only is null or length(v_member_id)>200 or length(v_order_number)>200 then
    raise exception using errcode='22023',message='无效查询条件';
  end if;
  if p_cursor is not null then
    begin
      v_cursor_at := (p_cursor->>'at')::timestamptz;
      v_cursor_id := (p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='无效分页位置';
    end;
    if not isfinite(v_cursor_at) then raise exception using errcode='22023',message='无效分页位置'; end if;
  end if;
  if p_cursor is not null and (jsonb_typeof(p_cursor) <> 'object'
    or not (p_cursor ?& array['at','direction','id'])
    or p_cursor->>'at' is null or p_cursor->>'id' is null
    or p_cursor->>'direction' is null or p_cursor->>'direction' not in ('charge','withdraw')) then
    raise exception using errcode='22023',message='无效分页位置';
  end if;
  v_charge_axis := case when p_basis='created' then 'create_time' else 'pay_time' end;
  v_withdraw_axis := case when p_basis='created' then 'create_time' else 'update_time' end;
  execute format($query$
    with orders as (
      select c.id,c.%I as axis,'charge'::text as direction,c.order_num as order_number,
        c.uid as member_id,c.out_trade_no as third_party_order_number,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,
        coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        coalesce(nullif(c.status_text,''),c.status_code) as status,
        c.status_code,
        case c.status_code when '1' then 'success' when '0' then 'pending' else 'unknown' end as status_group,
        c.status_code='1' as succeeded,c.create_time as created_at,
        case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0,0) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,c.last_seen_at as synced_at
      from public.game66_charge_orders c
      where c.platform_id=$1 and $4 in ('all','charge') and c.%I >= $2 and c.%I < $3
        and ($5='created' or c.status_code='1')
        and ($6 is null or c.create_time >= $6) and ($7 is null or c.create_time < $7)
        and ($12 is null or c.uid=$12) and ($13 is null or c.order_num=$13 or c.out_trade_no=$13)
      union all
      select w.id,w.%I,'withdraw',w.order_num,w.uid,w.out_trade_no,
        coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道'),
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),
        coalesce(nullif(w.status_text,''),w.status_code),w.status_code,
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then 'failed' when '-1' then 'rejected' else 'unknown' end,
        w.status_code='3',w.create_time,
        case when w.status_code='3' then w.update_time end,
        coalesce(w.amount_display,w.amount_minor/100.0,0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0,0),coalesce(w.fee_display,w.fee_minor/100.0,0),w.last_seen_at
      from public.game66_withdraw_orders w
      where w.platform_id=$1 and $4 in ('all','withdraw') and w.%I >= $2 and w.%I < $3
        and ($5='created' or w.status_code='3')
        and ($6 is null or w.create_time >= $6) and ($7 is null or w.create_time < $7)
        and ($12 is null or w.uid=$12) and ($13 is null or w.order_num=$13 or w.out_trade_no=$13)
    ), page as (
      select *, coalesce((created_at at time zone 'Asia/Kolkata')::date < (success_at at time zone 'Asia/Kolkata')::date,false) as cross_day
      from orders where ($8 is null or provider=any($8)) and ($9 is null or channel_type=any($9))
        and ($14='all' or status_group=$14)
        and (not $15 or (succeeded and (created_at at time zone 'Asia/Kolkata')::date < (success_at at time zone 'Asia/Kolkata')::date))
        and ($10 is null or (axis,direction,id) < (($10->>'at')::timestamptz,$10->>'direction',($10->>'id')::uuid))
      order by axis desc,direction desc,id desc limit $11+1
    ) select coalesce(jsonb_agg(to_jsonb(page) order by axis desc,direction desc,id desc),'[]'::jsonb) from page
  $query$,v_charge_axis,v_charge_axis,v_charge_axis,v_withdraw_axis,v_withdraw_axis,v_withdraw_axis)
  into v_rows using p_platform,p_start_at,p_end_at,p_direction,p_basis,p_created_start,p_created_end,p_providers,p_types,p_cursor,p_limit,
    v_member_id,v_order_number,p_status,p_cross_day_only;
  v_more := jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows := v_rows-p_limit; end if;
  return jsonb_build_object('rows',v_rows,'hasMore',v_more,
    'nextCursor',case when v_more then jsonb_build_object('at',v_rows->-1->'axis','direction',v_rows->-1->'direction','id',v_rows->-1->'id') end,
    'platform',v_platform.platform_name,'timezone','Asia/Kolkata');
end;
$$;
create or replace function public.dashboard_order_time_details(
  p_platform uuid, p_start_at timestamptz, p_end_at timestamptz,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null,
  p_providers text[] default null, p_types text[] default null,
  p_cursor jsonb default null, p_limit integer default 50,
  p_member_id text default null, p_order_number text default null,
  p_status text default 'all', p_cross_day_only boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_order_time_details(p_platform,p_start_at,p_end_at,p_basis,p_direction,p_created_start,p_created_end,p_providers,p_types,p_cursor,p_limit,p_member_id,p_order_number,p_status,p_cross_day_only);
$$;
revoke all on function private.dashboard_order_time_details(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean) from public,anon;
revoke all on function public.dashboard_order_time_details(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean) from public,anon;
grant execute on function private.dashboard_order_time_details(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean) to authenticated;
grant execute on function public.dashboard_order_time_details(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
