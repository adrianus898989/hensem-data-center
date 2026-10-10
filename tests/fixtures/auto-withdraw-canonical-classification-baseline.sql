-- Frozen production function code only. No orders, accounts, sessions or credentials.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case upper(btrim(p_name)) when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN'
 when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end;
$function$
;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_start date;v_end date;v_before date;v_days integer;
 v_country text;v_platforms text[];v_panghu text[];v_account text;v_key text;v_view text;v_sort text;v_asc boolean;
 v_limit integer;v_offset integer;v_result jsonb;v_game jsonb:='{}'::jsonb;v_daily boolean;
 v_targets jsonb;v_target jsonb;v_game_part jsonb;v_target_platforms text[];v_wg_days jsonb;v_yash_days jsonb;v_yash_item jsonb;v_yash_rows jsonb;v_yash_meta jsonb;v_yash_prior jsonb;v_yash_from date;v_yash_to date;v_yash_period text;v_newar_days jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768 or
  p_request-array['startAt','endAt','country','platform','platforms','account','view','sort','ascending','daily','offset','limit','scopeTargets']<>'{}'::jsonb then
  raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['country','platform','account','view','sort'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['startAt','endAt'] loop
  if jsonb_typeof(p_request->v_key) is distinct from 'string' or p_request->>v_key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?Z$' then
   raise exception using errcode='22023',message='invalid_time';end if;
 end loop;
 foreach v_key in array array['limit','offset'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then
   raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 foreach v_key in array array['ascending','daily'] loop
  if p_request ? v_key and jsonb_typeof(p_request->v_key)<>'boolean' then raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 v_start:=left(p_request->>'startAt',10)::date;v_end:=left(p_request->>'endAt',10)::date;
 v_days:=v_end-v_start+1;v_before:=v_start-v_days;v_country:=nullif(btrim(p_request->>'country'),'');
 v_limit:=coalesce((p_request->>'limit')::integer,20);v_offset:=coalesce((p_request->>'offset')::integer,0);
 v_view:=coalesce(p_request->>'view','auto');v_sort:=coalesce(p_request->>'sort','total');v_asc:=coalesce((p_request->>'ascending')::boolean,false);
 v_daily:=coalesce((p_request->>'daily')::boolean,false);v_account:=nullif(btrim(p_request->>'account'),'');
 if v_start is null or v_end is null or v_days not between 1 and 31 or v_country is null or v_country='all'
  or v_view not in('auto','operators') or v_sort not in('country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange')
  or v_limit not in(20,30,50,100,500) or v_offset>1000000 then raise exception using errcode='22023',message='invalid_range';end if;
 if p_request ? 'platforms' then
  if jsonb_typeof(p_request->'platforms') is distinct from 'array' or jsonb_array_length(p_request->'platforms')>200
   or exists(select 1 from jsonb_array_elements(p_request->'platforms')a where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 200 or a#>>'{}' ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_filter';end if;
  select array_agg(private.dashboard_admin_live_withdraw_key(value)) into v_platforms from jsonb_array_elements_text(p_request->'platforms');
 end if;
 if nullif(p_request->>'platform','') is not null then v_platforms:=array[private.dashboard_admin_live_withdraw_key(p_request->>'platform')];end if;
 -- scope_targets_v1: preserve source country and exact platforms across teams.
 if p_request ? 'scopeTargets' then
  if jsonb_typeof(p_request->'scopeTargets') is distinct from 'array' or jsonb_array_length(p_request->'scopeTargets') not between 1 and 8 then
   raise exception using errcode='22023',message='invalid_scope_targets';end if;
  for v_target in select value from jsonb_array_elements(p_request->'scopeTargets') loop
   if jsonb_typeof(v_target) is distinct from 'object' or v_target-array['country','platforms']<>'{}'::jsonb
    or jsonb_typeof(v_target->'country') is distinct from 'string' or length(btrim(v_target->>'country')) not between 1 and 200
    or v_target->>'country'<>btrim(v_target->>'country') or v_target->>'country' ~ '[[:cntrl:]]'
    or (case v_target->>'country' when '胖虎巴西' then '巴西' when '香港' then '印度' when '红膏蟹' then '印度' when 'LG' then '菲律宾' else v_target->>'country' end)<>v_country
    or jsonb_typeof(v_target->'platforms') is distinct from 'array' or jsonb_array_length(v_target->'platforms') not between 1 and 200 then
    raise exception using errcode='22023',message='invalid_scope_targets';end if;
   if exists(select 1 from jsonb_array_elements(v_target->'platforms')p where jsonb_typeof(p)<>'string' or length(btrim(p#>>'{}')) not between 1 and 200 or p#>>'{}'<>btrim(p#>>'{}') or p#>>'{}' ~ '[[:cntrl:]]') then
    raise exception using errcode='22023',message='invalid_scope_targets';end if;
  end loop;
  if (select count(distinct value->>'country') from jsonb_array_elements(p_request->'scopeTargets'))<>jsonb_array_length(p_request->'scopeTargets') then
   raise exception using errcode='22023',message='invalid_scope_targets';end if;
  v_targets:=p_request->'scopeTargets';
 else
  v_targets:=jsonb_build_array(jsonb_build_object('country',v_country,'platforms',null));
 end if;
 for v_target in select value from jsonb_array_elements(v_targets) loop
  if exists(select 1 from public.game66_platforms where team_name=v_target->>'country') then
   select case when p_request ? 'scopeTargets' then array(select private.dashboard_admin_live_withdraw_key(value) from jsonb_array_elements_text(v_target->'platforms')) else v_platforms end into v_target_platforms;
   v_game_part:=private.dashboard_admin_live_game66_withdraw(v_before,v_end,v_target->>'country',v_target_platforms);
   v_game:=jsonb_build_object('rows',coalesce(v_game->'rows','[]'::jsonb)||coalesce(v_game_part->'rows','[]'::jsonb),
     'operatorRows',coalesce(v_game->'operatorRows','[]'::jsonb)||coalesce(v_game_part->'operatorRows','[]'::jsonb));
  end if;
 end loop;
 select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
 select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into v_wg_days
 from private.dashboard_admin_wg_withdraw_days(p_request,v_scope,v_before,v_end) w;
 select coalesce(jsonb_agg(to_jsonb(y)),'[]'::jsonb) into v_yash_days
 from private.dashboard_admin_yash_withdraw_days(p_request,v_scope,v_before,v_end) y;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_newar_days
 from private.dashboard_admin_newar_withdraw_days(p_request,v_scope,v_before,v_end) n;
 with selected_targets as materialized (
  select value->>'country' as country,case when jsonb_typeof(value->'platforms')='array'
    then array(select private.dashboard_admin_live_withdraw_key(p) from jsonb_array_elements_text(value->'platforms')p) end as platforms
  from jsonb_array_elements(v_targets)
 ), registered_game66 as materialized (
  select distinct g.team_name as country,g.platform_name as platform,
    private.dashboard_admin_live_withdraw_key(g.platform_name) as platform_key
  from public.game66_platforms g join selected_targets t on g.team_name=t.country
    and (t.platforms is null or private.dashboard_admin_live_withdraw_key(g.platform_name)=any(t.platforms))
  where (v_platforms is null or private.dashboard_admin_live_withdraw_key(g.platform_name)=any(v_platforms))
    and private.dashboard_scope_allows(v_scope,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
      g.platform_name)
 ), direct as materialized (
  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key,t.country as target_country from public.newar_business_snapshots s
  join selected_targets t on (case when upper(btrim(s.country)) in ('巴西','BR','BRAZIL') and upper(btrim(s.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(s.country,s.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(s.platform)=any(t.platforms))
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.stat_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,t.country,s.platform)
 ), legacy_daily as (
  select distinct on(a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform))
   a.data_date,t.country as country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform) as platform_key,
   a.total::bigint,a.success::bigint,a.rejected::bigint,a.auto_count::bigint,
   coalesce(a.manual_count,greatest(a.total-a.auto_count,0))::bigint as manual_count,a.avg_seconds::numeric,
   a.source_updated_at,a.updated_at,
   case when a.avg_seconds is not null and a.total>0 then a.total else 0 end::bigint as duration_sample_count,
   case when a.total>0 then a.avg_seconds*a.total end::numeric as duration_total_seconds,
   'source_reported_processing'::text as duration_basis
  from public.auto_withdraw_daily a join selected_targets t on (case when upper(btrim(a.country)) in ('巴西','BR','BRAZIL') and upper(btrim(a.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(a.country,a.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(a.platform)=any(t.platforms)) where a.data_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,t.country,a.platform)
   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(a.platform) and n.payload ? 'rows')
  order by a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform),coalesce(a.updated_at,a.source_updated_at) desc
 ), prior_daily_source as materialized (
  select * from legacy_daily
  union all
  select n.stat_date,n.target_country,n.platform,n.platform_key,(r->>'total_count')::bigint,(r->>'success_count')::bigint,
   (r->>'reject_count')::bigint,(r->>'auto_count')::bigint,coalesce((r->>'manual_count')::bigint,greatest((r->>'total_count')::bigint-(r->>'auto_count')::bigint,0)),
   (r->>'total_handle_seconds')::numeric/nullif((r->>'handle_count')::numeric,0),n.captured_at,n.updated_at,
   case when (r->>'handle_count')::bigint>0 and r->>'total_handle_seconds' is not null then (r->>'handle_count')::bigint else 0 end,
   case when (r->>'handle_count')::bigint>0 then (r->>'total_handle_seconds')::numeric end,'source_reported_processing'::text
  from direct n cross join lateral jsonb_array_elements(n.payload->'rows')r
  union all
  select (r->>'data_date')::date,r->>'country',r->>'platform',private.dashboard_admin_live_withdraw_key(r->>'platform'),
   (r->>'total')::bigint,(r->>'success')::bigint,(r->>'rejected')::bigint,(r->>'auto_count')::bigint,(r->>'manual_count')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   case when r->>'avg_seconds' is not null and (r->>'total')::bigint>0 then (r->>'total')::bigint else 0 end,
   case when (r->>'total')::bigint>0 then (r->>'avg_seconds')::numeric*(r->>'total')::bigint end,'source_reported_processing'::text
  from jsonb_array_elements(coalesce(v_game->'rows','[]'::jsonb))r
 ), legacy_operators as (
  select distinct on(o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account)
   o.data_date,t.country as country,o.platform,private.dashboard_admin_live_withdraw_key(o.platform) as platform_key,o.account,
   o.processed::bigint,o.rejected::bigint,o.avg_seconds::numeric,o.source_updated_at,o.updated_at,
   case when o.avg_seconds is not null and o.processed>0 then o.processed else 0 end::bigint as duration_sample_count,
   case when o.processed>0 then o.avg_seconds*o.processed end::numeric as duration_total_seconds,
   'source_reported_processing'::text as duration_basis
  from public.withdraw_operator_daily o join selected_targets t on (case when upper(btrim(o.country)) in ('巴西','BR','BRAZIL') and upper(btrim(o.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(o.country,o.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(o.platform)=any(t.platforms)) where o.data_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,t.country,o.platform)
   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(o.platform) and n.payload ? 'operator_rows')
  order by o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account,coalesce(o.updated_at,o.source_updated_at) desc
 ), prior_operator_source as materialized (
  select * from legacy_operators
  union all
  select n.stat_date,n.target_country,n.platform,n.platform_key,r->>'operator',(r->>'processed_count')::bigint,(r->>'reject_count')::bigint,
   (r->>'total_handle_seconds')::numeric/nullif((r->>'handle_count')::numeric,0),n.captured_at,n.updated_at,
   case when (r->>'handle_count')::bigint>0 and r->>'total_handle_seconds' is not null then (r->>'handle_count')::bigint else 0 end,
   case when (r->>'handle_count')::bigint>0 then (r->>'total_handle_seconds')::numeric end,'source_reported_processing'::text
  from direct n cross join lateral jsonb_array_elements(n.payload->'operator_rows')r
  union all
  select (r->>'data_date')::date,r->>'country',r->>'platform',private.dashboard_admin_live_withdraw_key(r->>'platform'),r->>'account',
   (r->>'processed')::bigint,(r->>'rejected')::bigint,(r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   case when r->>'avg_seconds' is not null and (r->>'processed')::bigint>0 then (r->>'processed')::bigint else 0 end,
   case when (r->>'processed')::bigint>0 then (r->>'avg_seconds')::numeric*(r->>'processed')::bigint end,'source_reported_processing'::text
  from jsonb_array_elements(coalesce(v_game->'operatorRows','[]'::jsonb))r
 ), wg_days as materialized (
  select * from jsonb_to_recordset(v_wg_days) w(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,
   complete boolean,operator_rows jsonb,paying_count bigint,forced_count bigint,unknown_count bigint)
 ), yash_days as materialized (
  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)
 ), newar_days as materialized (
  select * from jsonb_to_recordset(v_newar_days) n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
 ), daily_source as materialized (
  select p.* from prior_daily_source p where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
   and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
   and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   coalesce((select sum((r->>'duration_sample_count')::bigint) from jsonb_array_elements(operator_rows) r),0)::bigint,
   (select sum((r->>'duration_total_seconds')::numeric) from jsonb_array_elements(operator_rows) r),
   'created_to_operated'::text from wg_days
  union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_submitted_to_handled'::text from newar_days
 ), operator_source as materialized (
  select p.*,greatest(p.processed-p.rejected,0) as success from prior_operator_source p
   where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
    and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
    and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
  union all select w.data_date,w.country,w.platform,w.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'created_to_operated'::text,(r->>'success')::bigint
  from wg_days w cross join lateral jsonb_array_elements(w.operator_rows) r
  union all select y.data_date,y.country,y.platform,y.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'created_to_completed'::text,(r->>'success')::bigint
  from yash_days y cross join lateral jsonb_array_elements(y.operator_rows) r
  union all select n.data_date,n.country,n.platform,n.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_submitted_to_handled'::text,(r->>'success')::bigint
  from newar_days n cross join lateral jsonb_array_elements(n.operator_rows) r
 ), daily as materialized (
  select * from daily_source where v_platforms is null or platform_key=any(v_platforms)
 ), operators as materialized (
  select * from operator_source where (v_platforms is null or platform_key=any(v_platforms)) and (v_account is null or position(lower(v_account) in lower(account))>0)
 ), daily_group as (
  select country,platform_key,max(platform) platform,case when v_daily then data_date else v_start end as group_date,
   (data_date>=v_start) current_period,sum(total)::bigint total,sum(success)::bigint success,sum(rejected)::bigint rejected,
   sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count,
   sum(duration_total_seconds)/nullif(sum(duration_sample_count),0) avg_seconds,
   sum(duration_sample_count)::bigint duration_sample_count,sum(duration_total_seconds) duration_total_seconds,
   case when count(distinct duration_basis) filter(where duration_sample_count>0)>1 then 'mixed_source_processing' else min(duration_basis) filter(where duration_sample_count>0) end duration_basis,
   max(source_updated_at) source_updated_at,count(distinct data_date) covered_days
  from daily group by 1,2,4,5
 ), operator_group as (
  select country,platform_key,max(platform) platform,account,case when v_daily then data_date else v_start end as group_date,
   (data_date>=v_start) current_period,sum(processed)::bigint processed,sum(rejected)::bigint rejected,sum(success)::bigint success,
   sum(duration_total_seconds)/nullif(sum(duration_sample_count),0) avg_seconds,
   sum(duration_sample_count)::bigint duration_sample_count,sum(duration_total_seconds) duration_total_seconds,
   case when count(distinct duration_basis) filter(where duration_sample_count>0)>1 then 'mixed_source_processing' else min(duration_basis) filter(where duration_sample_count>0) end duration_basis,
   max(source_updated_at) source_updated_at,count(distinct data_date) covered_days
  from operators group by 1,2,4,5,6
 ), raw_presented as materialized (
  select d.country,d.platform,d.platform_key,d.group_date,''::text account,
   jsonb_build_object('dataDate',d.group_date,'country',d.country,'platform',d.platform,'total',d.total,'success',d.success,'rejected',d.rejected,
   'autoCount',d.auto_count,'manualCount',d.manual_count,'unclassifiedCount',greatest(d.total-d.auto_count-d.manual_count,0),
   'avgSeconds',d.avg_seconds,'durationSampleCount',d.duration_sample_count,
   'durationTotalSeconds',d.duration_total_seconds,'durationBasis',d.duration_basis,'sourceUpdatedAt',d.source_updated_at,'coveredDays',d.covered_days,
   'previous',case when p.platform_key is not null then jsonb_build_object('total',p.total,'success',p.success,'rejected',p.rejected,'autoCount',p.auto_count,'manualCount',p.manual_count,'avgSeconds',p.avg_seconds,'durationSampleCount',p.duration_sample_count,
   'durationTotalSeconds',p.duration_total_seconds,'durationBasis',p.duration_basis,'coveredDays',p.covered_days) end) item
  from daily_group d left join daily_group p on p.country=d.country and p.platform_key=d.platform_key
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  where d.current_period and v_view='auto'
  union all
  select d.country,d.platform,d.platform_key,d.group_date,d.account,
   jsonb_build_object('dataDate',d.group_date,'country',d.country,'platform',d.platform,'account',d.account,'processed',d.processed,'rejected',d.rejected,
   'success',d.success,'avgSeconds',d.avg_seconds,'durationSampleCount',d.duration_sample_count,
   'durationTotalSeconds',d.duration_total_seconds,'durationBasis',d.duration_basis,'sourceUpdatedAt',d.source_updated_at,'coveredDays',d.covered_days,
   'previous',case when p.platform_key is not null then jsonb_build_object('processed',p.processed,'success',p.success,'rejected',p.rejected,'avgSeconds',p.avg_seconds,'durationSampleCount',p.duration_sample_count,
   'durationTotalSeconds',p.duration_total_seconds,'durationBasis',p.duration_basis,'coveredDays',p.covered_days) end)
  from operator_group d left join operator_group p on p.country=d.country and p.platform_key=d.platform_key and p.account=d.account
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  where d.current_period and v_view='operators'
 ), presented as materialized (
  select p.country,p.platform,p.platform_key,p.group_date,p.account,
   case when exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
    and (not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end),false)
    or not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date-1 else v_before end and case when v_daily then p.group_date-1 else v_start-1 end),false))
    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from yash_days y where y.country=p.country and y.platform_key=p.platform_key)
    and (not coalesce((select bool_and(y.complete) from yash_days y where y.country=p.country and y.platform_key=p.platform_key
      and y.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end),false)
     or not coalesce((select bool_and(y.complete) from yash_days y where y.country=p.country and y.platform_key=p.platform_key
      and y.data_date between case when v_daily then p.group_date-1 else v_before end and case when v_daily then p.group_date-1 else v_start-1 end),false))
    then jsonb_set(p.item,'{previous}','null'::jsonb) else p.item end item
  from raw_presented p
 ), sortable as (
  select *,case when v_sort in('country','platform','account') then item->>v_sort end sort_text,
   case v_sort when 'country' then null when 'platform' then null when 'account' then null
    when 'successRate' then (item->>'success')::numeric/nullif(coalesce(item->>'total',item->>'processed')::numeric,0)
    when 'rejectRate' then (item->>'rejected')::numeric/nullif(coalesce(item->>'total',item->>'processed')::numeric,0)
    when 'autoRate' then (item->>'autoCount')::numeric/nullif((item->>'total')::numeric,0)
    when 'manualRate' then (item->>'manualCount')::numeric/nullif((item->>'total')::numeric,0)
    when 'previousAvgSeconds' then (item->'previous'->>'avgSeconds')::numeric
    when 'durationChange' then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1
    else (item->>v_sort)::numeric end sort_number
  from presented
 ), page as (
  select * from sortable order by case when v_asc then sort_text end asc nulls last,
    case when not v_asc then sort_text end desc nulls last,case when v_asc then sort_number end asc nulls last,
    case when not v_asc then sort_number end desc nulls last,country,platform,group_date,account offset v_offset limit v_limit
 ), totals as (
  select (data_date>=v_start) current_period,jsonb_build_object('total',sum(total),'success',sum(success),'rejected',sum(rejected),
   'autoCount',sum(auto_count),'manualCount',sum(manual_count),'unclassifiedCount',sum(greatest(total-auto_count-manual_count,0)),
   'avgSeconds',sum(duration_total_seconds)/nullif(sum(duration_sample_count),0),
   'durationSampleCount',sum(duration_sample_count),'durationTotalSeconds',sum(duration_total_seconds),
   'durationBasis',case when count(distinct duration_basis) filter(where duration_sample_count>0)>1 then 'mixed_source_processing' else min(duration_basis) filter(where duration_sample_count>0) end,'platforms',count(distinct(country,platform_key)),'coveredDays',count(distinct data_date)) item
  from daily group by 1
 ), operator_totals as (
  select (data_date>=v_start) current_period,jsonb_build_object('processed',sum(processed),'rejected',sum(rejected),'success',sum(success),
   'avgSeconds',sum(duration_total_seconds)/nullif(sum(duration_sample_count),0),
   'durationSampleCount',sum(duration_sample_count),'durationTotalSeconds',sum(duration_total_seconds),
   'durationBasis',case when count(distinct duration_basis) filter(where duration_sample_count>0)>1 then 'mixed_source_processing' else min(duration_basis) filter(where duration_sample_count>0) end,'operators',count(distinct (country,platform_key,account)),
   'platforms',count(distinct(country,platform_key)),'coveredDays',count(distinct data_date)) item from operators group by 1
 )
 select jsonb_build_object('version',2,'view',v_view,'source','Supabase daily + NEWAR direct + GAME66','startDate',v_start,'endDate',v_end,'previousStartDate',v_before,'previousEndDate',v_start-1,
  'total',(select count(*) from presented),'offset',v_offset,'limit',v_limit,
  'rows',coalesce((select jsonb_agg(item) from page),'[]'::jsonb),
  'totals',coalesce(case v_view when 'auto' then (select item from totals where current_period) else (select item from operator_totals where current_period) end,'{}'::jsonb),
  'previousTotals',case v_view when 'auto' then (select item from totals where not current_period) else (select item from operator_totals where not current_period) end,
  'comparison',jsonb_build_object('singleDay',v_days=1,
    'matchedRows',(select count(*) from presented where item->'previous'<>'null'::jsonb),
    'totalRows',(select count(*) from presented),
    'complete',coalesce((select bool_and(item->'previous'<>'null'::jsonb
      and (item->'previous'->>'coveredDays')::integer=(item->>'coveredDays')::integer) from presented),false)
      and case v_view when 'auto' then
        (select count(distinct(country,platform_key)) from daily where data_date>=v_start)=(select count(distinct(country,platform_key)) from daily where data_date<v_start)
        else (select count(distinct(country,platform_key,account)) from operators where data_date>=v_start)=(select count(distinct(country,platform_key,account)) from operators where data_date<v_start) end),
  'platformCoverage',(
   select jsonb_build_object('basis','registered_game66_selected_scope',
    'expectedCount',count(*),'recordedCount',count(*) filter(where covered_days>0),
    'missingCount',count(*) filter(where covered_days=0),
    'platforms',coalesce(jsonb_agg(jsonb_build_object('country',country,'platform',platform,'source','game66',
      'state',case when covered_days>0 then 'recorded' else 'no_selected_period_record' end,
      'coveredDays',covered_days,'expectedDays',v_days) order by country,platform),'[]'::jsonb))
   from (
    select g.*,coalesce((select sum(d.covered_days)::integer from daily_group d
      where d.current_period and d.country=g.country and d.platform_key=g.platform_key),0) as covered_days
    from registered_game66 g
   ) observed
  ),
  'canWriteNotes',private.dashboard_admin_live_can_note(),
  'platforms',coalesce((select jsonb_agg(platform order by platform) from (select distinct platform from daily_source union select distinct platform from operator_source) p),'[]'::jsonb),
  'notes',coalesce((select jsonb_agg(jsonb_build_object('date',n.data_date,'country',n.country,'platform',n.platform,'reason',n.reason,'updatedAt',n.updated_at,
    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from public.auto_withdraw_notes n join selected_targets t on (case when upper(btrim(n.country)) in ('巴西','BR','BRAZIL') and upper(btrim(n.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(n.country,n.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(t.platforms)) where n.data_date between v_start and v_end
    and (v_platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
 ) into v_result;
 -- wg_existing_withdraw_v1: only observed WG site-days replace legacy, never add both.
 if jsonb_array_length(v_wg_days)>0 then
  v_result:=v_result||jsonb_build_object('wgCoverage',(
   select jsonb_build_object('timeBasis','created_at','operatorBasis','current_latest_operator',
    'complete',bool_and(w.complete) and count(*)=count(distinct(w.country,w.platform))*(v_end-v_before+1),
    'currentComplete',coalesce(bool_and(w.complete) filter(where w.data_date>=v_start),false)
      and count(*) filter(where w.data_date>=v_start)=count(distinct(w.country,w.platform))*v_days,
    'previousComplete',coalesce(bool_and(w.complete) filter(where w.data_date<v_start),false)
      and count(*) filter(where w.data_date<v_start)=count(distinct(w.country,w.platform))*v_days,
    'days',jsonb_agg(jsonb_build_object('country',w.country,'platform',w.platform,'date',w.data_date,'complete',w.complete,
     'collected',w.total,'paying',w.paying_count,'forced',w.forced_count,'unknown',w.unknown_count) order by w.country,w.platform,w.data_date))
   from jsonb_to_recordset(v_wg_days) w(country text,platform text,data_date date,complete boolean,total bigint,paying_count bigint,forced_count bigint,unknown_count bigint)));
  if (v_result#>>'{wgCoverage,complete}')::boolean is not true then v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);end if;
 end if;
 -- YASH has source statuses and times, but currently collected records do not
 -- identify automatic/manual handling or contain blocking/rejection reasons.
 if jsonb_array_length(v_yash_days)>0 then
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + KB native',
   'yashCoverage',(select jsonb_build_object('source','KB','timeBasis','created_at','operatorBasis','current_latest_operator',
    'classificationAvailable',false,'reasonAvailable',false,
    'currentComplete',coalesce(bool_and(y.complete) filter(where y.data_date>=v_start),false),
    'previousComplete',coalesce(bool_and(y.complete) filter(where y.data_date<v_start),false),
    'latestCollectedAt',max(y.updated_at) filter(where y.data_date>=v_start),
    'days',jsonb_agg(jsonb_build_object('country',y.country,'platform',y.platform,'date',y.data_date,'complete',y.complete,'total',y.total,
     'pendingCount',y.pending_count,'failedCount',y.failed_count,'unknownStatusCount',y.unknown_count,'latestCollectedAt',y.updated_at) order by y.country,y.platform,y.data_date))
    from jsonb_to_recordset(v_yash_days)y(data_date date,country text,platform text,total bigint,complete boolean,updated_at timestamptz,pending_count bigint,failed_count bigint,unknown_count bigint)));
  if (v_result#>>'{yashCoverage,currentComplete}')::boolean is not true or (v_result#>>'{yashCoverage,previousComplete}')::boolean is not true
   then v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);end if;
  v_yash_rows:='[]'::jsonb;
  for v_yash_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_yash_days)y(country text,platform_key text)
     where y.country=v_yash_item->>'country' and y.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')) then
    v_yash_from:=case when v_daily then (v_yash_item->>'dataDate')::date else v_start end;
    v_yash_to:=case when v_daily then v_yash_from else v_end end;
    select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null,
     'unclassifiedCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'otherStatusCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint)-(v_yash_item->>'success')::bigint-(v_yash_item->>'rejected')::bigint,
     'complete',coalesce(bool_and(y.complete),false),'coveredDays',count(*) filter(where y.complete),'expectedDays',v_yash_to-v_yash_from+1,
     'latestCollectedAt',max(y.updated_at),'durationBasis','created_to_completed') into v_yash_meta
    from jsonb_to_recordset(v_yash_days)y(data_date date,country text,platform_key text,complete boolean,updated_at timestamptz)
    where y.country=v_yash_item->>'country' and y.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') and y.data_date between v_yash_from and v_yash_to;
    v_yash_item:=v_yash_item||v_yash_meta;
    if v_yash_item->'previous' is not null and v_yash_item->'previous'<>'null'::jsonb then
     v_yash_from:=case when v_daily then v_yash_from-1 else v_before end;
     v_yash_to:=case when v_daily then v_yash_to-1 else v_start-1 end;
     select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null,
      'unclassifiedCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'complete',coalesce(bool_and(y.complete),false),'coveredDays',count(*) filter(where y.complete),'expectedDays',v_yash_to-v_yash_from+1,
      'latestCollectedAt',max(y.updated_at),'durationBasis','created_to_completed') into v_yash_prior
     from jsonb_to_recordset(v_yash_days)y(data_date date,country text,platform_key text,complete boolean,updated_at timestamptz)
     where y.country=v_yash_item->>'country' and y.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') and y.data_date between v_yash_from and v_yash_to;
     if (v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean then
      v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     else v_yash_item:=jsonb_set(v_yash_item,'{previous}','null'::jsonb);end if;
    end if;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  foreach v_yash_period in array array['totals','previousTotals'] loop
   if exists(select 1 from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where y.total is not null and (case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end)) then
    v_yash_meta:=jsonb_build_object('classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null);
    if v_view='auto' then
     select v_yash_meta||jsonb_build_object('unclassifiedCount',coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint,0)+coalesce(sum(y.total),0)) into v_yash_meta
     from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end;
    end if;
    if v_result->v_yash_period is not null and v_result->v_yash_period<>'null'::jsonb then
     v_result:=jsonb_set(v_result,array[v_yash_period],(v_result->v_yash_period)||v_yash_meta);
    end if;
   end if;
  end loop;
 end if;
 -- NewAR detail coverage and explicit unknowns; no legacy source fallback.
 if jsonb_array_length(v_newar_days)>0 then
  v_result:=v_result||jsonb_build_object('newarCoverage',(
   select jsonb_build_object('source','NEWAR','timeBasis','created_at','operatorBasis','current_latest_operator','operatorExcludesExplicitAutomatic',true,
    'currentComplete',coalesce(bool_and(n.complete) filter(where n.data_date>=v_start),false),
    'previousComplete',coalesce(bool_and(n.complete) filter(where n.data_date<v_start),false),
    'latestCollectedAt',max(n.updated_at) filter(where n.data_date>=v_start),
    'days',jsonb_agg(jsonb_build_object('country',n.country,'platform',n.platform,'date',n.data_date,'complete',n.complete,
     'total',n.total,'pendingCount',n.pending_count,'unknownStatusCount',n.unknown_count,'unclassifiedCount',n.unclassified_count,
     'currencies',n.currencies,'currencyUnknownCount',n.currency_unknown_count,'latestCollectedAt',n.updated_at) order by n.country,n.platform,n.data_date))
   from jsonb_to_recordset(v_newar_days)n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)));
  if (v_result#>>'{newarCoverage,currentComplete}')::boolean is not true or (v_result#>>'{newarCoverage,previousComplete}')::boolean is not true then
   v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);
  end if;
  v_yash_rows:='[]'::jsonb;
  for v_yash_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_newar_days)n(country text,platform_key text)
    where n.country=v_yash_item->>'country' and n.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')) then
    v_yash_from:=case when v_daily then (v_yash_item->>'dataDate')::date else v_start end;
    v_yash_to:=case when v_daily then v_yash_from else v_end end;
    select jsonb_build_object('source','NEWAR','statisticBasis','created_at_current_status','classificationAvailable',true,
     'classificationComplete',count(n.total)=count(*) and count(*)>0 and coalesce(sum(n.unclassified_count),0)=0,'complete',bool_and(n.complete),
     'coveredDays',count(*) filter(where n.complete),'expectedDays',v_yash_to-v_yash_from+1,
     'latestCollectedAt',max(n.updated_at),'durationBasis','source_submitted_to_handled')||
     case when v_view='auto' then jsonb_build_object('pendingCount',sum(n.pending_count),'unknownStatusCount',sum(n.unknown_count),
      'unclassifiedCount',sum(n.unclassified_count),'currencyUnknownCount',sum(n.currency_unknown_count)) else '{}'::jsonb end into v_yash_meta
    from jsonb_to_recordset(v_newar_days)n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
    where n.country=v_yash_item->>'country' and n.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')
     and n.data_date between v_yash_from and v_yash_to;
    v_yash_item:=v_yash_item||v_yash_meta;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then
   foreach v_yash_period in array array['totals','previousTotals'] loop
    if v_result->v_yash_period->'total'='null'::jsonb then
     v_result:=jsonb_set(v_result,array[v_yash_period,'unclassifiedCount'],'null'::jsonb);
    end if;
   end loop;
  end if;
 end if;
 return v_result;
end;
$function$

;
