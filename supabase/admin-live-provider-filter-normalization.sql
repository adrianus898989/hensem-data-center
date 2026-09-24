-- Expand a canonical third-party filter back to every raw channel already
-- mapped to it. The live query then aggregates the same canonical value for
-- both collection and payout instead of silently filtering out its aliases.
begin;

create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_id uuid;
  v_platform record;
  v_selected text[];
  v_raw text[];
begin
  if p_request is null or jsonb_typeof(p_request->'providers')<>'array'
    or jsonb_array_length(p_request->'providers')=0 then
    return p_request;
  end if;
  begin
    v_id:=(p_request->>'platformId')::uuid;
  exception when others then
    return p_request;
  end;
  if v_id is null then return p_request; end if;
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then return p_request; end if;
  select array_agg(value order by value) into v_selected
    from jsonb_array_elements_text(p_request->'providers') value;
  select array_agg(distinct raw_provider order by raw_provider) into v_raw
    from (
      select value as raw_provider from unnest(coalesce(v_selected,'{}'::text[])) value
      union
      select v.raw_channel
      from public.third_party_volume v
      where v.country=v_platform.country and v.platform=v_platform.name
        and v.channel=any(coalesce(v_selected,'{}'::text[]))
        and v.raw_channel is not null and btrim(v.raw_channel)<>''
    ) mapped;
  return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
end;
$$;
revoke all on function private.dashboard_admin_live_expand_provider_filter(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to authenticated;

create or replace function private.dashboard_admin_live_query(p_request jsonb default '{"action":"catalog"}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_request jsonb:=private.dashboard_admin_live_expand_provider_filter(p_request);
  v_result jsonb; v_action text; v_country text; v_platform text;
begin
  v_result:=private.dashboard_admin_live_query_raw(v_request);
  v_action:=coalesce(v_request->>'action','catalog');
  if v_action='catalog' then return v_result; end if;
  v_country:=v_result#>>'{platform,country}';
  v_platform:=v_result#>>'{platform,name}';
  if v_country is null or v_platform is null then return v_result; end if;
  if v_result#>'{groups,provider}' is not null then
    v_result:=jsonb_set(v_result,'{groups,provider}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,provider}',v_country,v_platform,false),true);
  end if;
  if v_result#>'{groups,daily}' is not null then
    v_result:=jsonb_set(v_result,'{groups,daily}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,daily}',v_country,v_platform,true),true);
  end if;
  if v_action='details' and v_result#>'{rows}' is not null then
    v_result:=jsonb_set(v_result,'{rows}',private.dashboard_admin_live_remap_rows(v_result#>'{rows}',v_country,v_platform),true);
  end if;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_query(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_query(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_query(p_request jsonb default '{"action":"catalog"}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_query(p_request);
$$;
revoke all on function public.dashboard_admin_live_query(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_query(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
