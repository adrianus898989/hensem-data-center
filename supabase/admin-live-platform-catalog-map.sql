-- Include the authoritative team / package-system mapping in the private
-- catalog used by the new admin filters. Legacy pages do not call this RPC.
-- AR rows are catalogued from Supabase configuration and the active mapping:
-- a configured platform remains visible when it has no orders yet, and an
-- active mapping can supply a catalog row when the collector has not created
-- its config row yet. No source data is copied or rewritten.
begin;

create or replace function private.dashboard_admin_live_platforms()
returns table(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb := private.dashboard_admin_live_scope();
begin
  return query
  with ar_targets as (
    select md5('ar:'||t.country_code||':'||src.platform)::uuid as id,
      coalesce(m.platform_name,t.platform)::text as name,
      m.team_name::text as team,t.country_name::text as country,t.country_code::text as scope_group,
      'ar'::text as source,
      coalesce(nullif(t.timezone,''),case t.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end)::text as timezone,
      coalesce(nullif(t.currency,''),case t.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end)::text as currency,
      src.platform::text as source_name
    from public.ar_config_targets t
    cross join lateral (
      select case when t.country_code='IN' and upper(btrim(t.platform))='SHREEWIN'
        and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
          and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
        then 'Shree.Win' else t.platform end as platform
    ) src
    left join public.dashboard_platform_team_map m on m.active and m.source_system='AR'
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now())
          and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
            and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0))
  ),
  ar_mapped_only as (
    select md5('ar:'||m.country_code||':'||m.source_platform)::uuid as id,
      m.platform_name::text as name,m.team_name::text as team,m.country_name::text as country,
      m.country_code::text as scope_group,'ar'::text as source,
      case m.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end::text as timezone,
      case m.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end::text as currency,
      m.source_platform::text as source_name
    from public.dashboard_platform_team_map m
    where m.active and m.source_system='AR'
      and private.dashboard_scope_allows(v_scope,m.country_code,m.source_platform)
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform))
          and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
            where n.platform=t.platform and n.country_code=t.country_code and n.enabled
              and (n.launch_at is null or n.launch_at<=now())
              and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
                and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0)))
  )
  select g.id,g.platform_name,g.team_name,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select ar_targets.id,ar_targets.name,ar_targets.team,ar_targets.country,ar_targets.scope_group,ar_targets.source,ar_targets.timezone,ar_targets.currency,ar_targets.source_name from ar_targets
  union all
  select ar_mapped_only.id,ar_mapped_only.name,ar_mapped_only.team,ar_mapped_only.country,ar_mapped_only.scope_group,ar_mapped_only.source,ar_mapped_only.timezone,ar_mapped_only.currency,ar_mapped_only.source_name from ar_mapped_only
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,
    coalesce(m.platform_name,n.platform),m.team_name,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and upper(btrim(m.source_platform))=upper(btrim(n.platform))
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
