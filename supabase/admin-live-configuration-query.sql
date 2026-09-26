-- Install the new raw engine, then reapply canonical provider presentation.
begin;
do $$declare definition text;begin
  select pg_get_functiondef('private.dashboard_admin_live_query(jsonb)'::regprocedure) into definition;
  if position('created_metrics' in definition)=0 then raise exception 'Apply admin-live-query-performance.sql first';end if;
  execute replace(definition,'private.dashboard_admin_live_query(', 'private.dashboard_admin_live_query_raw(');
end$$;
revoke all on function private.dashboard_admin_live_query_raw(jsonb) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_remap_groups(p_rows jsonb,p_country text,p_platform text,p_daily boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  r jsonb; old_row jsonb; out_rows jsonb := '{}'::jsonb; key text; canonical text;
  k text; n numeric; fields text[] := array['all_count','missing_amount_count','negative_amount_count',
    'success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count'];
  amount_fields text[] := array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    canonical:=private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider');
    key:=coalesce(r->>'direction','')||chr(31)||coalesce(r->>'currency','')||chr(31)||coalesce(canonical,'')||
      case when p_daily then chr(31)||coalesce(r->>'date','') else '' end;
    if not (out_rows ? key) then
      out_rows:=out_rows||jsonb_build_object(key,jsonb_set(r,'{provider}',to_jsonb(canonical),true));
    else
      old_row:=out_rows->key;
      foreach k in array fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n),true);
        end if;
      end loop;
      foreach k in array amount_fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(trim(to_char(n,'FM999999999999999999999999999999990D99999999'))),true);
        end if;
      end loop;
      if coalesce(r->>'latest_synced_at','')>coalesce(old_row->>'latest_synced_at','') then
        old_row:=jsonb_set(old_row,'{latest_synced_at}',to_jsonb(r->>'latest_synced_at'),true);
      end if;
      out_rows:=jsonb_set(out_rows,array[key],old_row,true);
    end if;
  end loop;
  return coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency',value->>'date') from jsonb_each(out_rows)),'[]'::jsonb);
end;
$$;
revoke all on function private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_remap_rows(p_rows jsonb,p_country text,p_platform text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_set(r,'{provider}',to_jsonb(private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider')),true)
    order by ordinal),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as rows(r,ordinal);
$$;
revoke all on function private.dashboard_admin_live_remap_rows(jsonb,text,text) from public,anon,authenticated;

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
  if jsonb_array_length(p_request->'providers')>200 or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter';end if;
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
      select coalesce(nullif(v.raw_provider,''),'未识别通道')
      from private.dashboard_admin_live_provider_rows() v
      where v.country=v_platform.country and (v.platform=v_platform.name or v.platform=v_platform.source_name)
        and v.canonical_provider=any(coalesce(v_selected,'{}'::text[]))

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
  if v_action='catalog' then
    return v_result||jsonb_build_object('withdrawPlatforms',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('scopeGroup',p.scope_group,'sourceName',p.source_name)),'[]'::jsonb) from private.dashboard_admin_live_withdraw_platforms() p));
  end if;
  v_country:=v_result#>>'{platform,country}';
  v_platform:=coalesce(v_result#>>'{platform,sourceName}',v_result#>>'{platform,name}');
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
