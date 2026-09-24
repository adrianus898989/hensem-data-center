-- Include the authoritative team / package-system mapping in the private
-- catalog used by the new admin filters. Legacy pages do not call this RPC.
begin;

create or replace function private.dashboard_admin_live_platforms()
returns table(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb := private.dashboard_admin_live_scope();
begin
  return query
  select g.id,g.platform_name,g.team_name,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select md5('ar:'||t.country_code||':'||t.platform)::uuid,t.platform,
    m.team_name,t.country_name,t.country_code,
    'ar'::text,t.timezone,coalesce(t.currency,case when t.country_code='IN' then 'INR' end),src.platform
  from public.ar_config_targets t
  cross join lateral (select case when t.country_code='IN' and t.platform='SHREEWIN'
    and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
      and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
    then 'Shree.Win' else t.platform end as platform) src
  left join public.dashboard_platform_team_map m on m.active and m.source_system='AR'
    and (m.source_country=t.country_name or m.source_country=t.country_code)
    and m.source_platform=src.platform
  where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
    and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
      where n.platform=t.platform and n.country_code=t.country_code and n.enabled
        and (n.launch_at is null or n.launch_at<=now())
        and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
          and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0))
    and exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
      and a.platform=src.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,n.platform,
    m.team_name,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and m.source_platform=n.platform
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
    and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
      and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0);
end;
$$;
revoke all on function private.dashboard_admin_live_platforms() from public,anon;
grant execute on function private.dashboard_admin_live_platforms() to authenticated;
notify pgrst,'reload schema';
commit;
