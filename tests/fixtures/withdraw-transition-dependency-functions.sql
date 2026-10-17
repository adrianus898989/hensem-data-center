CREATE OR REPLACE FUNCTION private.dashboard_data_group(p_country text, p_platform text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_trim text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_country text := upper(btrim(regexp_replace(btrim(coalesce(p_country,''),v_trim), '盘口$', ''),v_trim));
  v_platform text := upper(btrim(coalesce(p_platform,''),v_trim));
  v_group text;
begin
  v_group := case
    when v_country = any(array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT','HK_TEAM','RED_CRAB']) then v_country
    when v_country = any(array['香港','HONG KONG','HONG_KONG']) then 'HK_TEAM'
    when v_country = any(array['红膏蟹','紅膏蟹','RED CRAB']) then 'RED_CRAB'
    when v_country = any(array['巴西','BRAZIL']) then 'BR'
    when v_country = any(array['胖虎巴西','PANGHU BRAZIL']) then 'BR_PANGHU'
    when v_country = any(array['印度','印度线下','INDIA']) then 'IN'
    when v_country = any(array['巴基斯坦','PAKISTAN']) then 'PK'
    when v_country = any(array['印尼','印度尼西亚','INDONESIA']) then 'ID'
    when v_country = any(array['越南','VIETNAM']) then 'VN'
    when v_country = any(array['菲律宾','PHILIPPINES']) then 'PH'
    when v_country = any(array['马来','马来西亚','MALAYSIA']) then 'MY'
    when v_country = any(array['缅甸','MYANMAR']) then 'MM'
    when v_country = any(array['尼日利亚','NIGERIA']) then 'NG'
    when v_country = any(array['哥伦比亚','COLOMBIA']) then 'CO'
    when v_country = any(array['墨西哥','MEXICO']) then 'MX'
    when v_country = any(array['智利','CHILE']) then 'CL'
    when v_country = any(array['南美','SOUTH AMERICA']) then 'SA'
    when v_country = '巴西原生' then 'BR_NATIVE'
    when v_country = any(array['USDT通道','USDT 通道']) then 'USDT'
    else '' end;
  if v_group = 'SA' then
    v_group := case v_platform when 'NPG-CHILE' then 'CL' when 'NPG-COLOMBIA' then 'CO'
      when 'NPG-MEXICO' then 'MX' else v_group end;
  end if;
  if v_group in ('BR','BR_PANGHU') then
    v_platform := case v_platform when 'FF55' then 'FF555' when '222VIP.COM' then '222VIP'
      when '222-VIP' then '222VIP' when '67-VIP' then '67VIP' else v_platform end;
    if v_platform = any(array[
      'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR','8599BET','9596BET','8566BET',
      '5V555','58EE','27FF','222O','32QQ','67VIP','222VIP','345F','234T','888HH','BET5697',
      '96F','45FF','76PP','56L','559K','2V222','776F','5C555'
    ]) then return 'BR_PANGHU'; end if;
    if v_platform = any(array['POPNOV','POPFEZ','POPCRA']) then return 'BR'; end if;
  end if;
  return v_group;
end;
$function$;

CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_token(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')='IN') categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')='IN') blockers)
  ),
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$function$;

CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency_common(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')=p_scope) categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')=p_scope) blockers)
  )
 )::text);
$function$;

CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency(p_target jsonb, p_common text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object('common',p_common,
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$function$;

CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.prepared_aggregate_dependency(p_target,private.prepared_aggregate_dependency_common(case when p_target->>'source'='game66'then'IN'else p_target->>'scope_group'end));$function$;

