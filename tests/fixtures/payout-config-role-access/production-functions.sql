-- Production function definitions only, read 2026-10-03. No source records or credentials.
CREATE OR REPLACE FUNCTION public.dashboard_has_permission(permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.application_current_session_allowed('dashboard') and private.dashboard_role_legacy_allowed() and (select exists (
    select 1
    from public.dashboard_profiles p
    where p.auth_user_id = auth.uid()
      and p.active = true
      and (
        p.role = 'owner'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  ));
$function$;

revoke all on function public.dashboard_has_permission(text) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_has_permission(text) to authenticated;
grant execute on function public.dashboard_has_permission(text) to service_role;

CREATE OR REPLACE FUNCTION private.dashboard_role_context_valid()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;payload jsonb;k bytea;a private.dashboard_role_assignments%rowtype;r private.dashboard_roles%rowtype;
begin
 v:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb;payload:=v->'payload';
 if jsonb_typeof(v)<>'object' or jsonb_typeof(payload)<>'object'
  or coalesce(payload->>'page','')='' or coalesce(payload->>'rpc','')='' or coalesce(payload->>'action','')='' or coalesce(payload->>'capability','')=''
  or payload->>'uid' is distinct from auth.uid()::text
  or payload->>'txid' is distinct from pg_current_xact_id()::text or payload->>'pid' is distinct from pg_backend_pid()::text then return false;end if;
 select secret into k from private.dashboard_role_context_secret where singleton;
 if k is null or v->>'signature' is distinct from private.dashboard_role_hmac(payload::text,k) then return false;end if;
 select * into a from private.dashboard_role_assignments where auth_user_id=auth.uid();
 if not found then return false;end if;
 select * into r from private.dashboard_roles where id=a.role_id;
 return found and r.active and payload->>'roleId'=r.id::text and payload->>'roleVersion'=r.version::text
  and payload->>'assignmentVersion'=a.version::text
  and exists(select 1 from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active and p.role in ('admin','viewer'))
  and exists(select 1 from public.dashboard_admin_preview_grants g where g.auth_user_id=auth.uid() and g.can_view);
exception when others then return false;
end;$function$;

revoke all on function private.dashboard_role_context_valid() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.dashboard_role_require_gateway()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active and p.role='owner') then return;end if;
 if exists(select 1 from private.dashboard_role_assignments where auth_user_id=auth.uid()) and not private.dashboard_role_context_valid() then
  raise exception using errcode='42501',message='role_gateway_required';
 end if;
end;$function$;

revoke all on function private.dashboard_role_require_gateway() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_scope()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_profile public.dashboard_profiles%rowtype;
begin
  if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied'; end if;
  perform private.dashboard_role_require_gateway(); -- assigned-role signed gateway
  if v_user is null then raise exception using errcode='28000',message='login_required'; end if;
  select * into v_profile from public.dashboard_profiles where auth_user_id=v_user;
  if not found or v_profile.active is not true or coalesce(v_profile.role,'') not in ('owner','admin','viewer') then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  if v_profile.role<>'owner' and not exists(select 1 from public.dashboard_admin_preview_grants
      where auth_user_id=v_user and can_view is true) then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  -- Fresh production scope, independent of the old third_party module grant.
  return private.dashboard_current_data_scope();
end;
$function$;

revoke all on function private.dashboard_admin_live_scope() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.dashboard_game66_review_rules()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_rules jsonb := '[]'::jsonb;
begin
  if public.dashboard_has_permission('auto_withdraw') is not true then
    raise exception using errcode = '42501', message = 'DASHBOARD_PERMISSION_DENIED';
  end if;
  v_scope := private.dashboard_current_data_scope();

  select coalesce(jsonb_agg(jsonb_build_object(
    'platform_id', q.id,
    'platform_code', q.platform_code,
    'platform_name', q.platform_name,
    'team_code', q.team_code,
    'team_name', q.team_name,
    'timezone', 'Asia/Kolkata',
    'updated_at', q.updated_at,
    'rule_count', q.rule_count
  ) order by q.team_name, q.platform_name), '[]'::jsonb)
  into v_targets
  from (
    select p.id, p.platform_code, p.platform_name, p.team_code, p.team_name,
      greatest(p.updated_at, max(r.last_seen_at)) as updated_at,
      count(r.id) as rule_count
    from public.game66_platforms p
    left join public.game66_review_rules r on r.platform_id = p.id
    where private.dashboard_scope_allows(v_scope, '印度', p.platform_name)
    group by p.id, p.platform_code, p.platform_name, p.team_code, p.team_name, p.updated_at
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'platform_id', r.platform_id,
    'rule_id', r.rule_id,
    'template_id', r.template_id,
    'title', r.title,
    'operator', r.operator,
    'value', r.value,
    'rule_type', r.rule_type,
    'description', r.description,
    'enabled', r.enabled,
    'remark', r.remark,
    'effective_type', r.effective_type,
    'effective_channel', r.effective_channel,
    'effective_type_text', r.effective_type_text,
    'raw_payload', r.raw_payload,
    'payload_hash', r.payload_hash,
    'last_seen_at', r.last_seen_at
  ) order by p.team_name, p.platform_name, r.rule_id), '[]'::jsonb)
  into v_rules
  from public.game66_review_rules r
  join public.game66_platforms p on p.id = r.platform_id
  where private.dashboard_scope_allows(v_scope, '印度', p.platform_name);

  return jsonb_build_object('ok', true, 'targets', v_targets, 'rules', v_rules);
end;
$function$;

revoke all on function public.dashboard_game66_review_rules() from public,anon,authenticated,service_role;
grant execute on function public.dashboard_game66_review_rules() to authenticated;
grant execute on function public.dashboard_game66_review_rules() to service_role;

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_payout_config(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb:=private.dashboard_admin_live_scope(); v_system text; v_operation text; v_key text;
  v_country text; v_platform text; v_daily text; v_targets jsonb; v_summaries jsonb; v_target jsonb;
  v_snapshot jsonb; v_dictionary jsonb; v_legacy jsonb; v_team text;
begin
  if public.dashboard_has_permission('auto_withdraw') is not true then
    raise exception using errcode='42501',message='auto_withdraw_permission_denied';
  end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['operation','system','country','platform'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['operation','system','country','platform'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>100
      or p_request->>v_key ~ '[[:cntrl:]]') then raise exception using errcode='22023',message='invalid_filter'; end if;
  end loop;
  v_system:=coalesce(p_request->>'system','AR');v_operation:=coalesce(p_request->>'operation','index');
  v_country:=nullif(p_request->>'country','');v_platform:=nullif(p_request->>'platform','');
  if v_system not in ('AR','NEW_AR','PANDA','WG','GAME66_HK','GAME66_RED_CRAB') or v_operation not in ('index','snapshot') then
    raise exception using errcode='22023',message='invalid_operation';
  end if;
  if (v_operation='index' and (p_request ? 'country' or p_request ? 'platform'))
    or (v_operation='snapshot' and (v_country is null or v_platform is null)) then
    raise exception using errcode='22023',message='invalid_target';
  end if;
  if v_system in ('AR','NEW_AR') then
    select coalesce(jsonb_agg(jsonb_build_object('country_code',t.country_code,'country_name',t.country_name,
      'platform',t.platform,'timezone',t.timezone,'currency',t.currency,'source_system',t.source_system,
      'display_group',t.country_code,'display_name',t.country_name) order by t.country_code,t.platform),'[]'::jsonb)
      into v_targets from public.ar_config_targets t
      where t.source_system=v_system and private.dashboard_scope_allows(v_scope,t.country_code,t.platform);
    v_daily:='ar_config_daily';
  elsif v_system='PANDA' then
    select coalesce(jsonb_agg(jsonb_build_object('country_code',t.country_code,'country_name',t.country_name,
      'platform',t.platform,'timezone',t.timezone,'currency',t.currency,
      'display_group',private.dashboard_data_group(t.country_code,t.platform),
      'display_name',case when private.dashboard_data_group(t.country_code,t.platform)='BR_PANGHU' then '胖虎巴西' else t.country_name end)
      order by t.country_code,t.platform),'[]'::jsonb) into v_targets from public.panda_config_targets t
      where private.dashboard_scope_allows(v_scope,t.country_code,t.platform);
    v_daily:='panda_config_daily';
  elsif v_system='WG' then
    -- wg_existing_config_v1: parent snapshots projected to authorized member settings only.
    return private.dashboard_admin_wg_payout_config(p_request,v_scope);
    select coalesce(jsonb_agg(jsonb_build_object('country_code',t.country_code,'country_name',t.country_name,
      'platform',t.platform,'timezone',t.timezone,'site_code',t.site_code,'members',(
        select coalesce(jsonb_agg(private.dashboard_admin_config_pick(m.value,array['site_code','name']) order by m.ordinality),'[]'::jsonb)
        from jsonb_array_elements(t.members) with ordinality m),
      'display_group',t.country_code,'display_name',t.country_name) order by t.country_code,t.platform),'[]'::jsonb)
      into v_targets from public.wg_config_targets t where private.dashboard_scope_allows(v_scope,t.country_code,t.platform);
    v_daily:='wg_config_daily';
  else
    -- Preserve the original RPC's auto_withdraw and IN/platform scope semantics.
    -- Its raw DTO stays inside the database and is projected before returning.
    v_legacy:=public.dashboard_game66_review_rules();
    v_team:=case v_system when 'GAME66_HK' then 'hong_kong' else 'red_crab' end;
    select coalesce(jsonb_agg(jsonb_build_object('country_code',v_system,'country_name',t->>'team_name',
      'platform',t->>'platform_name','platform_id',t->>'platform_id','timezone',t->>'timezone',
      'team_code',t->>'team_code','team_name',t->>'team_name','rule_count',t->'rule_count','updated_at',t->'updated_at',
      'display_group',v_system,'display_name',t->>'team_name') order by t->>'platform_name'),'[]'::jsonb)
      into v_targets from jsonb_array_elements(v_legacy->'targets') t
      where t->>'team_code'=v_team and upper(btrim(t->>'platform_name')) not in ('GEM7','MAX7','EK7');
  end if;
  v_targets:=private.dashboard_admin_config_safe_json(v_targets);
  if v_operation='index' then
    if v_daily is not null then
      execute format($q$select coalesce(jsonb_agg(jsonb_build_object('country_code',t.country_code,'platform',t.platform,
        'timezone',d.timezone,'observed_at',d.observed_at,'observed_local_date',d.observed_local_date)
        order by t.country_code,t.platform),'[]'::jsonb)
        from jsonb_to_recordset($1) t(country_code text,platform text)
        join lateral (select x.timezone,x.observed_at,x.observed_local_date from public.%I x
          where x.country_code=t.country_code and x.platform=t.platform order by x.observed_at desc limit 1) d on true$q$,v_daily)
        into v_summaries using v_targets;
    else
      select coalesce(jsonb_agg(jsonb_build_object('country_code',t->'country_code','platform',t->'platform',
        'timezone',t->'timezone','observed_at',r.observed_at,
        'observed_local_date',(r.observed_at at time zone (t->>'timezone'))::date)),'[]'::jsonb)
        into v_summaries from jsonb_array_elements(v_targets) t
        cross join lateral(select max((r->>'last_seen_at')::timestamptz) observed_at
          from jsonb_array_elements(v_legacy->'rules') r where r->>'platform_id'=t->>'platform_id') r
        where (t->>'rule_count')::integer>0;
    end if;
    return jsonb_build_object('version',1,'system',v_system,'targets',v_targets,'summaries',v_summaries,'readOnly',true);
  end if;
  select t into v_target from jsonb_array_elements(v_targets) t where t->>'country_code'=v_country and t->>'platform'=v_platform;
  if not found then raise exception using errcode='42501',message='config_target_denied'; end if;
  if v_daily is not null then
    execute format($q$select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,
      'observed_at',d.observed_at,'observed_local_date',d.observed_local_date,'received_at',d.received_at,
      'parser_version',d.parser_version,'configuration',d.configuration)
      from public.%I d where d.country_code=$1 and d.platform=$2 order by d.observed_at desc limit 1$q$,v_daily)
      into v_snapshot using v_country,v_platform;
    if v_snapshot is not null then
      -- Match the legacy clients' source shape checks before projecting. A
      -- target reclassified from AR to NEW_AR cannot reuse a stale AR shape.
      if (v_system='AR' and (jsonb_typeof(v_snapshot#>'{configuration,fields}') is distinct from 'array'
          or jsonb_typeof(v_snapshot#>'{configuration,groups}') is distinct from 'array'))
        or (v_system='NEW_AR' and (jsonb_typeof(v_snapshot#>'{configuration,fields}') is distinct from 'array'
          or jsonb_typeof(v_snapshot#>'{configuration,channels}') is distinct from 'array'
          or jsonb_typeof(v_snapshot#>'{configuration,channelRules}') is distinct from 'array'
          or (v_snapshot->>'parser_version'='newar-config-v2' and jsonb_typeof(v_snapshot#>'{configuration,settingGroups}') is distinct from 'array')))
        or (v_system='PANDA' and (jsonb_typeof(v_snapshot#>'{configuration,values}') is distinct from 'object'
          or jsonb_typeof(v_snapshot#>'{configuration,unavailable_fields}') is distinct from 'array'))
        or (v_system='WG' and (jsonb_typeof(v_snapshot#>'{configuration,settings}') is distinct from 'object'
          or jsonb_typeof(v_snapshot#>'{configuration,dictionaries}') is distinct from 'object'
          or jsonb_typeof(v_snapshot#>'{configuration,completeness}') is distinct from 'object')) then
        raise exception using errcode='22023',message='config_snapshot_incomplete';
      end if;
      v_snapshot:=jsonb_set(v_snapshot,'{configuration}',private.dashboard_admin_config_projection(v_system,v_snapshot->'configuration'));
      if v_system='PANDA' then
        select private.dashboard_admin_config_pick(d.dictionary,array['schema_version','source_system','country_code','platform','timezone','observed_at','observed_local_date','channels','levels'])
          into v_dictionary from public.panda_config_dictionary_daily d
          where d.country_code=v_country and d.platform=v_platform and d.timezone=v_target->>'timezone'
            and d.dictionary->>'country_code'=v_country and d.dictionary->>'platform'=v_platform
          order by d.observed_at desc limit 1;
        v_snapshot:=v_snapshot||jsonb_build_object('dictionary',v_dictionary);
      end if;
    end if;
  else
    select jsonb_build_object('country_code',v_country,'platform',v_platform,'timezone',v_target->'timezone',
      'observed_at',max((r->>'last_seen_at')::timestamptz),
      'observed_local_date',(max((r->>'last_seen_at')::timestamptz) at time zone (v_target->>'timezone'))::date,
      'configuration',jsonb_build_object('rules',coalesce(jsonb_agg(private.dashboard_admin_config_pick(r,array[
        'platform_id','rule_id','template_id','title','operator','value','rule_type','enabled','effective_type','effective_channel','effective_type_text','last_seen_at']) order by r->>'rule_id'),'[]'::jsonb)))
      into v_snapshot from jsonb_array_elements(v_legacy->'rules') r where r->>'platform_id'=v_target->>'platform_id' having count(*)>0;
  end if;
  return jsonb_build_object('version',1,'system',v_system,'target',v_target,'snapshot',v_snapshot,'readOnly',true);
end;
$function$;

revoke all on function private.dashboard_admin_live_payout_config(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_payout_config(jsonb) to authenticated;
