-- Read-only production function definition; no business records or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_options(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_result jsonb; v_scope jsonb:=private.dashboard_admin_live_scope();
begin
 -- wg_existing_orders_v1
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request-array['platformIds','direction']<>'{}'::jsonb
    or jsonb_typeof(p_request->'platformIds') is distinct from 'array' or jsonb_array_length(p_request->'platformIds')>200
    or coalesce(p_request->>'direction','all') not in('all','charge','withdraw') then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_array_elements(p_request->'platformIds') a where jsonb_typeof(a)<>'string'
    or a#>>'{}' !~ '^[0-9a-fA-F-]{36}$') then raise exception using errcode='22023',message='invalid_filter';end if;
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_request->'platformIds');
  with platforms as materialized (select * from private.dashboard_admin_live_platforms() where id=any(v_ids)),
  scoped as materialized (
    select distinct r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r join platforms p on r.country=p.country and (r.platform=p.name or r.platform=p.source_name)
    where p.source not in('lg','wg') and private.dashboard_scope_allows(v_scope,r.country,r.platform)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
  ), name_sets as materialized (
    select distinct country,canonical_values from scoped
  ), names as materialized (
    select country,canonical_values,private.dashboard_admin_live_provider_alias_values(country,canonical_values) as names from name_sets
  ), matches as (
    select distinct coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider),
      case when cardinality(n.names)=1 then n.names[1] end,
      nullif(private.dashboard_admin_live_provider_alias(r.country,r.raw_provider),''),'未识别通道') as provider
    from scoped r join names n on n.country=r.country and n.canonical_values=r.canonical_values
    left join private.dashboard_admin_provider_overrides o on o.country=r.country and o.platform=r.platform and o.raw_provider=r.raw_provider
  ), lg_names as materialized (
    -- Provider names come from the collector's small classifications, never a
    -- whole-order scan. Values match the native LG provider projection.
    select distinct p.country,p.source_name,
      coalesce(nullif(btrim(d.third_party),''),nullif(btrim(d.raw_channel),''),'未识别通道') as raw_provider
    from platforms p join public.lg_success_daily d
      on p.source='lg' and d.country_code=p.scope_group and d.platform=p.source_name
    where d.scope_type in ('third_party','channel')
      and d.order_kind=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
  ), all_matches as (
    select provider from matches union
    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) from lg_names
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p join private.dashboard_admin_wg_sites()s on p.source='wg' and p.scope_group=s.country_code and p.source_name=s.platform
    cross join lateral (
      select distinct coalesce(nullif(btrim(provider),''),'未识别通道') provider from public.wg_recharge_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','charge')
      union select distinct coalesce(nullif(btrim(provider),''),'未识别通道') from public.wg_withdraw_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','withdraw')
    )n
  )
  select jsonb_build_object('providers',coalesce((select jsonb_agg(provider order by provider) from all_matches),'[]'::jsonb),
    'platformCount',(select count(*) from platforms),'basis','existing_classification') into v_result;
  return v_result;
end;
$function$
