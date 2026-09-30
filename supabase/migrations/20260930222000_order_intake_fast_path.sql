-- Bound provider-summary coverage to its authorized native order sources.
-- No source data or existing RPC authorization changes.
begin;
do $migration$
declare p record;v_definition text;v_body text;v_acl aclitem[];v_auth oid;v_service oid;
begin
 select oid into v_auth from pg_roles where rolname='authenticated';
 select oid into v_service from pg_roles where rolname='service_role';
 select * into p from pg_proc where oid=to_regprocedure('public.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(p.prosrc)<>'697704eba7fc57c48dddfd78ec6043ff' or p.prosecdef
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or p.pronargdefaults<>1
  or p.proconfig is distinct from array['search_path=""']
  or p.prolang<>(select oid from pg_language where lanname='sql') then raise exception 'order_intake_fast_path_public_drift';end if;
 if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.is_grantable or a.grantee not in(p.proowner,v_auth,coalesce(v_service,p.proowner)))
  or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'order_intake_fast_path_public_acl_drift';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(p.prosrc) not in ('c8550ba902b18fed16dc60c26393cba8','8bad6e11cb619395a8cc6ea75a19a978') or not p.prosecdef
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or p.pronargdefaults<>1
  or p.proconfig is distinct from array['search_path=""','jit=off']
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'order_intake_fast_path_private_drift';end if;
 if v_auth is null or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.is_grantable or a.grantee not in(p.proowner,v_auth))
  or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'order_intake_fast_path_private_acl_drift';end if;
end;$migration$;
create or replace function private.dashboard_admin_live_intake_order_feeds(p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $function$
declare v_scope jsonb:=private.dashboard_admin_live_scope();v_result jsonb;
begin
 with native as materialized (
  select jsonb_build_object('dataset','orders','system',p.source,'platformId',p.id,'name',p.name,'team',p.team,
   'country',p.country,'rawCountry',p.scope_group,'rawPlatform',p.source_name,'timezone',p.timezone,
   'provenance',jsonb_build_object('kind','direct')) f
  from private.dashboard_admin_live_platforms()p
 ), expanded as (
  select f,d.direction,coalesce(nullif(f->>'timezone',''),case f->>'country'
   when '印度' then 'Asia/Kolkata' when '红膏蟹' then 'Asia/Kolkata' when '香港' then 'Asia/Kolkata' when '胖虎巴西' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo' when '巴基斯坦' then 'Asia/Karachi' when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '越南' then 'Asia/Ho_Chi_Minh' when '马来' then 'Asia/Kuala_Lumpur' when '缅甸' then 'Asia/Yangon' when '尼日利亚' then 'Africa/Lagos' when '智利' then 'America/Santiago' when '哥伦比亚' then 'America/Bogota' when '墨西哥' then 'America/Mexico_City' end) zone
  from native cross join (values('charge'::text),('withdraw'::text))d(direction)
  where private.dashboard_scope_allows(v_scope,f->>'country',f->>'rawPlatform')
 ), keyed as (
  select md5(jsonb_build_array(f->>'dataset',f->>'rawCountry',f->>'rawPlatform',f->>'system','direct',direction)::text) id,* from expanded
 ), dedup as (
  select distinct on(id) id,(f-'provenance')||jsonb_build_object('id',id,'direction',direction,'directions',jsonb_build_array(direction),
   'timezone',zone,'sourceKind','direct','provenance',f->'provenance','defaultEnd',case when zone is not null then (p_asof at time zone zone)::date-1 end) value
  from keyed order by id,(f?'timezone') desc,f::text
 ) select coalesce(jsonb_agg(value order by value->>'country',value->>'name',value->>'dataset',value->>'direction'),'[]'::jsonb) into v_result from dedup;
 return v_result;
end;$function$;
revoke all on function private.dashboard_admin_live_intake_order_feeds(timestamptz) from public,anon,authenticated;
do $upgrade$
declare p record;v_definition text;v_body text;v_acl aclitem[];
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 if md5(p.prosrc)='8bad6e11cb619395a8cc6ea75a19a978' then return;end if;
 v_definition:=pg_get_functiondef(p.oid);
 v_definition:=replace(v_definition,p.prosrc,$newbody$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_asof timestamptz:=statement_timestamp();v_operation text:=coalesce(p_request->>'operation','catalog');v_feeds jsonb;v_feed jsonb;v_ids text[];v_rows jsonb:='[]';v_result jsonb;
 v_from date;v_to date;v_day date;v_start timestamptz;v_end timestamptz;v_zone text;v_today date;v_launch timestamptz;v_run record;v_lg_runs jsonb;v_seen timestamptz;v_has boolean;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_direction text;v_kind text;dataset text;source_system text;source_kind text;
 status text;evidence text;received boolean;complete boolean;zero_confirmed boolean;expected boolean;collector_status text;expected_count bigint;fetched_count bigint;
 -- AR_CREATION_COVERAGE_DECL_BEGIN
 v_ar_snapshot record;v_ar_valid boolean;v_ar_counts numeric[];v_ar_value jsonb;v_ar_group jsonb;
 v_ar_expected_groups jsonb;v_ar_observed_groups jsonb;v_ar_group_key text;v_ar_group_total numeric;
 -- AR_CREATION_COVERAGE_DECL_END
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>4096 or p_request-array['operation','feedIds','startAt','endAt']<>'{}' or v_operation not in('catalog','orderCatalog','rows') then raise exception using errcode='22023',message='invalid_coverage_request';end if;
 if v_operation in('catalog','orderCatalog') then
  if p_request-array['operation']<>'{}' then raise exception using errcode='22023',message='invalid_coverage_request';end if;
  return jsonb_build_object('version',1,'complete',true,'checkedAt',v_asof,'defaultStart','2026-09-01','maxDays',93,'maxFeeds',8,'feeds',case when v_operation='orderCatalog' then private.dashboard_admin_live_intake_order_feeds(v_asof) else private.dashboard_admin_live_intake_feeds(v_asof) end);
 end if;
 if jsonb_typeof(p_request->'feedIds') is distinct from 'array' or jsonb_array_length(p_request->'feedIds') not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_request->'feedIds')x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{32}$') then raise exception using errcode='22023',message='invalid_coverage_feeds';end if;
 if jsonb_typeof(p_request->'startAt') is distinct from 'string' or jsonb_typeof(p_request->'endAt') is distinct from 'string' or p_request->>'startAt' !~ '^\d{4}-\d{2}-\d{2}$' or p_request->>'endAt' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_coverage_range';end if;
 v_from:=(p_request->>'startAt')::date;v_to:=(p_request->>'endAt')::date;
 if v_from<date '2000-01-01' or v_to-v_from not between 0 and 92 then raise exception using errcode='22023',message='invalid_coverage_range';end if;
 select array_agg(distinct value) into v_ids from jsonb_array_elements_text(p_request->'feedIds');
 if cardinality(v_ids)<>jsonb_array_length(p_request->'feedIds') then raise exception using errcode='22023',message='duplicate_coverage_feed';end if;
 -- Native order checks do not rebuild unrelated report/configuration catalogs.
 v_feeds:=private.dashboard_admin_live_intake_order_feeds(v_asof);
 if (select count(*) from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids))<>cardinality(v_ids) then
  v_feeds:=private.dashboard_admin_live_intake_feeds(v_asof);
 end if;
 if (select count(*) from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids))<>cardinality(v_ids) then raise exception using errcode='42501',message='coverage_feed_denied';end if;
 for v_feed in select f from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids) loop
  dataset:=v_feed->>'dataset';source_system:=v_feed->>'system';source_kind:=v_feed->>'sourceKind';v_source:=source_system;v_raw_country:=v_feed->>'rawCountry';v_raw_platform:=v_feed->>'rawPlatform';v_platform_id:=nullif(v_feed->>'platformId','')::uuid;v_direction:=v_feed->>'direction';v_kind:=case v_direction when 'charge' then 'recharge' else 'withdraw' end;v_zone:=v_feed->>'timezone';
  if v_zone is null or v_direction='unknown' or dataset='game66_config' then
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',null,'status','unverified','received',false,'complete',false,'zeroConfirmed',false,'expected',false,'evidence',case when dataset='game66_config' then 'configuration_history_unavailable' when v_zone is null then 'source_timezone_unknown' else 'source_direction_unknown' end,'recordReceivedAt',null));continue;
  end if;
  v_today:=(v_asof at time zone v_zone)::date;v_launch:=null;
  if dataset='orders' and source_system='newar' then select launch_at into v_launch from public.newar_detail_platforms where platform=v_raw_platform and country_code=v_raw_country and enabled;end if;
  -- All-status run history lacks a general scope index. Read it once per bounded feed, not once per day.
  v_lg_runs:='[]';
  if dataset='lg_orders' or(dataset='orders' and source_system='lg') then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_lg_runs from(
    select distinct on(t.stat_date) t.stat_date,t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at
    from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date between v_from and least(v_to,v_today-1)
    order by t.stat_date,t.observed_at desc,t.published_at desc nulls last)r;
  end if;
  for v_day in select d::date from generate_series(v_from::timestamp,least(v_to,v_today-1)::timestamp,interval '1 day')d loop
   v_start:=v_day::timestamp at time zone v_zone;v_end:=(v_day+1)::timestamp at time zone v_zone;
   v_has:=false;v_seen:=null;status:='not_received';evidence:=case when v_direction='config' then 'no_daily_configuration_snapshot' when dataset in('orders','lg_orders') then 'no_created_orders_received' else 'no_daily_report_received' end;
   complete:=false;zero_confirmed:=false;expected:=true;collector_status:=null;expected_count:=null;fetched_count:=null;
   if v_launch is not null and v_end<=v_launch then status:='not_expected';expected:=false;evidence:='before_verified_launch';
   else
    if dataset='orders' and source_system='ar' then
     select true,a.updated_at into v_has,v_seen from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR'
      and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;
     -- AR_CREATION_COVERAGE_BEGIN
     -- A successful API response or one created order is not a full-day receipt.
     -- Only charge is reconciled; payout and the independently timed success cohort stay unchanged.
     if v_direction='charge' then
      select t.snapshot,t.snapshot_id,t.snapshot_at,t.updated_at into v_ar_snapshot
       from public.collection_success_daily t where t.source_system='RECHARGE_REVIEW'
        and t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day;
      if found then
       v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot)='object'
        and v_ar_snapshot.snapshot->'schema_version'='1'::jsonb
        and v_ar_snapshot.snapshot->>'source_system'='RECHARGE_REVIEW'
        and v_ar_snapshot.snapshot->>'country_code'=v_raw_country
        and v_ar_snapshot.snapshot->>'platform'=v_raw_platform
        and v_ar_snapshot.snapshot->>'stat_date'=v_day::text
        and v_ar_snapshot.snapshot->>'timezone'=v_zone
        and v_ar_snapshot.snapshot->>'snapshot_id'=v_ar_snapshot.snapshot_id::text
        and v_ar_snapshot.snapshot#>'{coverage,complete}'='true'::jsonb
        and jsonb_typeof(v_ar_snapshot.snapshot->'coverage')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'totals')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'groups')='array'
        and isfinite(v_ar_snapshot.snapshot_at) and v_ar_snapshot.snapshot_at<=v_asof+interval '5 minutes'
        and (v_ar_snapshot.snapshot_at at time zone v_zone)::date>v_day,false);
       if v_ar_valid then
        begin
         v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot->'snapshot_at')='string'
          and v_ar_snapshot.snapshot->>'snapshot_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
          and (v_ar_snapshot.snapshot->>'snapshot_at')::timestamptz=v_ar_snapshot.snapshot_at,false);
        exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then v_ar_valid:=false;
        end;
       end if;
       v_ar_counts:=array[]::numeric[];
       if v_ar_valid then
        foreach v_ar_value in array array[v_ar_snapshot.snapshot#>'{coverage,expected_count}',
          v_ar_snapshot.snapshot#>'{coverage,fetched_count}',v_ar_snapshot.snapshot#>'{coverage,unique_count}',
          v_ar_snapshot.snapshot#>'{totals,submitted_count}'] loop
         if jsonb_typeof(v_ar_value) is distinct from 'number' then v_ar_valid:=false;exit;end if;
         if (v_ar_value::text)::numeric not between 0 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_counts:=array_append(v_ar_counts,(v_ar_value::text)::numeric);
        end loop;
       end if;
       if v_ar_valid then
        v_ar_valid:=v_ar_counts[1]=v_ar_counts[2] and v_ar_counts[1]=v_ar_counts[3]
         and v_ar_counts[1]=v_ar_counts[4] and jsonb_array_length(v_ar_snapshot.snapshot->'groups')<=2000;
       end if;
       v_ar_expected_groups:='{}';v_ar_group_total:=0;
       if v_ar_valid then
        for v_ar_group in select value from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') loop
         if jsonb_typeof(v_ar_group) is distinct from 'object'
          or jsonb_typeof(v_ar_group->'raw_channel') is distinct from 'string'
          or jsonb_typeof(v_ar_group->'channel_type') is distinct from 'string'
          or length(v_ar_group->>'raw_channel') not between 1 and 96
          or length(v_ar_group->>'channel_type') not between 1 and 48
          or jsonb_typeof(v_ar_group->'submitted_count') is distinct from 'number' then v_ar_valid:=false;exit;end if;
         v_ar_value:=v_ar_group->'submitted_count';
         if (v_ar_value::text)::numeric not between 1 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_group_key:=jsonb_build_array(v_ar_group->>'raw_channel',v_ar_group->>'channel_type')::text;
         if v_ar_expected_groups ? v_ar_group_key then v_ar_valid:=false;exit;end if;
         v_ar_expected_groups:=v_ar_expected_groups||jsonb_build_object(v_ar_group_key,v_ar_value);
         v_ar_group_total:=v_ar_group_total+(v_ar_value::text)::numeric;
        end loop;
        v_ar_valid:=v_ar_valid and v_ar_group_total=v_ar_counts[1];
       end if;
       if v_ar_valid then
        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- Exact raw channel/type comparison: aliases must not hide a missing channel.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select jsonb_build_array(a.raw_channel,a.channel_type)::text key,count(*) n,max(a.updated_at) seen
          from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
           and a.order_kind='recharge' and a.source_system='AR'
           and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
          group by a.raw_channel,a.channel_type)g;
        v_has:=fetched_count>0;
        complete:=fetched_count=expected_count and v_ar_observed_groups=v_ar_expected_groups;
        zero_confirmed:=complete and expected_count=0;
        if complete then
         v_has:=true;v_seen:=coalesce(v_seen,v_ar_snapshot.updated_at,v_ar_snapshot.snapshot_at);
         status:=case when zero_confirmed then 'zero_complete' else 'complete' end;
         evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_created_counts_reconciled' end;
        else
         status:='partial';evidence:=case when fetched_count<>expected_count
          then 'source_created_count_mismatch' else 'source_created_channel_mismatch' end;
        end if;
       else
        collector_status:='snapshot_invalid';evidence:='source_snapshot_invalid';
        status:=case when coalesce(v_has,false) then 'received' else 'not_received' end;
       end if;
      end if;
     end if;
     -- AR_CREATION_COVERAGE_END
    elsif dataset='orders' and source_system='newar' then
     select true,n.received_at into v_has,v_seen from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.created_at>=greatest(v_start,coalesce(v_launch,v_start)) and n.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.status_group='success' and n.success_at>=v_start and n.success_at<v_end and n.created_at>=coalesce(v_launch,'-infinity'::timestamptz)) then evidence:='only_success_day_records_received';end if;
    elsif dataset='orders' and source_system='game66' then
     if v_direction='charge' then select true,g.last_seen_at into v_has,v_seen from public.game66_charge_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;
     else select true,g.last_seen_at into v_has,v_seen from public.game66_withdraw_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;end if;
     select r.status,r.finished_at,r.rows_fetched,r.rows_upserted,r.rows_skipped,r.error_count into v_run from public.game66_sync_runs r where r.platform_id=v_platform_id and r.data_type=v_direction and r.window_start<v_end and r.window_end>=v_start order by r.started_at desc limit 1;
     if found then
      collector_status:=v_run.status;fetched_count:=v_run.rows_fetched;
      if v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      elsif v_run.status='running' then status:='pending';evidence:='source_task_not_finished';
      elsif v_run.status='succeeded' then
       -- Fetched/upserted agreement proves receipt, not the remote day's total.
       -- This collector has no verified expected source count in its run metadata.
       status:=case when coalesce(v_has,false) then 'received' else 'unverified' end;evidence:='source_counts_not_verified';
      else status:='unverified';evidence:='source_task_state_unknown';end if;
     elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
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
     if not coalesce(v_has,false) and exists(select 1 from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.paid_at>=v_start and t.paid_at<v_end) then evidence:='only_success_day_records_received';end if;
     select t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at into v_run from jsonb_to_recordset(v_lg_runs)t(stat_date date,status text,sync_mode text,expected_count bigint,source_total bigint,fetched_count bigint,published_at timestamptz) where t.stat_date=v_day;
     if found then
      collector_status:=v_run.status;expected_count:=v_run.expected_count;fetched_count:=v_run.fetched_count;
      if v_run.status='published' then
       if v_run.sync_mode='full' and v_run.expected_count>=0 and v_run.expected_count=v_run.fetched_count and v_run.source_total=v_run.expected_count and v_run.published_at is not null then
        complete:=case when v_run.expected_count=0 then not coalesce(v_has,false) else coalesce(v_has,false) end;zero_confirmed:=complete and v_run.expected_count=0;
        if complete then v_has:=true;v_seen:=v_run.published_at;status:=case when zero_confirmed then 'zero_complete' else 'complete' end;evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_day_task_completed' end;
        else status:='partial';evidence:=case when v_run.expected_count=0 then 'completed_zero_conflicts_with_records' else 'published_records_not_received' end;end if;
       else status:='partial';evidence:='source_counts_not_verified';end if;
      elsif v_run.status in('collecting','live') then status:='pending';evidence:=case when v_run.status='live' then 'source_full_day_not_published' else 'source_task_not_finished' end;
      elsif v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      else status:='unverified';evidence:='source_snapshot_not_published';end if;
     elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
    elsif dataset='collection_success' then
     select true,coalesce(t.snapshot_at,t.updated_at) into v_has,v_seen from public.collection_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.source_system=v_source limit 1;
    elsif dataset='newar_third_party_volume' then
     select true,coalesce(t.captured_at,t.updated_at) into v_has,v_seen from public.newar_business_snapshots t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.kind='third_party_volume' and t.direction=v_direction limit 1;
    elsif dataset='auto' then
     select true,coalesce(t.source_updated_at,t.updated_at) into v_has,v_seen from public.auto_withdraw_daily t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and case source_kind when 'google_sheets' then t.source_sheet like 'raw_daily_%' when 'direct' then (v_source='AR' and t.source_sheet like 'AR_DIRECT%') or (v_source='LG' and t.source_sheet like 'LG_DIRECT%') else coalesce(t.source_sheet,'') not like 'raw_daily_%' and coalesce(t.source_sheet,'') not like 'AR_DIRECT%' and coalesce(t.source_sheet,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='ar_config' then
     select true,t.received_at into v_has,v_seen from public.ar_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='panda_config' then
     select true,t.received_at into v_has,v_seen from public.panda_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='wg_config' then
     select true,t.received_at into v_has,v_seen from public.wg_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    else status:='unverified';evidence:='unsupported_source';end if;
   end if;
   received:=coalesce(v_has,false);if received and status='not_received' then status:='received';evidence:='records_received_completeness_unverified';end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',v_day,'status',status,'received',received,'complete',complete,'zeroConfirmed',zero_confirmed,'expected',expected,'evidence',evidence,'recordReceivedAt',v_seen,'collectorStatus',collector_status,'expectedCount',expected_count,'fetchedCount',fetched_count));
  end loop;
 end loop;
 return jsonb_build_object('version',1,'complete',true,'checkedAt',v_asof,'feedIds',to_jsonb(v_ids),'startAt',v_from,'endAt',v_to,'timestampBasis','evidence_record_or_collector_receipt','rows',v_rows);
end;$newbody$);
 execute v_definition;
 select prosrc,proacl into v_body,v_acl from pg_proc where oid=p.oid;
 if md5(v_body)<>'8bad6e11cb619395a8cc6ea75a19a978' or v_acl is distinct from p.proacl then raise exception 'order_intake_fast_path_postcheck_failed';end if;
end;$upgrade$;
commit;
