-- Apply after configuration-query / provider-filter-normalization. This changes
-- only filter expansion; order cohorts, success time and permissions are retained.
begin;
create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_id uuid;
  v_platform record;
  v_scope jsonb;
  v_selected text[];
  v_raw text[];
begin
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
      private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) canonical_values
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
$$;
revoke all on function private.dashboard_admin_live_expand_provider_filter(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
