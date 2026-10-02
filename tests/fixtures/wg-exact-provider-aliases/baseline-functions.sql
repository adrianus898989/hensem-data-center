-- Reviewed production function definitions only; no rows, secrets or customer data.

-- WG runtime routes through dashboard_admin_wg_payout_config, not the obsolete branch.

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_canonical(p_country text, p_platform text, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.dashboard_admin_live_provider_alias(p_country,coalesce((select coalesce(o.canonical_provider,private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider),case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=p_country and r.platform=p_platform and r.raw_provider=case when p_raw='未识别通道' then '' else coalesce(btrim(p_raw),'') end),p_raw));
$function$;


CREATE OR REPLACE FUNCTION private.dashboard_admin_live_configuration_write(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_rows()
 RETURNS TABLE(country text, platform text, raw_provider text, canonical_provider text, canonical_values text[], directions text[], charge_count bigint, withdraw_count bigint, matched_count bigint, last_data_date date, updated_at timestamp with time zone, status text, version text, manual boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scope jsonb:=private.dashboard_admin_live_scope();
begin
  return query with normalized as materialized (
    select stored.country,stored.platform,stored.raw_provider,
      case when private.dashboard_admin_live_confirmed_usdt_provider(stored.country,stored.raw_provider) is not null
        then array[private.dashboard_admin_live_confirmed_usdt_provider(stored.country,stored.raw_provider)]
        else private.dashboard_admin_live_provider_alias_values(stored.country,stored.canonical_values) end canonical_values,
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
$function$;


CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_sites()
 RETURNS TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 values ('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),
 ('8311','BR','巴西','POPKKK','America/Sao_Paulo','BRL'),
 ('12588','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),
 ('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'),
 ('3605','VN','越南','XX98','Asia/Ho_Chi_Minh','VND');
$function$;


CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_payout_config(p_request jsonb, p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare targets jsonb; target jsonb; summaries jsonb:='[]'::jsonb; snap jsonb; cfg jsonb; chosen jsonb; result_snapshot jsonb;
begin
 -- Only the five collector sites, never an obsolete sibling from wg_config_targets.
 select coalesce(jsonb_agg(t order by t->>'country_code'),'[]'::jsonb) into targets from (
  select jsonb_build_object('country_code',s.country_code,'country_name',s.country,'platform',case s.country_code when 'BR' then '26BET' else '98VV' end,
   'timezone',s.timezone,'site_code',case s.country_code when 'BR' then '278' else '3257' end,'display_group',s.country_code,'display_name',s.country,
   'members',jsonb_agg(jsonb_build_object('site_code',s.site_code,'name',s.platform) order by s.site_code)) t
  from private.dashboard_admin_wg_sites() s where private.dashboard_scope_allows(p_scope,s.country_code,s.platform)
  group by s.country_code,s.country,s.timezone
 ) q;
 for target in select value from jsonb_array_elements(targets) loop
  select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
   'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 实时每日配置')
   into snap from public.wg_realtime_config_daily d where d.site_code=target->>'site_code' order by d.observed_at desc limit 1;
  if snap is null then
   select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
    'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 历史配置快照')
    into snap from public.wg_config_daily d where d.country_code=target->>'country_code' and d.platform=target->>'platform' order by d.observed_at desc limit 1;
  end if;
  if snap is not null then
   summaries:=summaries||jsonb_build_array(snap-'configuration'-'received_at'-'parser_version');
  end if;
  if target->>'country_code'=p_request->>'country' and target->>'platform'=p_request->>'platform' then
   chosen:=target;
   if snap is not null then
    if jsonb_typeof(snap#>'{configuration,settings}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,dictionaries}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,completeness}') is distinct from 'object' then
     raise exception using errcode='22023',message='config_snapshot_incomplete';end if;
    cfg:=private.dashboard_admin_config_projection('WG',snap->'configuration');
    cfg:=jsonb_set(cfg,'{settings}',coalesce((select jsonb_object_agg(k,v) from jsonb_each(cfg->'settings') e(k,v)
     where k='0' or exists(select 1 from jsonb_array_elements(target->'members') m where m->>'site_code'=k)),'{}'::jsonb));
    result_snapshot:=snap||jsonb_build_object('configuration',cfg);
   end if;
  end if;
 end loop;
 if coalesce(p_request->>'operation','index')='index' then
  return jsonb_build_object('version',1,'system','WG','targets',targets,'summaries',summaries,'readOnly',true);
 end if;
 if chosen is null then raise exception using errcode='42501',message='config_target_denied';end if;
 return jsonb_build_object('version',1,'system','WG','target',chosen,'snapshot',result_snapshot,'readOnly',true);
end;
$function$;
