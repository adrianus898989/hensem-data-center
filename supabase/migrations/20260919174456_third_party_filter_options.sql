-- Read-only filter metadata. Only catalog names and indexed country/platform
-- keys are read; no order, amount, snapshot, credential or URL is exposed.
begin;

create function private.dashboard_third_party_filter_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb;
  v_platforms jsonb;
  v_legacy_overflow boolean;
begin
  if (select auth.uid()) is null then
    raise exception using errcode='28000',message='请先登录';
  end if;
  if public.dashboard_has_permission('third_party') is not true then
    raise exception using errcode='42501',message='没有查询权限';
  end if;
  v_scope := private.dashboard_current_data_scope();

  -- The legacy importer has no independent platform registry. Seek one
  -- country/platform key at a time using idx_tpv_country_platform_date.
  -- This loose index scan preserves legacy-only platforms (including NPG)
  -- without scanning or returning the historical volume rows.
  -- Materialize the small distinct metadata set before scope functions, so
  -- fee-matrix cells do not repeatedly evaluate the same platform permissions.
  with recursive legacy_platforms(country,platform,step) as (
    (select country,platform,1 from public.third_party_volume
      where country is not null and platform is not null
      order by country,platform limit 1)
    union all
    select next.country,next.platform,previous.step+1
    from legacy_platforms previous
    cross join lateral (
      select country,platform from public.third_party_volume
      where (country,platform) > (previous.country,previous.platform)
        and country is not null and platform is not null
      order by country,platform limit 1
    ) next where previous.step<10001
  ), catalog as materialized (
    select country,platform from legacy_platforms
    union all
    select country_name as country,platform from public.ar_config_targets
    union all
    select country_name,platform from public.panda_config_targets
    union all
    select country_name,platform from public.wg_config_targets
    union all
    select target.country_name,member.value->>'name'
      from public.wg_config_targets target
      cross join lateral pg_catalog.jsonb_array_elements(target.members) member(value)
    union all
    select country,platform from public.newar_detail_platforms
    union all
    -- enabled controls upstream collection, NOT permission to query history.
    select case team_code when 'hong_kong' then '香港' when 'red_crab' then '红膏蟹' end,
      platform_name from public.game66_platforms
      where team_code in ('hong_kong','red_crab')
    union all
    -- This is the small current fee/status matrix, not historic transaction data.
    -- Its existing (country,platform,third_party) index covers the two keys.
    select distinct country,platform from public.third_party_platform_status
  ), normalized as materialized (
    select private.dashboard_data_group(country,platform) as group_key,
      pg_catalog.btrim(platform) as platform
    from catalog
    where pg_catalog.length(pg_catalog.btrim(platform)) between 1 and 120
      and platform !~ '[[:cntrl:]]'
  ), visible as (
    select distinct
      case group_key
        when 'BR' then '巴西' when 'BR_PANGHU' then '胖虎巴西'
        when 'IN' then '印度' when 'PK' then '巴基斯坦' when 'ID' then '印尼'
        when 'VN' then '越南' when 'PH' then '菲律宾' when 'MY' then '马来'
        when 'MM' then '缅甸' when 'NG' then '尼日利亚'
        when 'CO' then '哥伦比亚' when 'MX' then '墨西哥' when 'CL' then '智利'
        when 'SA' then '南美' when 'BR_NATIVE' then '巴西原生' when 'USDT' then 'USDT通道'
        when 'HK_TEAM' then '香港' when 'RED_CRAB' then '红膏蟹'
      end as country,platform
    from normalized
    where group_key <> '' and private.dashboard_scope_allows(v_scope,group_key,platform)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'country',country,'platform',platform
  ) order by country,platform),'[]'::jsonb),
    exists(select 1 from legacy_platforms where step>10000)
  into v_platforms,v_legacy_overflow from visible;
  if v_legacy_overflow then
    raise exception using errcode='54000',message='平台目录超出安全上限';
  end if;
  return pg_catalog.jsonb_build_object('platforms',v_platforms);
end;
$$;

create function public.dashboard_third_party_filter_options()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_third_party_filter_options()
$$;
-- private USAGE for authenticated is already provided by account data scope.
-- Do not change existing table access/module policies just to read the catalog.
revoke all on function private.dashboard_third_party_filter_options(),
  public.dashboard_third_party_filter_options() from public,anon,authenticated,service_role;
grant execute on function private.dashboard_third_party_filter_options(),
  public.dashboard_third_party_filter_options() to authenticated;
commit;
