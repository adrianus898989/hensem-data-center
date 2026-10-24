-- WG seven-day health acquisition. Source data, coverage view, queue, and heads unchanged.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $migration$
declare e record;actual jsonb;before_deps jsonb;after_deps jsonb;before_provider jsonb;after_provider jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='wg_health_batch_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('wg_health_batch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('withdraw_submitted_success_v1',0))then raise exception'wg_health_batch_install_busy';end if;
 for e in select key signature,value metadata from jsonb_each($expected${"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"a3463e9ff2d11889308f2ba94b51849d","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_admin_wg_day_evidence(text,text,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"ddbf8cae0223fec61ac59f81b60dce14","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"61ee836c04220a9253be224e57e1753b","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"91f691832a3ae3037e9e3a45f72a0ec8","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"4db4f03172830c0ba7d80e8a4de8c448","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_withdraw_status_dependency_md5(pg_proc)":{"acl":"{postgres=X/postgres}","args":"p pg_proc","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"3493a92bd119432165cc8587ee18e3a6","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_wg_sites()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)","strict":false,"bodyMd5":"839401f31117192068b395d1c9580230","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'wg_health_batch_contract_drift:%',e.signature;end if;end loop;
 if md5(pg_get_viewdef('public.wg_detail_coverage'::regclass,true))is distinct from 'c61680ef307637de0cafb1bdd54a92b5'then raise exception'wg_health_batch_coverage_contract_drift';end if;
 if to_regprocedure('private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)')is not null then raise exception'wg_health_batch_helper_exists';end if;
 if to_regprocedure('private.dashboard_health_wg_evidence_batch(text,text,date,date)')is not null then raise exception'wg_health_batch_helper_exists';end if;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into before_deps from tokens;
 if before_deps is null or(select count(*)from jsonb_each(before_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(before_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(before_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'wg_health_batch_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into before_provider;
 if before_provider is null or exists(select 1 from jsonb_each(before_provider)x where x.value->>'token'is null)then raise exception'wg_health_batch_provider_proof_missing';end if;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_health_wg_evidence_format(n bigint, seen timestamptz, covered boolean, has_window boolean, hi timestamptz, asof timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
begin
 -- Only fully acknowledged creation windows certify a complete day, even zero.
 covered:=covered and hi<=asof;
 return jsonb_build_object('received',n>0 or covered,'count',n,'complete',covered,'hasWindow',has_window,
  'zeroConfirmed',covered and n=0,'seen',seen,
  'status',case when covered and n=0 then 'zero_complete' when covered then 'complete' when n>0 or has_window then 'partial' else 'not_received' end,
  'evidence',case when covered and n=0 then 'source_completed_zero_rows' when covered then 'source_day_task_completed'
   when n>0 or has_window then 'source_full_day_not_published' else 'no_created_orders_received' end);
end;$function$;
$definition$;
 alter function private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz) owner to postgres;
 revoke all on function private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_health_wg_evidence_batch(p_site text, p_business text, p_from date, p_to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare s record;lo timestamptz;hi timestamptz;result jsonb;
begin
 -- Internal, bounded acquisition for the already-authorized health feed.
 select * into s from private.dashboard_admin_wg_sites()where site_code=p_site;
 if not found or p_business is null or p_business not in('recharge','withdraw')or p_from is null or p_to is null
  or not isfinite(p_from)or not isfinite(p_to)or p_to<p_from or p_to-p_from>6 then raise exception'invalid_wg_batch_scope';end if;
 lo:=p_from::timestamp at time zone s.timezone;hi:=(p_to+1)::timestamp at time zone s.timezone;
 if p_business='recharge'then
 with facts as materialized(
   select (w.created_at at time zone s.timezone)::date d,count(*) n,max(w.stored_at) seen
   from public.wg_recharge_details w where w.site_code=p_site and w.created_at>=lo and w.created_at<hi
   group by (w.created_at at time zone s.timezone)::date
  ),coverage as materialized(
   select business_date d,coalesce(bool_or(complete),false) covered,count(*)>0 has_window
   from public.wg_detail_coverage where site_code=p_site and business=p_business and basis='created'
    and business_date>=p_from and business_date<=p_to group by business_date
  ),days as(select p_from+i d from generate_series(0,p_to-p_from)i)
  select jsonb_object_agg(d.d::text,private.dashboard_health_wg_evidence_format(coalesce(f.n,0),f.seen,
    coalesce(c.covered,false),coalesce(c.has_window,false),(d.d+1)::timestamp at time zone s.timezone,statement_timestamp())order by d.d)
   into result from days d left join facts f on f.d=d.d left join coverage c on c.d=d.d;
 else
 with facts as materialized(
   select (w.created_at at time zone s.timezone)::date d,count(*) n,max(w.stored_at) seen
   from public.wg_withdraw_details w where w.site_code=p_site and w.created_at>=lo and w.created_at<hi
   group by (w.created_at at time zone s.timezone)::date
  ),coverage as materialized(
   select business_date d,coalesce(bool_or(complete),false) covered,count(*)>0 has_window
   from public.wg_detail_coverage where site_code=p_site and business=p_business and basis='created'
    and business_date>=p_from and business_date<=p_to group by business_date
  ),days as(select p_from+i d from generate_series(0,p_to-p_from)i)
  select jsonb_object_agg(d.d::text,private.dashboard_health_wg_evidence_format(coalesce(f.n,0),f.seen,
    coalesce(c.covered,false),coalesce(c.has_window,false),(d.d+1)::timestamp at time zone s.timezone,statement_timestamp())order by d.d)
   into result from days d left join facts f on f.d=d.d left join coverage c on c.d=d.d;
 end if;
 return result;
end;$function$;
$definition$;
 alter function private.dashboard_health_wg_evidence_batch(text,text,date,date) owner to postgres;
 revoke all on function private.dashboard_health_wg_evidence_batch(text,text,date,date) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_day_evidence(p_site text, p_business text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; lo timestamptz; hi timestamptz; n bigint; seen timestamptz; covered boolean; has_window boolean;
begin
 select * into s from private.dashboard_admin_wg_sites() where site_code=p_site;
 if not found or p_business not in('recharge','withdraw') then raise exception 'invalid_wg_scope';end if;
 lo:=p_date::timestamp at time zone s.timezone;hi:=(p_date+1)::timestamp at time zone s.timezone;
 if p_business='recharge' then
  select count(*),max(stored_at) into n,seen from public.wg_recharge_details where site_code=p_site and created_at>=lo and created_at<hi;
 else
  select count(*),max(stored_at) into n,seen from public.wg_withdraw_details where site_code=p_site and created_at>=lo and created_at<hi;
 end if;
 select coalesce(bool_or(complete),false),count(*)>0 into covered,has_window from public.wg_detail_coverage
  where site_code=p_site and business=p_business and basis='created' and business_date=p_date;
 return private.dashboard_health_wg_evidence_format(n,seen,covered,has_window,hi,statement_timestamp());
end;$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_sync_health_rows(p_asof timestamp with time zone)
 RETURNS TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_feeds jsonb;v_feed jsonb;v_direction text;v_day date;v_today date;v_start timestamptz;v_end timestamptz;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_key text;v_kind text;v_zone text;v_launch timestamptz;v_seen timestamptz;v_has boolean;v_run record;v_lg_runs jsonb;v_wg_runs jsonb;v_wg_sites jsonb;v_first date;v_feed_keys text[]:=array[]::text[];v_feed_key text;
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
 for v_feed in select distinct x from jsonb_array_elements(private.dashboard_admin_wg_current_feeds(v_feeds))x where x->>'dataset' in
  ('orders','volume','panda_success','lg_success','lg_orders','collection_success','newar_third_party_volume','ar_config','panda_config','wg_config','game66_config','auto_report')
  and (x->>'dataset'<>'orders' or x ? 'timezone') and (x->>'dataset' not in('ar_config','panda_config','wg_config') or x ? 'healthTarget') loop
  dataset:=v_feed->>'dataset';platform:=v_feed->>'name';team:=coalesce(v_feed->>'team','待归类');country:=v_feed->>'country';
  v_raw_country:=v_feed->>'rawCountry';v_raw_platform:=v_feed->>'rawPlatform';source_system:=v_feed->>'system';
  source_kind:=coalesce(v_feed#>>'{provenance,kind}','unknown');platform_id:=nullif(v_feed->>'platformId','')::uuid;v_platform_id:=platform_id;v_source:=source_system;
  if private.dashboard_scope_allows(v_scope,country,v_raw_platform) is not true then continue;end if;
  if dataset='game66_config' then v_feed_key:=jsonb_build_array(dataset,v_raw_country,v_raw_platform,source_system,source_kind)::text;if v_feed_key=any(v_feed_keys) then continue;end if;v_feed_keys:=array_append(v_feed_keys,v_feed_key);timezone:='Asia/Kolkata';data_date:=null;direction:='config';status:='unverified';received:=false;evidence:='configuration_history_unavailable';last_received_at:=null;return next;continue;end if;
  v_zone:=coalesce(nullif(v_feed->>'timezone',''),case country
   when '印度' then 'Asia/Kolkata' when '红膏蟹' then 'Asia/Kolkata' when '香港' then 'Asia/Kolkata'
   when '胖虎巴西' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo' when '巴基斯坦' then 'Asia/Karachi'
   when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '越南' then 'Asia/Ho_Chi_Minh'
   when '马来' then 'Asia/Kuala_Lumpur' when '缅甸' then 'Asia/Yangon' when '尼日利亚' then 'Africa/Lagos'
   when '智利' then 'America/Santiago' when '哥伦比亚' then 'America/Bogota' when '墨西哥' then 'America/Mexico_City' end);
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
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_lg_runs from (
     select distinct on(t.stat_date) t.stat_date,t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at,
      count(*) over(partition by t.stat_date,t.observed_at) latest_ties
     from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind
      and t.stat_date>=v_today-7 and t.stat_date<v_today and (v_first is null or t.stat_date>=v_first)
     order by t.stat_date,t.observed_at desc
    )r;
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
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_withdraw_status_dependency_md5(p pg_proc)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE actual jsonb; formatter jsonb; expected jsonb; callsite text; self_hash text;
BEGIN
 IF NOT coalesce(p.oid=ANY(ARRAY[to_regprocedure('private.dashboard_admin_wg_day_evidence(text,text,date)'),to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'),to_regprocedure('private.prepared_aggregate_dependency_common(text)'),to_regprocedure('private.provider_snapshot_dependency_token(jsonb)')]),false)THEN RETURN md5(p.prosrc);END IF;
 actual:=jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid));
 -- The WG day reader only delegates its unchanged final JSON decisions.
 -- All source acquisition is byte-identical; pin its one shared formatter too.
 IF p.oid=to_regprocedure('private.dashboard_admin_wg_day_evidence(text,text,date)')THEN
  SELECT jsonb_build_object('bodyMd5',md5(f.prosrc),'owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'securityDefiner',f.prosecdef,'volatility',f.provolatile,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'language',(select lanname from pg_language where oid=f.prolang),'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid)) INTO formatter FROM pg_proc f WHERE f.oid=to_regprocedure('private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)');
  IF actual='{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5f29e7114787442db7c502c16f07cd93","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true}'::jsonb AND formatter='{"acl":"{postgres=X/postgres}","args":"n bigint, seen timestamp with time zone, covered boolean, has_window boolean, hi timestamp with time zone, asof timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"98d86e2c8aee47aca8b6d9e2d0170112","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN 'ddbf8cae0223fec61ac59f81b60dce14';END IF;
  -- Unknown downstream body or privilege drift must continue to advance the token.
  RETURN md5(actual::text||coalesce(formatter::text,'missing'));
 END IF;
 -- This AR daily reader is not a generic/prepared/provider computation consumer.
 IF p.oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)')
  AND actual='{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"43f204f10037840a839c9890d127e274","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN '173bf1a012f07d69942571724ff8f658';END IF;
 -- Normalize only one exact, pinned call-site in these two complete original bodies.
 -- Other routines, unexpected source, signature or metadata always retain actual MD5.
 SELECT value INTO expected FROM jsonb_each('{"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"36966b6e1e434eb6d5990e551f816b8e","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"ccf807a978ba7f0d3cb9f527dad6c5d4","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}'::jsonb)WHERE to_regprocedure(key)=p.oid;
 IF expected IS NULL OR (actual-'bodyMd5') IS DISTINCT FROM(expected-'bodyMd5')THEN RETURN md5(p.prosrc);END IF;
 SELECT md5(h.prosrc)INTO self_hash FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)');
 callsite:=replace($callsite$CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='__HELPER_BODY__' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END$callsite$,'__HELPER_BODY__',self_hash);
 IF self_hash IS NULL OR length(p.prosrc)-length(replace(p.prosrc,callsite,''))<>length(callsite)
  OR md5(replace(p.prosrc,callsite,'md5(p.prosrc)'))IS DISTINCT FROM expected->>'bodyMd5'
 THEN RETURN md5(p.prosrc);END IF;
 RETURN expected->>'bodyMd5';
END;$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency_common(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='87123b179991627c7d56b66e48f67f1e' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
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
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_token(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='87123b179991627c7d56b66e48f67f1e' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
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
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_batch(p_targets jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH shared AS MATERIALIZED (
 SELECT jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='87123b179991627c7d56b66e48f67f1e' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
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
  )
 ) value
), targets AS MATERIALIZED (SELECT value target FROM jsonb_array_elements(p_targets)), dependencies AS MATERIALIZED (
 SELECT t.target,md5((s.value||jsonb_build_object(
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and t.target->>'source'='ar'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where t.target->>'source'='ar'and source_system='AR'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name')
 
 ))::text) token
 FROM targets t CROSS JOIN shared s
)
SELECT jsonb_object_agg(target->>'id',jsonb_build_object('target',target,'token',token)) FROM dependencies;
$function$
$definition$;
 for e in select key signature,value metadata from jsonb_each($expected${"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"4663607462d2f1461b90785bec7c88fa","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_admin_wg_day_evidence(text,text,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5f29e7114787442db7c502c16f07cd93","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"7063c3a30384df10b399a7e20ad3612c","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"cfee7ea2785d396387dddd2007fa5bf8","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5290b2fd082795cb5805aea66536cd8c","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_withdraw_status_dependency_md5(pg_proc)":{"acl":"{postgres=X/postgres}","args":"p pg_proc","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"87123b179991627c7d56b66e48f67f1e","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_wg_sites()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)","strict":false,"bodyMd5":"839401f31117192068b395d1c9580230","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)":{"acl":"{postgres=X/postgres}","args":"n bigint, seen timestamp with time zone, covered boolean, has_window boolean, hi timestamp with time zone, asof timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"98d86e2c8aee47aca8b6d9e2d0170112","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_health_wg_evidence_batch(text,text,date,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_from date, p_to date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"940523afd7eccfb09a11b27eadd11b54","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'wg_health_batch_contract_drift:%',e.signature;end if;end loop;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into after_deps from tokens;
 if after_deps is null or(select count(*)from jsonb_each(after_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(after_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(after_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'wg_health_batch_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into after_provider;
 if after_provider is null or exists(select 1 from jsonb_each(after_provider)x where x.value->>'token'is null)then raise exception'wg_health_batch_provider_proof_missing';end if;
 if before_deps is distinct from after_deps or before_provider is distinct from after_provider then raise exception'wg_health_batch_dependency_changed';end if;
 perform set_config('audit.wg_health_batch',jsonb_build_object('contract','wg-health-batch-v1','unchangedTokens',(select count(*)from jsonb_each(after_deps)),'providerTargets',(select count(*)from jsonb_each(after_provider)),'sourceRowsWritten',false,'queueWrites',false,'rollback',false)::text,true);
end;$migration$;
select current_setting('audit.wg_health_batch')::jsonb receipt;
commit;
