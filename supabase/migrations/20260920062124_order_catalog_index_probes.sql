-- Keep catalog availability checks as parameterized first-match index probes.
-- Production EXPLAIN (2026-09-20) showed the equivalent pull-up semi-join
-- scanning 1,473,171 AR orders and hash-aggregating every platform: 8,685 ms.
-- OFFSET 0 is an intentional optimizer fence here, not row pagination. The
-- equivalent correlated plan probed 44 registry targets in 41 ms instead.
-- No cache, index, data write, RPC signature or statistical rule is changed.
create or replace function private.dashboard_uploaded_order_platforms()
returns table(id uuid,name text,team text,country text,country_code text,source text,timezone text,currency text)
language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  if public.dashboard_has_permission('third_party') is not true then
    raise exception using errcode='42501',message='没有三方查询权限';
  end if;
  v_scope:=private.dashboard_current_data_scope();
  return query
  select g.id,g.platform_name,g.team_name,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select md5('ar:'||t.country_code||':'||t.platform)::uuid,t.platform,t.country_name,t.country_name,
    t.country_code,'ar'::text,t.timezone,t.currency
  from public.ar_config_targets t
  where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
    and not (t.source_system='NEW_AR' and exists(
      select 1 from public.newar_detail_platforms n
      where n.platform=t.platform and n.country_code=t.country_code and n.enabled
        and (n.launch_at is null or n.launch_at<=now())
        and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
          and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0)
      offset 0))
    and exists(select 1 from public.ar_collected_orders a
      where a.country_code=t.country_code and a.platform=t.platform and a.source_system='AR'
        and a.order_kind in ('recharge','withdraw') offset 0)
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,n.platform,n.country,n.country,
    n.country_code,'newar'::text,n.timezone,n.currency
  from public.newar_detail_platforms n
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
    and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
      and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0);
end;
$$;
revoke all on function private.dashboard_uploaded_order_platforms() from public,anon,authenticated;
notify pgrst,'reload schema';
