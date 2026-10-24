-- LG authorized feed run metadata acquisition; source data and coverage semantics unchanged.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $migration$
declare e record;actual jsonb;before_deps jsonb;after_deps jsonb;before_provider jsonb;after_provider jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='lg_health_batch_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('lg_health_batch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('wg_health_batch_v1',0))then raise exception'lg_health_batch_install_busy';end if;
 for e in select key signature,value metadata from jsonb_each($expected${"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"4663607462d2f1461b90785bec7c88fa","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'lg_health_batch_contract_drift:%',e.signature;end if;end loop;
 if to_regprocedure('private.dashboard_health_feed_timezone(jsonb)')is not null then raise exception'lg_health_batch_helper_exists';end if;
 if to_regprocedure('private.dashboard_health_lg_runs_batch(jsonb,timestamptz,jsonb)')is not null then raise exception'lg_health_batch_helper_exists';end if;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into before_deps from tokens;
 if before_deps is null or(select count(*)from jsonb_each(before_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(before_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(before_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'lg_health_batch_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into before_provider;
 if before_provider is null or exists(select 1 from jsonb_each(before_provider)x where x.value->>'token'is null)then raise exception'lg_health_batch_provider_proof_missing';end if;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_health_feed_timezone(p_feed jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
 select coalesce(nullif(p_feed->>'timezone',''),case p_feed->>'country'
   when '印度' then 'Asia/Kolkata' when '红膏蟹' then 'Asia/Kolkata' when '香港' then 'Asia/Kolkata'
   when '胖虎巴西' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo' when '巴基斯坦' then 'Asia/Karachi'
   when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '越南' then 'Asia/Ho_Chi_Minh'
   when '马来' then 'Asia/Kuala_Lumpur' when '缅甸' then 'Asia/Yangon' when '尼日利亚' then 'Africa/Lagos'
   when '智利' then 'America/Santiago' when '哥伦比亚' then 'America/Bogota' when '墨西哥' then 'America/Mexico_City' end);
$function$;
$definition$;
 alter function private.dashboard_health_feed_timezone(jsonb) owner to postgres;
 revoke all on function private.dashboard_health_feed_timezone(jsonb) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_health_lg_runs_batch(p_feeds jsonb, p_asof timestamptz, p_scope jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
declare targets jsonb;result jsonb;
begin
 with authorized as materialized(
  select f from jsonb_array_elements(p_feeds)f
  where(f->>'dataset'='lg_orders' or(f->>'dataset'='orders' and f->>'system'='lg' and f?'timezone'))
   and private.dashboard_scope_allows(p_scope,f->>'country',f->>'rawPlatform')is true
 ),zoned as materialized(
  select f,private.dashboard_health_feed_timezone(f)zone from authorized
 ),dated as materialized(
  select f,(p_asof at time zone zone)::date today,nullif(f->>'firstDate','')::date first_day
  from zoned where zone is not null
 ),wanted as materialized(
  select distinct f->>'rawCountry'country_code,f->>'rawPlatform'platform,
   case direction when 'charge' then 'recharge' else 'withdraw' end order_kind,
   greatest(today-7,coalesce(first_day,today-7)) first_day,today end_day
  from dated cross join lateral jsonb_array_elements_text(case when jsonb_array_length(coalesce(f->'directions','[]'::jsonb))=0 then '["unknown"]'::jsonb else f->'directions'end)d(direction)
  where direction is distinct from 'unknown' and greatest(today-7,coalesce(first_day,today-7))<today
 )select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb)into targets from wanted w;
 if jsonb_array_length(targets)=0 then return '{}'::jsonb;end if;
 with wanted as materialized(select * from jsonb_to_recordset(targets)w(country_code text,platform text,order_kind text,first_day date,end_day date)),selected as materialized(
  -- One semijoin over run metadata; never scan transaction order details here.
  select t.country_code,t.platform,t.order_kind,t.stat_date,t.observed_at,t.status,t.sync_mode,
   t.expected_count,t.fetched_count,t.published_at
  from public.lg_sync_runs t where exists(select 1 from wanted w
   where w.country_code=t.country_code and w.platform=t.platform and w.order_kind=t.order_kind
    and t.stat_date>=w.first_day and t.stat_date<w.end_day)
 ),latest as(
  select distinct on(country_code,platform,order_kind,stat_date)*,
   count(*)over(partition by country_code,platform,order_kind,stat_date,observed_at)latest_ties
  from selected order by country_code,platform,order_kind,stat_date,observed_at desc
 ),groups as(
  select jsonb_build_array(country_code,platform,order_kind)::text key,
   jsonb_agg(jsonb_build_object('stat_date',stat_date,'status',status,'sync_mode',sync_mode,
    'expected_count',expected_count,'fetched_count',fetched_count,'published_at',published_at,
    'latest_ties',latest_ties)order by stat_date) value
  from latest group by country_code,platform,order_kind
 )select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)into result from groups;
 return result;
end;
$function$;
$definition$;
 alter function private.dashboard_health_lg_runs_batch(jsonb,timestamptz,jsonb) owner to postgres;
 revoke all on function private.dashboard_health_lg_runs_batch(jsonb,timestamptz,jsonb) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_sync_health_rows(p_asof timestamp with time zone)
 RETURNS TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_feeds jsonb;v_feed jsonb;v_direction text;v_day date;v_today date;v_start timestamptz;v_end timestamptz;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_key text;v_kind text;v_zone text;v_launch timestamptz;v_seen timestamptz;v_has boolean;v_run record;v_lg_runs jsonb;v_lg_all_runs jsonb;v_wg_runs jsonb;v_wg_sites jsonb;v_first date;v_feed_keys text[]:=array[]::text[];v_feed_key text;
begin
 -- The catalog already normalizes Panghu and enforces account scope. Do not
 -- consult lastDate to infer day coverage; every returned day is checked below.
 select coalesce(jsonb_agg(f),'[]'::jsonb) into v_feeds from jsonb_array_elements(coalesce(private.dashboard_collected_data_core('{"operation":"catalog"}'::jsonb,false)->'rows','[]'::jsonb)) f where f->>'dataset'<>'orders'
  and not (f->>'dataset'='lg_orders' and exists (
    select 1 from private.dashboard_admin_live_platforms() p where p.source='lg'
      and p.scope_group=f->>'rawCountry' and p.source_name=f->>'rawPlatform'));
 -- Platform registration defines expected order directions even if neither has arrived.
 select coalesce(jsonb_agg(jsonb_build_object('dataset','orders','system',p.source,'platformId',p.id,'name',p.name,'team',p.team,
  'country',p.country,'rawCountry',p.scope_group,'rawPlatform',p.source_name,'timezone',p.timezone,'directions',jsonb_build_array('charge','withdraw'),
  'provenance',jsonb_build_object('kind','direct'))),'[]'::jsonb)||v_feeds into v_feeds
 from private.dashboard_admin_live_platforms()p;
 -- Configured targets remain monitored even before their first snapshot arrives.
 select coalesce(jsonb_agg(jsonb_build_object('dataset',q.kind,'system',q.system,'name',q.platform,'team',case when q.display_country='胖虎巴西' then '胖虎' else '待归类' end,
  'country',q.display_country,'rawCountry',q.country_code,'rawPlatform',q.platform,'timezone',q.timezone,'directions','[]'::jsonb,'healthTarget',true,
  'provenance',jsonb_build_object('kind','direct'))),'[]'::jsonb)||v_feeds into v_feeds from (
   select t.*,private.dashboard_admin_live_report_country(t.country_name,t.platform) display_country from (
    select 'ar_config'::text kind,coalesce(a.source_system,'AR') system,a.country_code,a.country_name,a.platform,a.timezone from public.ar_config_targets a
    union all select 'panda_config','PANDA',a.country_code,a.country_name,a.platform,a.timezone from public.panda_config_targets a
    union all select 'wg_config','WG',a.country_code,a.country_name,a.platform,a.timezone from public.wg_config_targets a
   )t
  )q where private.dashboard_scope_allows(v_scope,q.display_country,q.platform);
 -- Automatic withdrawal is a separate report feed, not transaction orders.
 select coalesce(jsonb_agg(jsonb_build_object('dataset','auto_report','system','REPORT','name',q.platform,'team',case when q.country='胖虎巴西' then '胖虎' else '待归类' end,
  'country',q.country,'rawCountry',q.raw_country,'rawPlatform',q.platform,'firstDate',q.first_date,'directions',jsonb_build_array('withdraw'),
  'provenance',jsonb_build_object('kind','unknown'))),'[]'::jsonb)||v_feeds into v_feeds from (
   select a.country raw_country,private.dashboard_admin_live_report_country(a.country,a.platform) country,a.platform,min(a.data_date) first_date
    from public.auto_withdraw_daily a where a.data_date>=(p_asof at time zone 'UTC')::date-35
     and private.dashboard_scope_allows(v_scope,private.dashboard_admin_live_report_country(a.country,a.platform),a.platform)
    group by a.country,a.platform
  )q;
 -- Only authorized LG feeds are acquired, once for both directions and all seven days.
 v_lg_all_runs:=private.dashboard_health_lg_runs_batch(v_feeds,p_asof,v_scope);
 for v_feed in select distinct x from jsonb_array_elements(private.dashboard_admin_wg_current_feeds(v_feeds))x where x->>'dataset' in
  ('orders','volume','panda_success','lg_success','lg_orders','collection_success','newar_third_party_volume','ar_config','panda_config','wg_config','game66_config','auto_report')
  and (x->>'dataset'<>'orders' or x ? 'timezone') and (x->>'dataset' not in('ar_config','panda_config','wg_config') or x ? 'healthTarget') loop
  dataset:=v_feed->>'dataset';platform:=v_feed->>'name';team:=coalesce(v_feed->>'team','待归类');country:=v_feed->>'country';
  v_raw_country:=v_feed->>'rawCountry';v_raw_platform:=v_feed->>'rawPlatform';source_system:=v_feed->>'system';
  source_kind:=coalesce(v_feed#>>'{provenance,kind}','unknown');platform_id:=nullif(v_feed->>'platformId','')::uuid;v_platform_id:=platform_id;v_source:=source_system;
  if private.dashboard_scope_allows(v_scope,country,v_raw_platform) is not true then continue;end if;
  if dataset='game66_config' then v_feed_key:=jsonb_build_array(dataset,v_raw_country,v_raw_platform,source_system,source_kind)::text;if v_feed_key=any(v_feed_keys) then continue;end if;v_feed_keys:=array_append(v_feed_keys,v_feed_key);timezone:='Asia/Kolkata';data_date:=null;direction:='config';status:='unverified';received:=false;evidence:='configuration_history_unavailable';last_received_at:=null;return next;continue;end if;
  v_zone:=private.dashboard_health_feed_timezone(v_feed);
  timezone:=v_zone;
  if v_zone is null then v_feed_key:=jsonb_build_array(dataset,v_raw_country,v_raw_platform,source_system,source_kind,'timezone_unknown')::text;if v_feed_key=any(v_feed_keys) then continue;end if;v_feed_keys:=array_append(v_feed_keys,v_feed_key);data_date:=null;direction:=null;status:='unverified';received:=false;evidence:='source_timezone_unknown';last_received_at:=null;return next;continue;end if;
  v_today:=(p_asof at time zone v_zone)::date;v_first:=nullif(v_feed->>'firstDate','')::date;v_launch:=null;
  if dataset='orders' and source_system='newar' then
   select n.launch_at into v_launch from public.newar_detail_platforms n where n.platform=v_raw_platform and n.country_code=v_raw_country and n.enabled and (n.launch_at is null or n.launch_at<=p_asof);
   if not found then continue;end if;
   if v_launch is not null then v_first:=greatest(v_first,(v_launch at time zone v_zone)::date);end if;
  end if;
  for v_direction in select value from jsonb_array_elements_text(case when dataset in('ar_config','panda_config','wg_config') then '["config"]'::jsonb when jsonb_array_length(coalesce(v_feed->'directions','[]'::jsonb))=0 then '["unknown"]'::jsonb else v_feed->'directions' end) loop
   v_feed_key:=jsonb_build_array(dataset,v_raw_country,v_raw_platform,source_system,source_kind,v_direction)::text;
   if v_feed_key=any(v_feed_keys) then continue;end if;v_feed_keys:=array_append(v_feed_keys,v_feed_key);
   direction:=v_direction;if v_direction='unknown' then data_date:=null;status:='unverified';received:=false;evidence:='source_direction_unknown';last_received_at:=null;return next;continue;end if;v_kind:=case v_direction when 'charge' then 'recharge' else 'withdraw' end;
   v_lg_runs:=null;v_wg_runs:=null;
   if dataset='orders' and source_system='wg' then
    select jsonb_agg(s.site_code)into v_wg_sites from private.dashboard_admin_wg_sites()s
     where s.country_code=v_raw_country and s.platform=v_raw_platform;
    -- Preserve the original daily selection if registry mapping is ambiguous.
    if jsonb_array_length(v_wg_sites)=1 and greatest(v_today-7,coalesce(v_first,v_today-7))<v_today then
     v_wg_runs:=private.dashboard_health_wg_evidence_batch(v_wg_sites->>0,v_kind,greatest(v_today-7,coalesce(v_first,v_today-7)),v_today-1);
    end if;
   end if;
   if dataset='lg_orders' or (dataset='orders' and source_system='lg') then
    v_lg_runs:=v_lg_all_runs->jsonb_build_array(v_raw_country,v_raw_platform,v_kind)::text;
   end if;
   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop
    data_date:=v_day;v_start:=v_day::timestamp at time zone v_zone;v_end:=(v_day+1)::timestamp at time zone v_zone;
    v_has:=false;v_seen:=null;status:='not_received';evidence:=case when v_direction='config' then 'no_daily_configuration_snapshot' when dataset='orders' or dataset='lg_orders' then 'no_created_orders_received' else 'no_daily_report_received' end;
    -- WG_EXISTING_FEEDS_V1
    if dataset='orders' and source_system='wg' then
     if v_wg_runs is not null then select v_wg_runs->v_day::text as value into v_run;else
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
     end if;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=case when (v_run.value->>'complete')::boolean then 'received' when (v_run.value->>'received')::boolean or (v_run.value->>'hasWindow')::boolean then 'unverified' else 'not_received' end;
     evidence:=v_run.value->>'evidence';
    elsif dataset='orders' and source_system='ar' then
     select true,a.updated_at into v_has,v_seen from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR'
      and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;
    elsif dataset='orders' and source_system='newar' then
     select true,n.received_at into v_has,v_seen from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.created_at>=greatest(v_start,coalesce(v_launch,v_start)) and n.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.status_group='success' and n.success_at>=v_start and n.success_at<v_end and n.created_at>=coalesce(v_launch,'-infinity'::timestamptz)) then evidence:='only_success_day_records_received';end if;
    elsif dataset='orders' and source_system='game66' then
     if v_direction='charge' then select true,g.last_seen_at into v_has,v_seen from public.game66_charge_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;
     else select true,g.last_seen_at into v_has,v_seen from public.game66_withdraw_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;end if;
     select r.status,r.finished_at,r.rows_fetched into v_run from public.game66_sync_runs r where r.platform_id=v_platform_id and r.data_type=v_direction and r.window_start<=v_start and r.window_end>=v_end-interval '1 second' order by r.started_at desc limit 1;
     if found then
      if v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      elsif v_run.status='running' then status:='pending';evidence:='source_task_not_finished';
      elsif v_run.status='succeeded' then v_has:=true;v_seen:=v_run.finished_at;evidence:=case when v_run.rows_fetched=0 then 'source_completed_zero_rows' else 'source_day_task_completed' end;end if;
     end if;
    elsif dataset='volume' then
     select true,t.updated_at into v_has,v_seen from public.third_party_volume t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and t.quarantined_at is null
      and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end)
      and case source_kind when 'google_sheets' then t.sheet_name like '[三方量表%]%' when 'direct' then (v_source='AR' and t.sheet_name like 'AR_DIRECT%') or (v_source='LG' and t.sheet_name like 'LG_DIRECT%') else coalesce(t.sheet_name,'') not like '[三方量表%]%' and coalesce(t.sheet_name,'') not like 'AR_DIRECT%' and coalesce(t.sheet_name,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='panda_success' then
     select true,t.updated_at into v_has,v_seen from public.panda_success_rate_daily t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end) limit 1;
    elsif dataset='lg_success' then
     select true,coalesce(t.observed_at,t.updated_at) into v_has,v_seen from public.lg_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.order_kind=v_kind limit 1;
    elsif dataset='lg_orders' or (dataset='orders' and source_system='lg') then
     select true,t.updated_at into v_has,v_seen from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.created_at>=v_start and t.created_at<v_end limit 1;
     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at,t.latest_ties into v_run
      from jsonb_to_recordset(coalesce(v_lg_runs,'[]'::jsonb)) t(stat_date date,status text,sync_mode text,expected_count bigint,fetched_count bigint,published_at timestamptz,latest_ties bigint)
      where t.stat_date=v_day;
     -- Preserve the original undefined tie choice with its exact daily query.
     if found and v_run.latest_ties>1 then
      select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;
     end if;
     if found then
      if v_run.status='published' and v_run.sync_mode='full' and v_run.expected_count=v_run.fetched_count then v_has:=true;v_seen:=v_run.published_at;evidence:=case when v_run.expected_count=0 then 'source_completed_zero_rows' else 'source_day_task_completed' end;
      elsif v_run.status='collecting' then status:='pending';evidence:='source_task_not_finished';
      elsif v_run.status='live' then status:='pending';evidence:='source_full_day_not_published';
      elsif v_run.status='superseded' then status:='unverified';evidence:='source_snapshot_superseded';end if;
     end if;
    elsif dataset='collection_success' then
     select true,coalesce(t.snapshot_at,t.updated_at) into v_has,v_seen from public.collection_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.source_system=v_source limit 1;
    elsif dataset='newar_third_party_volume' then
     select true,coalesce(t.captured_at,t.updated_at) into v_has,v_seen from public.newar_business_snapshots t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.kind='third_party_volume' and t.direction=v_direction limit 1;
    elsif dataset='auto_report' then
     select true,coalesce(t.source_updated_at,t.updated_at) into v_has,v_seen from public.auto_withdraw_daily t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day limit 1;
    elsif dataset='ar_config' then
     select true,t.received_at into v_has,v_seen from public.ar_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='panda_config' then
     select true,t.received_at into v_has,v_seen from public.panda_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='wg_config' then
     
     select true,t.received_at into v_has,v_seen from (
      select c.observed_at received_at from public.wg_realtime_config_daily c
      join private.dashboard_admin_wg_sites()s on s.country_code=c.country_code
       and c.site_code=case s.country_code when 'BR' then '278' else '3257' end
      where s.country_code=v_raw_country and s.platform=v_raw_platform and c.observed_local_date=v_day
      union all
      select c.received_at from public.wg_config_daily c
      where c.country_code=v_raw_country and c.platform=v_raw_platform and c.observed_local_date=v_day
     )t order by t.received_at desc limit 1;
    else status:='unverified';evidence:='unsupported_source';end if;
    received:=coalesce(v_has,false);last_received_at:=v_seen;
    if received and status='not_received' then status:='received';if evidence not in('source_completed_zero_rows','source_day_task_completed') then evidence:='records_received_completeness_unverified';end if;end if;
    return next;
   end loop;
  end loop;
 end loop;
end;$function$
$definition$;
 for e in select key signature,value metadata from jsonb_each($expected${"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"0450b8dc45173e9e9f8448e9874146b7","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_health_feed_timezone(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_feed jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"b93b6ea79a3f385cef423ca3181d9b19","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.dashboard_health_lg_runs_batch(jsonb,timestamptz,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_feeds jsonb, p_asof timestamp with time zone, p_scope jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"b170d50e48fefb7b67f7fcd8abcd3ca4","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'lg_health_batch_contract_drift:%',e.signature;end if;end loop;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into after_deps from tokens;
 if after_deps is null or(select count(*)from jsonb_each(after_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(after_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(after_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'lg_health_batch_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into after_provider;
 if after_provider is null or exists(select 1 from jsonb_each(after_provider)x where x.value->>'token'is null)then raise exception'lg_health_batch_provider_proof_missing';end if;
 if before_deps is distinct from after_deps or before_provider is distinct from after_provider then raise exception'lg_health_batch_dependency_changed';end if;
 perform set_config('audit.lg_health_batch',jsonb_build_object('contract','lg-health-batch-v1','unchangedTokens',(select count(*)from jsonb_each(after_deps)),'providerTargets',(select count(*)from jsonb_each(after_provider)),'sourceRowsWritten',false,'queueWrites',false,'rollback',false)::text,true);
end;$migration$;
select current_setting('audit.lg_health_batch')::jsonb receipt;
commit;
