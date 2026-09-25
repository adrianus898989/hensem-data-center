-- Private admin only. Run after admin-live-query-performance.sql and admin-live-provider-aliases.sql.
-- Historical mappings are compacted once, not rescanned for each menu/request.
begin;
create materialized view if not exists private.dashboard_admin_provider_registry as
select country,platform,coalesce(nullif(btrim(raw_channel),''),'') as raw_provider,
  coalesce(array_agg(distinct private.dashboard_admin_live_provider_alias(country,nullif(btrim(channel),''))
    order by private.dashboard_admin_live_provider_alias(country,nullif(btrim(channel),'')))
    filter(where nullif(btrim(channel),'') is not null),'{}'::text[]) as canonical_values,
  coalesce(array_agg(distinct direction order by direction),'{}'::text[]) as directions,
  coalesce(sum(count) filter(where direction='代收'),0)::bigint as charge_count,
  coalesce(sum(count) filter(where direction='代付'),0)::bigint as withdraw_count,
  sum(count)::bigint as matched_count,max(data_date) as last_data_date,max(updated_at) as updated_at
from public.third_party_volume group by country,platform,coalesce(nullif(btrim(raw_channel),''),'');
create unique index if not exists dashboard_admin_provider_registry_key
  on private.dashboard_admin_provider_registry(country,platform,raw_provider);
revoke all on private.dashboard_admin_provider_registry from public,anon,authenticated;

create table if not exists private.dashboard_admin_provider_overrides (
  country text not null,platform text not null,raw_provider text not null,
  canonical_provider text not null check(length(btrim(canonical_provider)) between 1 and 200),
  version bigint not null default 1,updated_at timestamptz not null default now(),updated_by uuid not null,
  primary key(country,platform,raw_provider)
);
create table if not exists private.dashboard_admin_classification_grants (
  auth_user_id uuid primary key references public.dashboard_profiles(auth_user_id),
  can_manage boolean not null default false,updated_at timestamptz not null default now(),updated_by uuid not null
);
create table if not exists private.dashboard_admin_classification_audit (
  id bigint generated always as identity primary key,actor_id uuid not null,
  operation text not null,entity_key jsonb not null,before_value jsonb,after_value jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.dashboard_admin_provider_overrides,private.dashboard_admin_classification_grants,
  private.dashboard_admin_classification_audit from public,anon,authenticated;

create or replace function private.dashboard_admin_live_can_configure()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select p.active and (p.role='owner' or (p.role='admin'
    and exists(select 1 from public.dashboard_admin_preview_grants g where g.auth_user_id=p.auth_user_id and g.can_view)
    and exists(select 1 from private.dashboard_admin_classification_grants g where g.auth_user_id=p.auth_user_id and g.can_manage)))
    from public.dashboard_profiles p where p.auth_user_id=auth.uid()),false);
$$;
revoke all on function private.dashboard_admin_live_can_configure() from public,anon,authenticated;

-- Apply newly confirmed aliases immediately, including registry rows waiting for
-- the next refresh. Two historical spellings of one provider are not a conflict.
create or replace function private.dashboard_admin_live_provider_alias_values(p_country text,p_names text[])
returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct name order by name),'{}'::text[])
 from (select private.dashboard_admin_live_provider_alias(p_country,n) name from unnest(p_names)n) names;
$$;
revoke all on function private.dashboard_admin_live_provider_alias_values(text,text[]) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_provider_rows()
returns table(country text,platform text,raw_provider text,canonical_provider text,canonical_values text[],
  directions text[],charge_count bigint,withdraw_count bigint,matched_count bigint,last_data_date date,
  updated_at timestamptz,status text,version text,manual boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb:=private.dashboard_admin_live_scope();
begin
  return query with normalized as materialized (
    select stored.country,stored.platform,stored.raw_provider,
      private.dashboard_admin_live_provider_alias_values(stored.country,stored.canonical_values) canonical_values,
      stored.directions,stored.charge_count,stored.withdraw_count,stored.matched_count,stored.last_data_date,stored.updated_at
    from private.dashboard_admin_provider_registry stored
    where private.dashboard_scope_allows(v_scope,stored.country,stored.platform)
  ) select r.country,r.platform,r.raw_provider,
    coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),case when cardinality(r.canonical_values)=1 then r.canonical_values[1] end),
    r.canonical_values,r.directions,r.charge_count,r.withdraw_count,r.matched_count,r.last_data_date,
    coalesce(o.updated_at,r.updated_at),case when o.canonical_provider is not null or cardinality(r.canonical_values)=1 then 'assigned'
      when cardinality(r.canonical_values)>1 then 'conflict' else 'unassigned' end,
    md5(jsonb_build_array(r.canonical_values,coalesce(o.version,0))::text),o.canonical_provider is not null
  from normalized r
  left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
  ;
end;
$$;
revoke all on function private.dashboard_admin_live_provider_rows() from public,anon,authenticated;

create or replace function private.dashboard_admin_live_provider_config(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_key text; v_limit integer:=20; v_offset integer:=0;
begin
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['country','platform','rawProvider','canonicalProvider','direction','status','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  for v_key in select jsonb_object_keys(p_request-array['offset','limit']) loop
    if jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_limit:=coalesce((p_request->>'limit')::integer,20);v_offset:=coalesce((p_request->>'offset')::integer,0);
  if v_limit not in(20,30,50,100,500) or v_offset>1000000
    or coalesce(p_request->>'direction','all') not in('all','charge','withdraw')
    or coalesce(p_request->>'status','all') not in('all','assigned','unassigned','conflict') then
    raise exception using errcode='22023',message='invalid_filter';
  end if;
  with allowed as materialized (select * from private.dashboard_admin_live_provider_rows()),
  filtered as materialized (select * from allowed r
    where (nullif(p_request->>'country','') is null or r.country=p_request->>'country')
      and (nullif(p_request->>'platform','') is null or r.platform=p_request->>'platform')
      and (nullif(p_request->>'rawProvider','') is null or position(lower(p_request->>'rawProvider') in lower(r.raw_provider))>0)
      and (nullif(p_request->>'canonicalProvider','') is null or position(lower(p_request->>'canonicalProvider') in lower(r.canonical_provider))>0)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
      and (coalesce(p_request->>'status','all')='all' or r.status=p_request->>'status')),
  page as (select * from filtered order by country,platform,raw_provider offset v_offset limit v_limit)
  select jsonb_build_object('version',3,'canManage',private.dashboard_admin_live_can_configure(),
    'canGrant',exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role='owner'),
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'summary',jsonb_build_object('rawProviders',(select count(*) from filtered),'assigned',(select count(*) from filtered where status='assigned'),
      'unassigned',(select count(*) from filtered where status='unassigned'),'conflict',(select count(*) from filtered where status='conflict')),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('country',r.country,'platform',r.platform,'rawProvider',r.raw_provider,
      'canonicalProvider',r.canonical_provider,'canonicalProviders',r.canonical_values,'directions',r.directions,
      'chargeCount',r.charge_count,'withdrawCount',r.withdraw_count,'matchedCount',r.matched_count,'lastDataDate',r.last_data_date,
      'updatedAt',r.updated_at,'status',r.status,'version',r.version,'manual',r.manual) order by r.country,r.platform,r.raw_provider) from page r),'[]'::jsonb),
    'options',jsonb_build_object('countries',(select jsonb_agg(c order by c) from (select distinct country c from allowed) t),
      'platforms',(select jsonb_agg(p order by p) from (select distinct platform p from allowed where nullif(p_request->>'country','') is null or country=p_request->>'country') t),
      'canonicalProviders',(select jsonb_agg(c order by c) from (select distinct canonical_provider c from allowed where canonical_provider is not null) t))) into v_result;
  return v_result;
end;
$$;

create or replace function private.dashboard_admin_live_provider_options(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_ids uuid[]; v_result jsonb; v_scope jsonb:=private.dashboard_admin_live_scope();
begin
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
    where private.dashboard_scope_allows(v_scope,r.country,r.platform)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
  ), name_sets as materialized (
    select distinct country,canonical_values from scoped
  ), names as materialized (
    select country,canonical_values,private.dashboard_admin_live_provider_alias_values(country,canonical_values) as names from name_sets
  ), matches as (
    select distinct coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      case when cardinality(n.names)=1 then n.names[1] end,
      nullif(private.dashboard_admin_live_provider_alias(r.country,r.raw_provider),''),'未识别通道') as provider
    from scoped r join names n on n.country=r.country and n.canonical_values=r.canonical_values
    left join private.dashboard_admin_provider_overrides o on o.country=r.country and o.platform=r.platform and o.raw_provider=r.raw_provider
  )
  select jsonb_build_object('providers',coalesce((select jsonb_agg(provider order by provider) from matches),'[]'::jsonb),
    'platformCount',(select count(*) from platforms),'basis','existing_classification') into v_result;
  return v_result;
end;
$$;

-- Canonicalization reads the small registry, then gives an explicit manual override precedence.
create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text)
returns text language sql stable security definer set search_path='' as $$
  select private.dashboard_admin_live_provider_alias(p_country,coalesce((select coalesce(o.canonical_provider,case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=p_country and r.platform=p_platform and r.raw_provider=case when p_raw='未识别通道' then '' else coalesce(btrim(p_raw),'') end),p_raw));
$$;
revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_configuration_access(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.dashboard_admin_live_scope();
  if p_request is distinct from '{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  if not exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role='owner') then
    raise exception using errcode='42501',message='configuration_denied';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('userId',p.auth_user_id,'username',p.username,
    'canManage',coalesce(g.can_manage,false),'canView',exists(select 1 from public.dashboard_admin_preview_grants v where v.auth_user_id=p.auth_user_id and v.can_view)) order by p.username)
    from public.dashboard_profiles p left join private.dashboard_admin_classification_grants g using(auth_user_id)
    where p.active and p.role='admin'),'[]'::jsonb));
end;
$$;

create or replace function private.dashboard_admin_live_configuration_write(p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_actor uuid:=auth.uid();v_operation text;v_key text;
  v_before jsonb;v_after jsonb;v_version text;v_row record;v_map public.dashboard_platform_team_map%rowtype;v_id uuid;
begin
  if not private.dashboard_admin_live_can_configure() then raise exception using errcode='42501',message='configuration_denied';end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['operation','country','platform','rawProvider','canonicalProvider',
      'expectedVersion','mappingId','team','system','sourceSystem','countryCode','sourceCountry','sourcePlatform','platformName','userId','canManage'])) then
    raise exception using errcode='22023',message='invalid_request';end if;
  for v_key in select jsonb_object_keys(p_request-'canManage') loop
    if jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023',message='invalid_filter';end if;
  end loop;
  v_operation:=p_request->>'operation';
  if v_operation='grant' then
    if not exists(select 1 from public.dashboard_profiles where auth_user_id=v_actor and active and role='owner') then
      raise exception using errcode='42501',message='configuration_denied';end if;
    if p_request-array['operation','userId','canManage']<>'{}'::jsonb or jsonb_typeof(p_request->'canManage') is distinct from 'boolean' then
      raise exception using errcode='22023',message='invalid_request';end if;
    v_id:=(p_request->>'userId')::uuid;
    if not exists(select 1 from public.dashboard_profiles where auth_user_id=v_id and active and role='admin') then
      raise exception using errcode='22023',message='invalid_target';end if;
    select to_jsonb(g) into v_before from private.dashboard_admin_classification_grants g where auth_user_id=v_id for update;
    insert into private.dashboard_admin_classification_grants(auth_user_id,can_manage,updated_by) values(v_id,(p_request->>'canManage')::boolean,v_actor)
      on conflict(auth_user_id) do update set can_manage=excluded.can_manage,updated_at=now(),updated_by=v_actor returning to_jsonb(dashboard_admin_classification_grants.*) into v_after;
  elsif v_operation='provider' then
    if p_request-array['operation','country','platform','rawProvider','canonicalProvider','expectedVersion']<>'{}'::jsonb
      or not(p_request ?& array['country','platform','rawProvider','canonicalProvider','expectedVersion'])
      or length(btrim(p_request->>'canonicalProvider'))=0 then raise exception using errcode='22023',message='invalid_request';end if;
    if not private.dashboard_scope_allows(v_scope,p_request->>'country',p_request->>'platform') then raise exception using errcode='42501',message='scope_denied';end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('provider',p_request->>'country',p_request->>'platform',p_request->>'rawProvider')::text,0));
    select * into v_row from private.dashboard_admin_live_provider_rows() where country=p_request->>'country' and platform=p_request->>'platform' and raw_provider=p_request->>'rawProvider';
    if not found then raise exception using errcode='22023',message='mapping_not_found';end if;
    if v_row.version<>p_request->>'expectedVersion' then raise exception using errcode='40001',message='configuration_conflict';end if;
    v_before:=to_jsonb(v_row);
    insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider,updated_by)
      values(v_row.country,v_row.platform,v_row.raw_provider,btrim(p_request->>'canonicalProvider'),v_actor)
      on conflict(country,platform,raw_provider) do update set canonical_provider=excluded.canonical_provider,version=dashboard_admin_provider_overrides.version+1,
        updated_at=now(),updated_by=v_actor returning to_jsonb(dashboard_admin_provider_overrides.*) into v_after;
  elsif v_operation='platform' then
    if p_request-array['operation','mappingId','team','system','sourceSystem','country','countryCode','sourceCountry','sourcePlatform','platformName','expectedVersion']<>'{}'::jsonb then
      raise exception using errcode='22023',message='invalid_request';end if;
    foreach v_key in array array['team','system','sourceSystem','country','countryCode','sourceCountry','sourcePlatform','platformName','expectedVersion'] loop
      if coalesce(length(btrim(p_request->>v_key)),0)=0 then raise exception using errcode='22023',message='invalid_filter';end if;
    end loop;
    if not private.dashboard_scope_allows(v_scope,p_request->>'sourceCountry',p_request->>'sourcePlatform')
      or not private.dashboard_scope_allows(v_scope,p_request->>'countryCode',p_request->>'sourcePlatform') then
      raise exception using errcode='42501',message='scope_denied';end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('platform',p_request->>'sourceCountry',p_request->>'sourcePlatform')::text,0));
    if nullif(p_request->>'mappingId','') is not null then
      select * into v_map from public.dashboard_platform_team_map where id=(p_request->>'mappingId')::uuid for update;
      if not found or not v_map.active or v_map.source_country<>p_request->>'sourceCountry' or v_map.source_platform<>p_request->>'sourcePlatform'
        or v_map.source_system<>p_request->>'sourceSystem' then raise exception using errcode='22023',message='mapping_not_found';end if;
      if v_map.country_code is distinct from p_request->>'countryCode' or v_map.country_name is distinct from p_request->>'country' then
        raise exception using errcode='22023',message='invalid_classification';end if;
      v_version:=md5(to_jsonb(v_map)::text);
    else
      if not exists(select 1 from private.dashboard_admin_provider_registry where country=p_request->>'sourceCountry' and platform=p_request->>'sourcePlatform') then
        raise exception using errcode='22023',message='mapping_not_found';end if;
      if exists(select 1 from public.dashboard_platform_team_map where source_country=p_request->>'sourceCountry' and source_platform=p_request->>'sourcePlatform') then
        raise exception using errcode='40001',message='configuration_conflict';end if;
      v_version:=md5(jsonb_build_array('unmapped',p_request->>'sourceCountry',p_request->>'sourcePlatform')::text);
    end if;
    if v_version<>p_request->>'expectedVersion' then raise exception using errcode='40001',message='configuration_conflict';end if;
    if not exists(select 1 from public.dashboard_platform_team_map where source_system=p_request->>'sourceSystem')
      or not exists(select 1 from public.dashboard_platform_team_map where country_code=p_request->>'countryCode' and country_name=p_request->>'country') then
      raise exception using errcode='22023',message='invalid_classification';end if;
    v_before:=to_jsonb(v_map);
    if v_map.id is not null then
      update public.dashboard_platform_team_map set team_name=btrim(p_request->>'team'),system_name=btrim(p_request->>'system'),
        country_name=p_request->>'country',country_code=p_request->>'countryCode',platform_name=btrim(p_request->>'platformName'),updated_at=now()
        where id=v_map.id returning to_jsonb(dashboard_platform_team_map.*) into v_after;
    else
      insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform)
        values(btrim(p_request->>'team'),btrim(p_request->>'system'),p_request->>'sourceSystem',p_request->>'country',p_request->>'countryCode',
          p_request->>'sourceCountry',btrim(p_request->>'platformName'),p_request->>'sourcePlatform') returning to_jsonb(dashboard_platform_team_map.*) into v_after;
    end if;
  else raise exception using errcode='22023',message='invalid_operation';
  end if;
  insert into private.dashboard_admin_classification_audit(actor_id,operation,entity_key,before_value,after_value)
    values(v_actor,v_operation,p_request-array['canonicalProvider','team','system','platformName','expectedVersion'],v_before,v_after);
  return jsonb_build_object('ok',true,'operation',v_operation);
end;
$$;

-- Public wrappers preserve independent preview access, current scope, and write grants.
create or replace function public.dashboard_admin_live_provider_config(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_provider_config(p_request)$$;
create or replace function public.dashboard_admin_live_provider_options(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_provider_options(p_request)$$;
create or replace function public.dashboard_admin_live_configuration_access(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_configuration_access(p_request)$$;
create or replace function public.dashboard_admin_live_configuration_write(p_request jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.dashboard_admin_live_configuration_write(p_request)$$;
do $$declare n text;begin
  foreach n in array array['provider_config','provider_options','configuration_access','configuration_write'] loop
    execute format('revoke all on function private.dashboard_admin_live_%I(jsonb) from public,anon,authenticated',n);
    execute format('revoke all on function public.dashboard_admin_live_%I(jsonb) from public,anon,authenticated',n);
    execute format('grant execute on function private.dashboard_admin_live_%I(jsonb) to authenticated',n);
    execute format('grant execute on function public.dashboard_admin_live_%I(jsonb) to authenticated',n);
  end loop;
end$$;
notify pgrst,'reload schema';
commit;

-- Keep this small historical directory fresh as source publications arrive.
-- No raw orders, collector or legacy tables are rewritten.
select cron.schedule('admin-provider-registry-refresh','*/5 * * * *',
  'refresh materialized view concurrently private.dashboard_admin_provider_registry');
