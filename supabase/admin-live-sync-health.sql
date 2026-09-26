-- Read-only daily intake health. Presence is not proof that an entire day is complete.
-- Requires the existing scoped platform catalog and collected-business inventory.
begin;
create or replace function private.dashboard_admin_live_sync_health_rows(p_asof timestamptz)
returns table(country text,team text,platform text,platform_id uuid,source_system text,source_kind text,dataset text,direction text,data_date date,timezone text,status text,received boolean,evidence text,last_received_at timestamptz)
language plpgsql stable security definer set search_path='' set jit=off as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_feeds jsonb;v_feed jsonb;v_direction text;v_day date;v_today date;v_start timestamptz;v_end timestamptz;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_key text;v_kind text;v_zone text;v_launch timestamptz;v_seen timestamptz;v_has boolean;v_run record;v_first date;v_feed_keys text[]:=array[]::text[];v_feed_key text;
begin
 -- The catalog already normalizes Panghu and enforces account scope. Do not
 -- consult lastDate to infer day coverage; every returned day is checked below.
 select coalesce(jsonb_agg(f),'[]'::jsonb) into v_feeds from jsonb_array_elements(coalesce(private.dashboard_admin_live_collected_data('{"operation":"catalog"}'::jsonb)->'rows','[]'::jsonb)) f where f->>'dataset'<>'orders';
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
 for v_feed in select distinct x from jsonb_array_elements(v_feeds)x where x->>'dataset' in
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
   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop
    data_date:=v_day;v_start:=v_day::timestamp at time zone v_zone;v_end:=(v_day+1)::timestamp at time zone v_zone;
    v_has:=false;v_seen:=null;status:='not_received';evidence:=case when v_direction='config' then 'no_daily_configuration_snapshot' when dataset='orders' or dataset='lg_orders' then 'no_created_orders_received' else 'no_daily_report_received' end;
    if dataset='orders' and source_system='ar' then
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
    elsif dataset='lg_orders' then
     select true,t.updated_at into v_has,v_seen from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.created_at>=v_start and t.created_at<v_end limit 1;
     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;
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
     select true,t.received_at into v_has,v_seen from public.wg_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    else status:='unverified';evidence:='unsupported_source';end if;
    received:=coalesce(v_has,false);last_received_at:=v_seen;
    if received and status='not_received' then status:='received';if evidence not in('source_completed_zero_rows','source_day_task_completed') then evidence:='records_received_completeness_unverified';end if;end if;
    return next;
   end loop;
  end loop;
 end loop;
end;$$;
revoke all on function private.dashboard_admin_live_sync_health_rows(timestamptz) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_sync_health(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_result jsonb;v_offset int:=coalesce((p_request->>'offset')::int,0);v_limit int:=coalesce((p_request->>'limit')::int,100);v_scope jsonb:=private.dashboard_admin_live_scope();v_key text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>1024 or p_request-array['offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_health_request';end if;
 foreach v_key in array array['offset','limit'] loop if p_request?v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,5}$') then raise exception using errcode='22023',message='invalid_health_pagination';end if;end loop;
 if v_offset not between 0 and 50000 or v_limit not in(50,100,200,5000) then raise exception using errcode='22023',message='invalid_health_pagination';end if;
 with checked as materialized(select * from private.dashboard_admin_live_sync_health_rows(statement_timestamp())),issues as materialized(select * from checked where status<>'received'),paged as(select * from issues order by data_date desc nulls last,country,platform,dataset,direction,source_kind offset v_offset limit v_limit)
 select jsonb_build_object('checkedAt',statement_timestamp(),'days',7,'coverage','registered_and_received_business_sources','total',(select count(*) from issues),'offset',v_offset,'limit',v_limit,
  'summary',jsonb_build_object('checked',(select count(*) from checked),'received',(select count(*) from checked where status='received'),'notReceived',(select count(*) from checked where status='not_received'),'failed',(select count(*) from checked where status='failed'),'pending',(select count(*) from checked where status='pending'),'unverified',(select count(*) from checked where status='unverified')),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('country',country,'team',team,'platform',platform,'platformId',platform_id,'source',source_system,'sourceKind',source_kind,'dataset',dataset,'direction',direction,'date',data_date,'timezone',timezone,'status',status,'received',received,'evidence',evidence,'recordReceivedAt',last_received_at)) from paged),'[]'::jsonb)) into v_result;
 return v_result;
end;$$;
revoke all on function private.dashboard_admin_live_sync_health(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_sync_health(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_sync_health(p_request)$$;
revoke all on function public.dashboard_admin_live_sync_health(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_sync_health(jsonb),public.dashboard_admin_live_sync_health(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
