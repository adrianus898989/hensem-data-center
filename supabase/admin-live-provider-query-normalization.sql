-- Reuse the existing Supabase third-party mapping in every private order
-- aggregate/details response. The legacy function is retained under a raw
-- name; this wrapper only normalizes its provider dimensions.
begin;

do $$
begin
  if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname='dashboard_admin_live_query'
        and pg_get_function_identity_arguments(p.oid)='p_request jsonb'
    )
    and not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname='dashboard_admin_live_query_raw'
        and pg_get_function_identity_arguments(p.oid)='p_request jsonb'
    ) then
    alter function private.dashboard_admin_live_query(jsonb) rename to dashboard_admin_live_query_raw;
  end if;
end;
$$;

create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text)
returns text language sql stable security definer set search_path='' as $$
  select case
    when p_raw is null or btrim(p_raw)='' then p_raw
    when count(distinct nullif(btrim(v.channel),''))=1 then min(nullif(btrim(v.channel),''))
    else p_raw
  end
  from public.third_party_volume v
  where v.country=p_country
    and v.platform=p_platform
    and v.raw_channel=p_raw;
$$;
revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text) from public,anon;
grant execute on function private.dashboard_admin_live_provider_canonical(text,text,text) to authenticated;

create or replace function private.dashboard_admin_live_remap_groups(p_rows jsonb,p_country text,p_platform text,p_daily boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  r jsonb; old_row jsonb; out_rows jsonb := '{}'::jsonb; key text; canonical text;
  k text; n numeric; fields text[] := array['all_count','missing_amount_count','negative_amount_count',
    'success_count','pending_count','failed_count','rejected_count','unknown_count'];
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
revoke all on function private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean) from public,anon;
grant execute on function private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean) to authenticated;

create or replace function private.dashboard_admin_live_remap_rows(p_rows jsonb,p_country text,p_platform text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_set(r,'{provider}',to_jsonb(private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider')),true)
    order by r->>'created_at' desc,r->>'direction' desc,r->>'id' desc),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
$$;
revoke all on function private.dashboard_admin_live_remap_rows(jsonb,text,text) from public,anon;
grant execute on function private.dashboard_admin_live_remap_rows(jsonb,text,text) to authenticated;

create or replace function private.dashboard_admin_live_query(p_request jsonb default '{"action":"catalog"}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_result jsonb; v_action text; v_country text; v_platform text;
begin
  v_result:=private.dashboard_admin_live_query_raw(p_request);
  v_action:=coalesce(p_request->>'action','catalog');
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
