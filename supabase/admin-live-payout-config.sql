-- Read-only mirror of the existing automatic-payout configuration sources.
-- Requires admin-live-query.sql. No source data, old RPC or policy is changed.
begin;

create function private.dashboard_admin_config_safe_json(p_value jsonb,p_depth integer default 0)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb; v_text text;
begin
  if p_value is null then return null; end if;
  if p_depth>16 then return 'null'::jsonb; end if;
  if jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(e.key,private.dashboard_admin_config_safe_json(e.value,p_depth+1)),'{}'::jsonb)
      into v_result from jsonb_each(p_value) e
    where e.key !~* '(token|password|secret|cookie|authorization|credential|session|api.?key|url|uri|endpoint|headers?)'
      and lower(regexp_replace(e.key,'[^A-Za-z]','','g'))<>all(array[
        'raw','rawpayload','rawconfig','host','hostname','baseaddress','phone','phonenumber','mobilenumber',
        'bankaccount','bankaccountnumber','accountnumber','cardnumber','upi','upiid','email','emailaddress']);
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.dashboard_admin_config_safe_json(a.value,p_depth+1) order by a.ordinality),'[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality a;
    return v_result;
  elsif jsonb_typeof(p_value)='string' then
    v_text:=p_value#>>'{}';
    if v_text ~* '([a-z][a-z0-9+.-]*://|Bearer[[:space:]]+|ASP[.]NET_SessionId|__RequestVerificationToken|caipiao[.]NewAdmin|eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|(^|[[:space:][:punct:]])(token|password|secret|authorization|api[_-]?key)[[:space:]]*[:=])' then
      return 'null'::jsonb;
    end if;
  end if;
  return p_value;
end;
$$;
revoke all on function private.dashboard_admin_config_safe_json(jsonb,integer) from public,anon,authenticated;

create function private.dashboard_admin_config_pick(p_object jsonb,p_keys text[])
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(e.key,private.dashboard_admin_config_safe_json(e.value)),'{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_object)='object' then p_object else '{}'::jsonb end) e
  where e.key=any(p_keys);
$$;
revoke all on function private.dashboard_admin_config_pick(jsonb,text[]) from public,anon,authenticated;

create function private.dashboard_admin_config_projection(p_system text,p_config jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb; v_fields jsonb; v_groups jsonb; v_keys text[];
begin
  if p_system in ('AR','NEW_AR') then
    v_keys:=case when p_system='AR' then array[
      'autoWithdraw','withdrawAmount','totalLoss','withdrawTimes','grandWithdrawTotal','todayProfitAmount',
      'manualRechargeAmount','bonusRechargeAmount','accountBalance','firstDepositAmount','sameDeviceAccountCount',
      'dayWithdrawLimit','lastRechargeDayLimit','isOpenAgentRedLimit','maxRedRechargeRate','receiveRedSumAmount',
      'lastRechgRecvReadSumAmount','allowvirtualwithdraw','betTurnoverMultiple','isOpenRevisitPoorProfit',
      'revisitPoorProfitAmount','firstRecharge','checkRemark','limitGroup','isAutoPayment','isCurrencyLimit',
      'isBankCardToArPay','isGameNegativeProfitLimit'] else array[
      'autoWithdraw','ruleEnabled','withdrawAmount','todayProfitAmount','manualRechargeAmount','bonusRechargeAmount',
      'accountBalance','firstDepositAmount','sameDeviceAccountCount','dayWithdrawLimit','lastRechargeDayLimit'] end;
    select coalesce(jsonb_agg(private.dashboard_admin_config_pick(f.value,array['key','kind','value','label','description','available','read_only'])
      order by f.ordinality),'[]'::jsonb) into v_fields
    from jsonb_array_elements(case when jsonb_typeof(p_config->'fields')='array' then p_config->'fields' else '[]'::jsonb end) with ordinality f
    where f.value->>'key'=any(v_keys);
    v_result:=jsonb_build_object('fields',v_fields);
    if p_system='AR' then
      select coalesce(jsonb_agg(jsonb_build_object('key',g.value->'key','options',(
        select coalesce(jsonb_agg(private.dashboard_admin_config_pick(o.value,array['value','label','selected']) order by o.ordinality),'[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(g.value->'options')='array' then g.value->'options' else '[]'::jsonb end) with ordinality o
      )) order by g.ordinality),'[]'::jsonb) into v_groups
      from jsonb_array_elements(case when jsonb_typeof(p_config->'groups')='array' then p_config->'groups' else '[]'::jsonb end) with ordinality g
      where g.value->>'key' in ('userGroups','gameTypes');
      return v_result||jsonb_build_object('groups',v_groups);
    end if;
    v_result:=v_result||jsonb_build_object('channels',(
      select coalesce(jsonb_agg(private.dashboard_admin_config_pick(c.value,array['id','channelName','channelType']) order by c.ordinality),'[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(p_config->'channels')='array' then p_config->'channels' else '[]'::jsonb end) with ordinality c
    ),'channelRules',(
      -- Only these two business keys are present in the reviewed source rules.
      -- No arbitrary dynamic columns, channel URLs, account or contact fields.
      select coalesce(jsonb_agg(private.dashboard_admin_config_pick(r.value,array['id','name']) order by r.ordinality),'[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(p_config->'channelRules')='array' then p_config->'channelRules' else '[]'::jsonb end) with ordinality r
    ));
    if jsonb_typeof(p_config->'settingGroups')='array' then
      select coalesce(jsonb_agg(private.dashboard_admin_config_pick(g.value,array[
        'id','configName','configState','allowVirtualWithdraw','maxWithdrawAmount','maxWithdrawTime','grandWithdrawTotal',
        'maxWithdrawRechargeRate','needFirstRecharge','needUserNoRemark','needLimitGroup','limitGroup','dayProfitAmount',
        'manualRechargeOf3Day','bonusRechargeOf3Day','balance','firstDepositAmount','sameDeviceRegistCount',
        'allowInvitedWheelAutoWithdraw','sameIpRegistCount','sameBankAccountCount','checkRejectPackage','rejectPackageIds',
        'totalRechargeAmountOpreationType','totalRechargeAmount','checkLowOddsOrderRatio','lowOdds','lowOddsOrderRatio',
        'checkRiskList','checkBlackListUserIdAndIp','totalWinLoseAmount','autoWithdrawFailCount','totalCodingAmountMultiple',
        'totalCodingAmountMultipleWithBonus','allowPackageIds','isDefaultConfig']) order by g.ordinality),'[]'::jsonb) into v_groups
      from jsonb_array_elements(p_config->'settingGroups') with ordinality g;
      v_result:=v_result||jsonb_build_object('settingGroups',v_groups);
    end if;
    return v_result;
  elsif p_system='PANDA' then
    v_keys:=array['autoWithdrawalSwitch','autoWithdrawalAmountMix','autoWithdrawalAmountMax','autoRefuseSwitch',
      'autoWithdrawalLimitType','autoWithdrawalLimitAmount','autoWithdrawalLimitLevel','autoWithdrawLimitRegTime',
      'autoWithdrawLimitOther','autoWithdrawDailyLimit','autoWithdrawManualRechargeLimit','autoWithdrawManualGiftLimit',
      'successRateType','orderVolume','minSuccessRate','autoWithdrawalChannel','auditGameLimit','withdrawSwitch',
      'rechargeMultiple','rewardMultiple','auditAutoRelieve','autoWithdrawalLimitSwitch','autoWithdrawalPollingSwitch',
      'auditAutoRelieveType','auditLevelMode','levelMultiples'];
    return jsonb_build_object('values',private.dashboard_admin_config_pick(p_config->'values',v_keys),'unavailable_fields',(
      select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(p_config->'unavailable_fields')='array' then p_config->'unavailable_fields' else '[]'::jsonb end) with ordinality x
      where x.value#>>'{}'=any(v_keys)
    ));
  elsif p_system='WG' then
    select coalesce(jsonb_object_agg(s.key,private.dashboard_admin_config_pick(s.value,array[
      'exemptSwitch','unavoidableCauseRemarkSwitch','levelIds','tagIds','registerTime','requiredLevelIds','requiredTagIds',
      'requiredRegisterTime','noRequiredTagIds','otherCondition','exemptAmountList','otherConditionV2','PIXCondition',
      'exemptMemberLevelAmount','mustBeReviewedAmountList','mustBeReviewedMemberLevelAmountList','reviewBankCodeList','betGameLimit'])),'{}'::jsonb)
      into v_groups from jsonb_each(case when jsonb_typeof(p_config->'settings')='object' then p_config->'settings' else '{}'::jsonb end) s
      where s.key ~ '^[0-9]{1,16}$';
    return jsonb_build_object('settings',v_groups,
      'dictionaries',private.dashboard_admin_config_pick(p_config->'dictionaries',array['levels','tags','activities','withdraw_types','merchants']),
      'completeness',private.dashboard_admin_config_pick(p_config->'completeness',array['available','unavailable']));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function private.dashboard_admin_config_projection(text,jsonb) from public,anon,authenticated;

create function private.dashboard_admin_live_payout_config(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
$$;
revoke all on function private.dashboard_admin_live_payout_config(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_payout_config(jsonb) to authenticated;

create function public.dashboard_admin_live_payout_config(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_payout_config(p_request);
$$;
revoke all on function public.dashboard_admin_live_payout_config(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_payout_config(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
