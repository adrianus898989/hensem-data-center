CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_options(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_result jsonb; v_scope jsonb:=private.dashboard_admin_live_scope();
begin
 -- duoli_existing_orders_v1
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
    where p.source not in('lg','wg','duoli','kb','panda') and private.dashboard_scope_allows(v_scope,r.country,r.platform)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
  ), name_sets as materialized (
    select distinct country,canonical_values from scoped
  ), names as materialized (
    select country,canonical_values,private.dashboard_admin_live_provider_alias_values(country,canonical_values) as names from name_sets
  ), matches as (
    select distinct coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),
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
  ), yash_names as materialized (
    select p.country,p.source_name,n.supplier
    from platforms p cross join lateral (
      select distinct y.supplier
      from private.yash_orders y
      where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    )n
  ), panda_names as materialized (
    select p.country,p.source_name,n.provider from platforms p
    cross join lateral private.dashboard_admin_panda_provider_names(p.source_name,coalesce(p_request->>'direction','all'))n
    where p.source='panda'
  ), all_matches as (
    -- User-confirmed WG business category; offering a filter does not invent a count.
    select '提现转充值'::text as provider from platforms p
    where p.source='wg' and coalesce(p_request->>'direction','all') in ('all','charge')
    union
    select provider from matches union
    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) from lg_names
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p join private.dashboard_admin_wg_sites()s on p.source='wg' and p.scope_group=s.country_code and p.source_name=s.platform
    cross join lateral (
      select provider from private.dashboard_admin_wg_provider_names(
        s.country_code,s.platform,coalesce(p_request->>'direction','all'))
    )n
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p cross join lateral (
     select distinct private.dashboard_admin_duoli_provider(d.provider_code) provider
     from private.duoli_order_details d where p.source='duoli' and p.scope_group='ID' and d.country='ID' and d.system_name='DOLI' and d.platform=p.source_name
      and d.business=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    )n

    union
    select private.dashboard_admin_live_provider_canonical(country,source_name,private.dashboard_admin_yash_provider(supplier))
    from yash_names
    union
    -- The order supplier directory remains unchanged. Add the confirmed channel
    -- identity from the small retained source channel catalog, never a second
    -- historical orders scan or a per-order canonical lookup.
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,'UPI-QR')
    from platforms p cross join lateral (
      select true as matched from private.yash_channels c
      where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET'
        and btrim(c.provider)='ArbPay'
        and ((c.order_type='deposit' and btrim(c.channel_name)='Phonepe_QR')
          or (c.order_type='withdrawal' and btrim(c.channel_name)='Arb-BANK'))
        and c.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
      limit 1
    ) channel_match
    union
    select private.dashboard_admin_live_provider_canonical(country,source_name,provider) from panda_names
  )
  select jsonb_build_object('providers',coalesce((select jsonb_agg(provider order by provider) from all_matches),'[]'::jsonb),
    'platformCount',(select count(*) from platforms),'basis','existing_classification') into v_result;
  return v_result;
end;
$function$
