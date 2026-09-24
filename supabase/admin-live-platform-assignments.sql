-- Supabase-backed team / platform / package-system read model for the private admin.
-- The legacy admin is untouched. This page only reads the authoritative mapping
-- registry and the current third-party volume read model.
begin;

-- The supplied mapping contains one source spelling that differs from the live
-- AR read model. Keep the user-facing label while matching the real source value.
update public.dashboard_platform_team_map
set source_platform='PLAYER BR', updated_at=now()
where source_system='PANDA' and source_country='胖虎巴西' and platform_name='PLAYERBR';

create or replace function private.dashboard_admin_live_platform_assignments(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_team text; v_country text; v_system text; v_platform text; v_status text := 'all';
  v_offset integer := 0; v_limit integer := 20; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'team','country','system','platform','status','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['team','country','system','platform','status'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200
       or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number'
      or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_team:=nullif(btrim(p_request->>'team'),'');
  v_country:=nullif(btrim(p_request->>'country'),'');
  v_system:=nullif(btrim(p_request->>'system'),'');
  v_platform:=nullif(btrim(p_request->>'platform'),'');
  v_status:=coalesce(nullif(p_request->>'status',''),'all');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_status not in ('all','mapped','unmapped','no_data') or v_limit not in (20,30,50,100,500)
    or v_offset<0 or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_filter';
  end if;

  with mapped as materialized (
    select m.id,m.team_name,m.system_name,m.source_system,m.country_name,m.country_code,
      m.source_country,m.platform_name,m.source_platform,m.active
    from public.dashboard_platform_team_map m
    where m.active and private.dashboard_scope_allows(v_scope,m.country_code,m.source_platform)
  ), actual as materialized (
    select v.country,v.platform,
      sum(v.count)::bigint as matched_count,
      sum(v.count) filter(where v.direction='代收')::bigint as charge_count,
      sum(v.count) filter(where v.direction='代付')::bigint as withdraw_count,
      max(v.data_date) as last_data_date,max(v.updated_at) as updated_at
    from public.third_party_volume v
    where private.dashboard_scope_allows(v_scope,v.country,v.platform)
    group by v.country,v.platform
  ), rows as materialized (
    select m.id,m.team_name,m.system_name,m.source_system,m.country_name,m.country_code,
      m.source_country,m.platform_name,m.source_platform,
      coalesce(a.matched_count,0)::bigint as matched_count,
      coalesce(a.charge_count,0)::bigint as charge_count,
      coalesce(a.withdraw_count,0)::bigint as withdraw_count,
      a.last_data_date,a.updated_at,
      true as mapped,
      case when a.platform is null then 'no_data' else 'mapped' end as status
    from mapped m left join actual a
      on a.country=m.source_country and a.platform=m.source_platform
    union all
    select md5('unmapped:'||a.country||':'||a.platform)::uuid,
      null::text,null::text,'UNMAPPED',a.country,null::text,a.country,a.platform,a.platform,
      a.matched_count,a.charge_count,a.withdraw_count,a.last_data_date,a.updated_at,
      false,'unmapped'
    from actual a
    where not exists(select 1 from mapped m where m.source_country=a.country and m.source_platform=a.platform)
  ), filtered as (
    select * from rows r
    where (v_team is null or r.team_name=v_team)
      and (v_country is null or r.country_name=v_country or r.source_country=v_country or r.country_code=v_country)
      and (v_system is null or r.system_name=v_system or r.source_system=v_system)
      and (v_platform is null or r.platform_name ilike '%'||v_platform||'%' or r.source_platform ilike '%'||v_platform||'%')
      and (v_status='all' or r.status=v_status)
  ), page as (
    select * from filtered order by country_name nulls last,system_name nulls last,platform_name nulls last
      offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',1,'basis','dashboard_platform_team_map + third_party_volume',
    'source','Supabase · dashboard_platform_team_map + third_party_volume',
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'hasMore',(select count(*) from filtered)>v_offset::bigint+v_limit,
    'summary',jsonb_build_object(
      'mappings',(select count(*) from mapped),
      'mapped',(select count(*) from rows where status='mapped'),
      'unmapped',(select count(*) from rows where status='unmapped'),
      'noData',(select count(*) from rows where status='no_data'),
      'teams',(select count(distinct team_name) from mapped),
      'systems',(select count(distinct system_name) from mapped),
      'countries',(select count(distinct country_name) from mapped)),
    'options',jsonb_build_object(
      'teams',coalesce((select jsonb_agg(x.team_name order by x.team_name) from (select distinct team_name from mapped) x),'[]'::jsonb),
      'systems',coalesce((select jsonb_agg(x.system_name order by x.system_name) from (select distinct system_name from mapped) x),'[]'::jsonb),
      'countries',coalesce((select jsonb_agg(x.country_name order by x.country_name) from (select distinct country_name from mapped) x),'[]'::jsonb)),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'team',p.team_name,'system',p.system_name,'sourceSystem',p.source_system,
      'country',p.country_name,'countryCode',p.country_code,'sourceCountry',p.source_country,
      'platform',p.platform_name,'sourcePlatform',p.source_platform,'mapped',p.mapped,
      'matchedCount',p.matched_count,'chargeCount',p.charge_count,'withdrawCount',p.withdraw_count,
      'lastDataDate',p.last_data_date,'updatedAt',p.updated_at,'status',p.status,
      'source','Supabase · dashboard_platform_team_map + third_party_volume')
      order by p.country_name nulls last,p.system_name nulls last,p.platform_name nulls last) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_platform_assignments(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_platform_assignments(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_platform_assignments(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_platform_assignments(p_request);
$$;
revoke all on function public.dashboard_admin_live_platform_assignments(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_platform_assignments(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
