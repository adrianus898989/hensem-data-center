-- Applied migration version: 20260919083628.
-- Timestamp queries use source instants, with calendar labels in India time.
-- No order mutation/backfill: existing pay_time/update_time are retained.
create index if not exists game66_charge_success_time_idx
  on public.game66_charge_orders(platform_id, pay_time) where status_code = '1';
create index if not exists game66_withdraw_success_time_idx
  on public.game66_withdraw_orders(platform_id, update_time) where status_code = '3';

create or replace function private.dashboard_order_time_query(
  p_platform uuid default null, p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb;
  v_platform public.game66_platforms%rowtype;
  v_options jsonb;
  v_rows jsonb;
  v_charge_axis text;
  v_withdraw_axis text;
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
    or (p_basis='created' and (p_created_start is not null or p_created_end is not null)) then
    raise exception using errcode='22023',message='时间范围无效；一次查询最多31天';
  end if;
  v_charge_axis := case when p_basis='created' then 'create_time' else 'pay_time' end;
  v_withdraw_axis := case when p_basis='created' then 'create_time' else 'update_time' end;
  -- Only the two whitelisted identifiers above are interpolated. Values bind
  -- separately so each request gets an indexed platform/time plan.
  execute format($query$
    with orders as (
      select 'charge'::text as direction,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,
        c.create_time, case when c.status_code='1' then c.pay_time end as success_time,
        c.status_code='1' as succeeded,
        coalesce(c.amount_display,c.amount_minor/100.0,0) as amount,
        0::numeric as actual, 0::numeric as fee, c.last_seen_at
      from public.game66_charge_orders c
      where c.platform_id=$1 and $4 in ('all','charge') and c.%I >= $2 and c.%I < $3
        and ($5='created' or c.status_code='1')
        and ($6 is null or c.create_time >= $6) and ($7 is null or c.create_time < $7)
      union all
      select 'withdraw', coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道'),
        w.create_time, case when w.status_code='3' then w.update_time end,
        w.status_code='3',coalesce(w.amount_display,w.amount_minor/100.0,0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0,0),
        coalesce(w.fee_display,w.fee_minor/100.0,0),w.last_seen_at
      from public.game66_withdraw_orders w
      where w.platform_id=$1 and $4 in ('all','withdraw') and w.%I >= $2 and w.%I < $3
        and ($5='created' or w.status_code='3')
        and ($6 is null or w.create_time >= $6) and ($7 is null or w.create_time < $7)
    ), cohorts as (
      select direction,provider,
        (create_time at time zone 'Asia/Kolkata')::date as created_date,
        (success_time at time zone 'Asia/Kolkata')::date as success_date,
        count(*) as submitted_count,sum(amount) as submitted_amount,
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
      from orders group by 1,2,3,4
    ) select coalesce(jsonb_agg(to_jsonb(cohorts) order by direction,provider,created_date,success_date),'[]'::jsonb) from cohorts
  $query$,v_charge_axis,v_charge_axis,v_withdraw_axis,v_withdraw_axis)
  into v_rows using p_platform,p_start_at,p_end_at,p_direction,p_basis,p_created_start,p_created_end;
  return jsonb_build_object('platforms',v_options,'platform',v_platform.platform_name,'team',v_platform.team_name,
    'timezone','Asia/Kolkata','basis',p_basis,'start',p_start_at,'endExclusive',p_end_at,'rows',v_rows);
end;
$$;

create or replace function public.dashboard_order_time_query(
  p_platform uuid default null, p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_basis text default 'created', p_direction text default 'all',
  p_created_start timestamptz default null, p_created_end timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_order_time_query(p_platform,p_start_at,p_end_at,p_basis,p_direction,p_created_start,p_created_end);
$$;
revoke all on function private.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz) from public,anon;
revoke all on function public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz) from public,anon;
grant execute on function private.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
