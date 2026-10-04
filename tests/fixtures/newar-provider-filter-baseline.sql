-- Exact reviewed production expander baseline; no business records or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_expand_provider_filter(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_platform record;
  v_scope jsonb;
  v_selected text[];
  v_raw text[];
begin
 -- wg_existing_orders_v1
  -- A missing key has SQL NULL type, so `type <> 'array'` alone does not return.
  -- All-provider queries must not normalize the entire provider directory.
  if p_request is null or coalesce(jsonb_typeof(p_request->'providers'),'null')<>'array' then
    return p_request;
  end if;
  if jsonb_array_length(p_request->'providers')=0 then return p_request; end if;
  if jsonb_array_length(p_request->'providers')>200 or exists(
    select 1 from jsonb_array_elements(p_request->'providers') a
    where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 200
      or (a#>>'{}') ~ '[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='invalid_filter'; end if;
  begin
    v_id:=(p_request->>'platformId')::uuid;
  exception when others then
    return p_request;
  end;
  if v_id is null then return p_request; end if;
  -- Keep the existing authenticated, active-profile, grant and platform checks.
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then return p_request; end if;
  v_scope:=private.dashboard_admin_live_scope();
  select array_agg(value order by value) into v_selected
    from jsonb_array_elements_text(p_request->'providers') value;
  if v_platform.source='wg' then
    with names as materialized (
      -- Canonicalize once per distinct native name, never once per historical order.
      -- The shared helper enumerates every raw name by the existing site/provider index.
      select provider from private.dashboard_admin_wg_provider_names(
        v_platform.scope_group,v_platform.source_name,coalesce(p_request->>'direction','all'))
    ), matches as (
      select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='lg' then
    with names as materialized (
      select distinct coalesce(nullif(btrim(d.third_party),''),nullif(btrim(d.raw_channel),''),'未识别通道') as provider
      from public.lg_success_daily d
      where d.country_code=v_platform.scope_group and d.platform=v_platform.source_name
        and d.scope_type in ('third_party','channel')
        and d.order_kind=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    ), matches as (
      select unnest(v_selected) as provider union
      select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    ) select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  with scoped as materialized (
    -- Restrict by the registry's indexed country/platform before evaluating
    -- aliases; provider_rows() materializes all authorized platforms first.
    select r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r
    where r.country=v_platform.country
      and r.platform=any(array[v_platform.name,v_platform.source_name]::text[])
      and private.dashboard_scope_allows(v_scope,r.country,r.platform)
  ), normalized as materialized (
    select r.country,r.platform,r.raw_provider,
      case when private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider) is not null
        then array[private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)]
        else private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) end canonical_values
    from scoped r
  ), mapped as (
    select value as raw_provider from unnest(v_selected) value
    union
    select coalesce(nullif(r.raw_provider,''),'未识别通道')
    from normalized r
    left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    where coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      case when cardinality(r.canonical_values)=1 then r.canonical_values[1] end)=any(v_selected)
  )
  select array_agg(distinct raw_provider order by raw_provider) into v_raw from mapped;
  return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
end;
$function$

