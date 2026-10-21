-- Read-only function definitions captured 2026-10-21. No production rows or credentials.
CREATE OR REPLACE FUNCTION private.withdraw_prepared_render(p_request jsonb, p_bundle jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_start date;v_end date;v_before date;v_days integer;
 v_country text;v_platforms text[];v_panghu text[];v_account text;v_key text;v_view text;v_sort text;v_asc boolean;
 v_limit integer;v_offset integer;v_result jsonb;v_game jsonb:='{}'::jsonb;v_daily boolean;
 v_targets jsonb;v_target jsonb;v_game_part jsonb;v_target_platforms text[];v_wg_days jsonb;v_yash_days jsonb;v_yash_item jsonb;v_yash_rows jsonb;v_yash_meta jsonb;v_yash_prior jsonb;v_yash_from date;v_yash_to date;v_yash_period text;v_newar_days jsonb;v_ar_history_durations jsonb:='[]'::jsonb;v_ar_days jsonb;v_ar_rows jsonb;v_ar_item jsonb;v_ar_meta jsonb;v_duoli_days jsonb;v_duoli_rows jsonb;v_duoli_item jsonb;v_duoli_meta jsonb;v_duoli_total bigint;v_duoli_period text;v_game_rows jsonb;v_game_item jsonb;v_npg jsonb;v_npg_coverage jsonb;
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
   v_game_part:=coalesce(p_bundle#>ARRAY['game66',v_target->>'country'],'{"rows":[],"operatorRows":[]}'::jsonb);
   v_game:=jsonb_build_object('rows',coalesce(v_game->'rows','[]'::jsonb)||coalesce(v_game_part->'rows','[]'::jsonb),
     'operatorRows',coalesce(v_game->'operatorRows','[]'::jsonb)||coalesce(v_game_part->'operatorRows','[]'::jsonb));
  end if;
 end loop;
 -- Brazil-labelled rows can only enter the Brazil/Panghu targets under this
 -- exact mapping. If that shared mapping changes, retain the original path.
 if exists(select 1 from jsonb_array_elements(v_targets)t where t->>'country' in('巴西','胖虎巴西'))
  or (select md5(prosrc) from pg_catalog.pg_proc where oid='private.dashboard_admin_live_report_country(text,text)'::regprocedure)
     is distinct from '74d85bb2dba1eb0789225883caa922b1' then
 select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
 else v_panghu:=null;end if;
 -- NPG reports are read live from verified immutable receipts, never stored in native bundles.
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_npg
 from private.npg_withdraw_report_snapshots(v_before,v_end,v_scope,v_targets,p_request)n;
 select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into v_wg_days
 from jsonb_to_recordset(p_bundle->'wg') AS w(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, paying_count bigint, forced_count bigint, unknown_count bigint);
 select coalesce(jsonb_agg(to_jsonb(y)),'[]'::jsonb) into v_yash_days
 from jsonb_to_recordset(p_bundle->'yash') AS y(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, failed_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb);
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_newar_days
 from jsonb_to_recordset(p_bundle->'newar') AS n(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, pending_count bigint, unknown_count bigint, unclassified_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, currencies jsonb, currency_unknown_count bigint);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into v_ar_days
 from jsonb_to_recordset(p_bundle->'ar') AS a(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[]);
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into v_duoli_days
 from jsonb_to_recordset(p_bundle->'duoli') AS d(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, operator_rows jsonb);
 if v_view='auto' and v_before<date '2026-10-10' then
  select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) into v_ar_history_durations
  from jsonb_to_recordset(p_bundle->'arHistory') AS h(data_date date, country text, platform_key text, alias_keys text[], duration_sample_count bigint, duration_total_seconds numeric, generated_at timestamp with time zone);
 end if;
 with selected_targets as materialized (
  select value->>'country' as country,case when jsonb_typeof(value->'platforms')='array'
    then array(select private.dashboard_admin_live_withdraw_key(p) from jsonb_array_elements_text(value->'platforms')p) end as platforms
  from jsonb_array_elements(v_targets)
 ), selected_ar_report_aliases as materialized (
  -- Reuse the already fresh, scoped AR catalog mapping. Only the confirmed
  -- India LOTTERY7/LOTTERY77 family may expand a user's selected report names.
  -- A second native AR identity occupying either name disables this expansion.
  select distinct a.country,a.platform_key,a.alias_keys
  from jsonb_to_recordset(v_ar_days) a(country text,platform_key text,alias_keys text[])
  where a.country='印度' and a.platform_key='LOTTERY7'
   and a.alias_keys @> array['LOTTERY7','LOTTERY77']::text[]
   and a.alias_keys <@ array['LOTTERY7','LOTTERY77']::text[]
   and not exists(select 1 from jsonb_to_recordset(v_ar_days) z(country text,platform_key text,alias_keys text[])
    where z.country=a.country and z.platform_key is distinct from a.platform_key and z.alias_keys&&a.alias_keys)
 ), snapshot_window as not materialized (
  select s.* from public.newar_business_snapshots s
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.stat_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
   and not exists(select 1 from jsonb_populate_recordset(null::public.newar_business_snapshots,v_npg)n
    where n.stat_date=s.stat_date and n.country=private.dashboard_admin_live_report_country(s.country,s.platform)
     and private.dashboard_admin_live_withdraw_key(n.platform)=private.dashboard_admin_live_withdraw_key(s.platform))
  union all select n.* from jsonb_populate_recordset(null::public.newar_business_snapshots,v_npg)n
 ), daily_window as not materialized (
  select a.data_date,a.country,a.platform,a.total,a.success,a.rejected,a.auto_count,a.manual_count,a.avg_seconds,a.source_updated_at,a.updated_at
  from public.auto_withdraw_daily a where a.data_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
 ), operator_window as not materialized (
  select o.data_date,o.country,o.platform,o.account,o.processed,o.rejected,o.avg_seconds,o.source_updated_at,o.updated_at
  from public.withdraw_operator_daily o where o.data_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
 ), notes_window as not materialized (
  select n.* from public.auto_withdraw_notes n where n.data_date between v_start and v_end
 ), raw_identities as materialized (
  select country,platform from snapshot_window
  union select country,platform from daily_window
  union select country,platform from operator_window
  union select country,platform from notes_window
 ), mapped_identities as materialized (
  select i.country as source_country,i.platform as source_platform,
   case when upper(btrim(i.country)) in ('巴西','BR','BRAZIL') and upper(btrim(i.platform))=any(v_panghu)
    then '胖虎巴西' else private.dashboard_admin_live_report_country(i.country,i.platform) end as target_country,
   private.dashboard_admin_live_withdraw_key(i.platform) as platform_key
  from raw_identities i
 ), selected_identities as materialized (
  select i.source_country,i.source_platform,i.platform_key,t.country
  from mapped_identities i join selected_targets t on i.target_country=t.country
   and (t.platforms is null or i.platform_key=any(t.platforms)
    or exists(select 1 from selected_ar_report_aliases a where a.country=t.country
     and i.platform_key=any(a.alias_keys) and a.alias_keys&&t.platforms))
 ), authorized_report_identities as materialized (
  -- Exact same target-country/native-platform grant as each report lane, evaluated once per identity.
  -- Notes retain their original raw-country authorization below.
  select i.* from selected_identities i
  where private.dashboard_scope_allows(v_scope,i.country,i.source_platform)
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
  select s.*,t.platform_key as platform_key,t.country as target_country from snapshot_window s
  join authorized_report_identities t on coalesce(s.country,'')=coalesce(t.source_country,'') and coalesce(s.platform,'')=coalesce(t.source_platform,'') and s.country is not distinct from t.source_country and s.platform is not distinct from t.source_platform
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.stat_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
 ), legacy_daily as (
  select distinct on(a.data_date,t.country,t.platform_key)
   a.data_date,t.country as country,a.platform,t.platform_key as platform_key,
   a.total::bigint,a.success::bigint,a.rejected::bigint,a.auto_count::bigint,
   coalesce(a.manual_count,greatest(a.total-a.auto_count,0))::bigint as manual_count,a.avg_seconds::numeric,
   a.source_updated_at,a.updated_at,
   case when a.avg_seconds is not null and a.total>0 then a.total else 0 end::bigint as duration_sample_count,
   case when a.total>0 then a.avg_seconds*a.total end::numeric as duration_total_seconds,
   'source_reported_processing'::text as duration_basis
  from daily_window a join authorized_report_identities t on coalesce(a.country,'')=coalesce(t.source_country,'') and coalesce(a.platform,'')=coalesce(t.source_platform,'') and a.country is not distinct from t.source_country and a.platform is not distinct from t.source_platform where a.data_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=t.platform_key and n.payload ? 'rows')
  order by a.data_date,t.country,t.platform_key,coalesce(a.updated_at,a.source_updated_at) desc
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
  select distinct on(o.data_date,t.country,t.platform_key,o.account)
   o.data_date,t.country as country,o.platform,t.platform_key as platform_key,o.account,
   o.processed::bigint,o.rejected::bigint,o.avg_seconds::numeric,o.source_updated_at,o.updated_at,
   case when o.avg_seconds is not null and o.processed>0 then o.processed else 0 end::bigint as duration_sample_count,
   case when o.processed>0 then o.avg_seconds*o.processed end::numeric as duration_total_seconds,
   'source_reported_processing'::text as duration_basis
  from operator_window o join authorized_report_identities t on coalesce(o.country,'')=coalesce(t.source_country,'') and coalesce(o.platform,'')=coalesce(t.source_platform,'') and o.country is not distinct from t.source_country and o.platform is not distinct from t.source_platform where o.data_date between v_before and v_end and private.withdraw_window_whole_days(p_request)
   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=t.platform_key and n.payload ? 'operator_rows')
  order by o.data_date,t.country,t.platform_key,o.account,coalesce(o.updated_at,o.source_updated_at) desc
 ), prior_operator_source as not materialized (
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
 ), duoli_operator_classes as materialized (
  select d.data_date,d.country,d.platform_key,r->>'account' account,
   (r->>'auto_count')::bigint auto_count,(r->>'manual_count')::bigint manual_count,
   (r->>'unclassified_count')::bigint unclassified_count
  from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform_key text,operator_rows jsonb)
   cross join lateral jsonb_array_elements(d.operator_rows)r
 ), duoli_days as materialized (
  select d.*,c.auto_count,c.manual_count
  from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)
  left join (select data_date,country,platform_key,sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count
   from duoli_operator_classes group by 1,2,3)c using(data_date,country,platform_key)
 ), duoli_operator_class_group as materialized (
  select country,platform_key,account,case when v_daily then data_date else v_start end group_date,
   (data_date>=v_start) current_period,sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count,
   sum(unclassified_count)::bigint unclassified_count
  from duoli_operator_classes group by 1,2,3,4,5
 ), ar_days as materialized (
  select * from jsonb_to_recordset(v_ar_days) a(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,alias_keys text[])
 ), historical_newar_duration as materialized (
  -- Only observed prior source-report time may fill a missing prior native time.
  -- The native cohort/counts and current period are never replaced by a report.
  select p.data_date,p.country,p.platform_key,
   sum(p.duration_sample_count)::bigint duration_sample_count,
   sum(p.duration_total_seconds) duration_total_seconds,
   sum(p.duration_total_seconds)/nullif(sum(p.duration_sample_count),0) avg_seconds
  from prior_daily_source p
  where p.data_date<v_start and p.duration_sample_count>0 and p.duration_total_seconds is not null
   and exists(select 1 from newar_days n where n.data_date=p.data_date and n.country=p.country and n.platform_key=p.platform_key
    and n.avg_seconds is null and coalesce(n.duration_sample_count,0)=0)
  group by p.data_date,p.country,p.platform_key
 ), historical_ar_duration as materialized (
  select * from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],
   duration_sample_count bigint,duration_total_seconds numeric,generated_at timestamptz)
  where h.duration_sample_count>0
 ), prior_ar_duration_rows as not materialized (
  select p.*,h.duration_sample_count native_sample_count,h.duration_total_seconds native_total_seconds,
   row_number() over(partition by p.data_date,p.country,h.platform_key order by p.platform_key,p.platform,p.total,p.success,p.rejected,p.auto_count,p.manual_count,
    p.duration_sample_count,p.duration_total_seconds,p.source_updated_at,p.updated_at) native_rank
  from prior_daily_source p left join historical_ar_duration h on h.data_date=p.data_date and h.country=p.country and p.platform_key=any(h.alias_keys)
 ), prior_ar_duration_source as materialized (
  -- One canonical/day native pool is attached once even when reports expose several aliases or rows.
  -- Keep every report count, classification and timestamp; only replace processing-time fields.
  select p.data_date,p.country,p.platform,p.platform_key,p.total,p.success,p.rejected,p.auto_count,p.manual_count,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_total_seconds/nullif(p.native_sample_count,0) end else p.avg_seconds end avg_seconds,
   p.source_updated_at,p.updated_at,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_sample_count else 0 end else p.duration_sample_count end duration_sample_count,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_total_seconds else 0 end else p.duration_total_seconds end duration_total_seconds,
   case when p.native_sample_count is not null then 'applied_to_completed' else p.duration_basis end duration_basis
  from prior_ar_duration_rows p
 ), daily_source as materialized (
  select p.* from prior_ar_duration_source p where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
   and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
   and not exists(select 1 from ar_days a where a.country=p.country and p.platform_key=any(a.alias_keys) and a.data_date=p.data_date)
   and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
   and not exists(select 1 from duoli_days d where d.country=p.country and d.platform_key=p.platform_key)
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   coalesce((select sum((r->>'duration_sample_count')::bigint) from jsonb_array_elements(operator_rows) r),0)::bigint,
   (select sum((r->>'duration_total_seconds')::numeric) from jsonb_array_elements(operator_rows) r),
   'created_to_operated'::text from wg_days
  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.
  union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null
  union all select n.data_date,n.country,n.platform,n.platform_key,n.total,n.success,n.rejected,n.auto_count,n.manual_count,
   case when h.duration_sample_count is not null then h.avg_seconds else n.avg_seconds end,n.source_updated_at,n.updated_at,
   case when h.duration_sample_count is not null then h.duration_sample_count else n.duration_sample_count end,
   case when h.duration_sample_count is not null then h.duration_total_seconds else n.duration_total_seconds end,
   case when h.duration_sample_count is not null then 'source_reported_processing' when (n.country='印度' and n.platform_key in('MAANWIN','DHANIWIN') and n.data_date>=date '2026-10-10') or (n.country='巴基斯坦' and n.platform_key in('POPZAR','92BLAZE') and n.data_date>=date '2026-10-12') then 'created_to_submitted' else 'source_submitted_to_handled' end::text
  from newar_days n left join historical_newar_duration h on h.data_date=n.data_date and h.country=n.country and h.platform_key=n.platform_key
   and n.avg_seconds is null and coalesce(n.duration_sample_count,0)=0
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'applied_to_completed'::text from ar_days where total is not null
  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_reported_audit_duration'::text from duoli_days where total is not null
 ), operator_source as not materialized (
  select p.*,greatest(p.processed-p.rejected,0) as success from prior_operator_source p
   where not exists(select 1 from wg_days w where w.data_date=p.data_date and w.country=p.country and w.platform_key=p.platform_key)
    and not exists(select 1 from yash_days y where y.data_date=p.data_date and y.country=p.country and y.platform_key=p.platform_key)
    and not exists(select 1 from ar_days a where a.country=p.country and p.platform_key=any(a.alias_keys) and a.data_date=p.data_date)
    and not exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
   and not exists(select 1 from duoli_days d where d.country=p.country and d.platform_key=p.platform_key)
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
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,
   case when (n.country='印度' and n.platform_key in('MAANWIN','DHANIWIN') and n.data_date>=date '2026-10-10') or (n.country='巴基斯坦' and n.platform_key in('POPZAR','92BLAZE') and n.data_date>=date '2026-10-12') then 'created_to_submitted' else 'source_submitted_to_handled' end::text,(r->>'success')::bigint
  from newar_days n cross join lateral jsonb_array_elements(n.operator_rows) r
  union all select a.data_date,a.country,a.platform,a.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'applied_to_completed'::text,(r->>'success')::bigint
  from ar_days a cross join lateral jsonb_array_elements(a.operator_rows) r
  union all select d.data_date,d.country,d.platform,d.platform_key,r->>'account',(r->>'processed')::bigint,(r->>'rejected')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   (r->>'duration_sample_count')::bigint,(r->>'duration_total_seconds')::numeric,'source_reported_audit_duration'::text,(r->>'success')::bigint
  from duoli_days d cross join lateral jsonb_array_elements(d.operator_rows) r
 ), daily as materialized (
  select d.* from daily_source d where v_platforms is null or d.platform_key=any(v_platforms)
   or exists(select 1 from ar_days a where a.country=d.country and a.platform_key=d.platform_key and a.data_date=d.data_date and a.alias_keys&&v_platforms)
   or exists(select 1 from selected_ar_report_aliases a where a.country=d.country
    and d.platform_key=any(a.alias_keys) and a.alias_keys&&v_platforms)
 ), operators as materialized (
  select o.* from operator_source o where v_view='operators' and (v_platforms is null or o.platform_key=any(v_platforms)
   or exists(select 1 from ar_days a where a.country=o.country and a.platform_key=o.platform_key and a.data_date=o.data_date and a.alias_keys&&v_platforms)
   or exists(select 1 from selected_ar_report_aliases a where a.country=o.country
    and o.platform_key=any(a.alias_keys) and a.alias_keys&&v_platforms))
   and (v_account is null or position(lower(v_account) in lower(o.account))>0)
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
   'durationTotalSeconds',p.duration_total_seconds,'durationBasis',p.duration_basis,'coveredDays',p.covered_days)
    ||case when pc.platform_key is not null then jsonb_build_object('autoCount',pc.auto_count,'manualCount',pc.manual_count,
      'unclassifiedCount',pc.unclassified_count,'operatorClass',case when pc.auto_count>0 and pc.manual_count=0 and pc.unclassified_count=0 then 'auto'
       when pc.manual_count>0 and pc.auto_count=0 and pc.unclassified_count=0 then 'manual' else 'unknown' end) else '{}'::jsonb end end)
   ||case when c.platform_key is not null then jsonb_build_object('autoCount',c.auto_count,'manualCount',c.manual_count,
     'unclassifiedCount',c.unclassified_count,'operatorClass',case when c.auto_count>0 and c.manual_count=0 and c.unclassified_count=0 then 'auto'
      when c.manual_count>0 and c.auto_count=0 and c.unclassified_count=0 then 'manual' else 'unknown' end) else '{}'::jsonb end
  from operator_group d left join operator_group p on p.country=d.country and p.platform_key=d.platform_key and p.account=d.account
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  left join duoli_operator_class_group c on c.country=d.country and c.platform_key=d.platform_key and c.account=d.account
    and c.group_date=d.group_date and c.current_period=d.current_period
  left join duoli_operator_class_group pc on pc.country=p.country and pc.platform_key=p.platform_key and pc.account=p.account
    and pc.group_date=p.group_date and pc.current_period=p.current_period
  where d.current_period and v_view='operators'
 ), presented as materialized (
  select p.country,p.platform,p.platform_key,p.group_date,p.account,
   case when exists(select 1 from duoli_days d where d.country=p.country and d.platform_key=p.platform_key)
    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity')
   when exists(select 1 from ar_days a where a.country=p.country and a.platform_key=p.platform_key
     and a.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end)
    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity')
   when exists(select 1 from newar_days n where n.country=p.country and n.platform_key=p.platform_key)
    and (not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end),false)
    or not coalesce((select bool_and(n.complete) from newar_days n where n.country=p.country and n.platform_key=p.platform_key
     and n.data_date between case when v_daily then p.group_date-1 else v_before end and case when v_daily then p.group_date-1 else v_start-1 end),false))
    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned')
   when exists(select 1 from yash_days y where y.country=p.country and y.platform_key=p.platform_key)
    and (not coalesce((select bool_and(y.complete) from yash_days y where y.country=p.country and y.platform_key=p.platform_key
      and y.data_date between case when v_daily then p.group_date else v_start end and case when v_daily then p.group_date else v_end end),false)
     or not coalesce((select bool_and(y.complete) from yash_days y where y.country=p.country and y.platform_key=p.platform_key
      and y.data_date between case when v_daily then p.group_date-1 else v_before end and case when v_daily then p.group_date-1 else v_start-1 end),false))
    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned') else p.item end item
  from raw_presented p
 ), sortable as (
  select *,case when v_sort in('country','platform','account') then item->>v_sort end sort_text,
   case v_sort when 'country' then null when 'platform' then null when 'account' then null
    when 'successRate' then (item->>'success')::numeric/nullif(coalesce(item->>'total',item->>'processed')::numeric,0)
    when 'rejectRate' then (item->>'rejected')::numeric/nullif(coalesce(item->>'total',item->>'processed')::numeric,0)
    when 'autoRate' then (item->>'autoCount')::numeric/nullif((item->>'total')::numeric,0)
    when 'manualRate' then (item->>'manualCount')::numeric/nullif((item->>'total')::numeric,0)
    when 'previousAvgSeconds' then (item->'previous'->>'avgSeconds')::numeric
    when 'durationChange' then case when item->>'durationBasis'=any(array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing','created_to_submitted'])
      and item->>'durationBasis'=item->'previous'->>'durationBasis'
      and item->>'avgSeconds' not in('NaN','Infinity','-Infinity') and item->'previous'->>'avgSeconds' not in('NaN','Infinity','-Infinity')
      and (item->>'avgSeconds')::numeric>=0 and (item->'previous'->>'avgSeconds')::numeric>=0
      then case when (item->'previous'->>'avgSeconds')::numeric=0 then case when (item->>'avgSeconds')::numeric=0 then 0 end
       else (item->>'avgSeconds')::numeric/(item->'previous'->>'avgSeconds')::numeric-1 end end
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
    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from notes_window n join selected_identities t on coalesce(n.country,'')=coalesce(t.source_country,'') and coalesce(n.platform,'')=coalesce(t.source_platform,'') and n.country is not distinct from t.source_country and n.platform is not distinct from t.source_platform where n.data_date between v_start and v_end
    and (v_platforms is null or t.platform_key=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
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
 -- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,
 -- including prior dates. Source statuses/operators, notes and coverage remain unchanged.
 if jsonb_array_length(v_yash_days)>0 then
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + KB native',
   'yashCoverage',(select jsonb_build_object('source','KB','timeBasis','created_at','operatorBasis','current_latest_operator',
    'classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
    'reasonAvailable',true,'sourceNotesAvailable',true,
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
    select jsonb_build_object('source','KB','classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
     'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end,
     'otherStatusCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint)-(v_yash_item->>'success')::bigint-(v_yash_item->>'rejected')::bigint,
     'complete',coalesce(bool_and(y.complete),false),'coveredDays',count(*) filter(where y.complete),'expectedDays',v_yash_to-v_yash_from+1,
     'latestCollectedAt',max(y.updated_at),'durationBasis','created_to_completed') into v_yash_meta
    from jsonb_to_recordset(v_yash_days)y(data_date date,country text,platform_key text,complete boolean,updated_at timestamptz)
    where y.country=v_yash_item->>'country' and y.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') and y.data_date between v_yash_from and v_yash_to;
    v_yash_item:=v_yash_item||v_yash_meta;
    if v_yash_item->'previous' is not null and v_yash_item->'previous'<>'null'::jsonb then
     v_yash_from:=case when v_daily then v_yash_from-1 else v_before end;
     v_yash_to:=case when v_daily then v_yash_to-1 else v_start-1 end;
     select jsonb_build_object('source','KB','classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
      'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end,
      'complete',coalesce(bool_and(y.complete),false),'coveredDays',count(*) filter(where y.complete),'expectedDays',v_yash_to-v_yash_from+1,
      'latestCollectedAt',max(y.updated_at),'durationBasis','created_to_completed') into v_yash_prior
     from jsonb_to_recordset(v_yash_days)y(data_date date,country text,platform_key text,complete boolean,updated_at timestamptz)
     where y.country=v_yash_item->>'country' and y.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') and y.data_date between v_yash_from and v_yash_to;
     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     if not ((v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean) then
      v_yash_item:=v_yash_item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned');
     end if;
    end if;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  foreach v_yash_period in array array['totals','previousTotals'] loop
   if exists(select 1 from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where y.total is not null and (case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end)) then
    -- Native YASH manual counts are already included once in daily/totals.
    -- Other sources' genuinely unclassified rows remain separate.
    v_yash_meta:=jsonb_build_object('classificationAvailable',v_view='auto',
     'classificationPartial',v_view='auto' and coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint>0,false),
     'classificationComparable',v_view='auto' and coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint=0,false),
     'reasonAvailable',false);
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
     'latestCollectedAt',max(n.updated_at),'durationBasis',
      case when v_yash_item->>'country'='印度' and private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') in('MAANWIN','DHANIWIN')
       then case when v_yash_from>=date '2026-10-10' then 'created_to_submitted' else v_yash_item->>'durationBasis' end
       when v_yash_item->>'country'='巴基斯坦' and private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform') in('POPZAR','92BLAZE')
       then case when v_yash_from>=date '2026-10-12' then 'created_to_submitted' else v_yash_item->>'durationBasis' end
       else 'source_submitted_to_handled' end)||
     case when v_view='auto' then jsonb_build_object('pendingCount',sum(n.pending_count),'unknownStatusCount',sum(n.unknown_count),
      'unclassifiedCount',sum(n.unclassified_count),'currencyUnknownCount',sum(n.currency_unknown_count)) else '{}'::jsonb end into v_yash_meta
    from jsonb_to_recordset(v_newar_days)n(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint)
    where n.country=v_yash_item->>'country' and n.platform_key=private.dashboard_admin_live_withdraw_key(v_yash_item->>'platform')
     and n.data_date between v_yash_from and v_yash_to;
    v_yash_item:=v_yash_item||v_yash_meta;
    if v_yash_item->>'durationBasis'='created_to_submitted' then
     v_yash_item:=v_yash_item||jsonb_build_object('durationSource','native_created_to_submitted','durationCompletenessVerified',false);
    end if;
    if v_yash_item#>>'{previous,durationBasis}'='created_to_submitted' then
     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||
      jsonb_build_object('durationSource','native_created_to_submitted','durationCompletenessVerified',false));
    end if;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then
     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||
      jsonb_build_object('durationSource','historical_source_report','durationCompletenessVerified',false));
    end if;
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
 -- AR41 raw-fact cutover: no stale summary or self-certified completeness.
 if jsonb_array_length(v_ar_days)>0 then
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + AR raw orders',
   'arCoverage',(select jsonb_build_object('source','AR','timeBasis','applied_at','operatorBasis','current_latest_operator',
    'successBasis','legacy_withdraw_daily_including_submitted','operatorSuccessBasis','processed_minus_rejected',
    'complete',false,'currentComplete',false,'previousComplete',false,'expected',null,
    'coverageBasis','unverified_source_continuity','latestCollectedAt',max(a.updated_at) filter(where a.data_date>=v_start),
    'days',jsonb_agg(jsonb_build_object('country',a.country,'platform',a.platform,'date',a.data_date,
     'collected',a.total,'expected',null,'complete',false,'state',case when a.total is null then 'no_received_facts' else 'received_facts_unverified' end,
     'latestCollectedAt',a.updated_at) order by a.country,a.platform,a.data_date))
    from jsonb_to_recordset(v_ar_days)a(data_date date,country text,platform text,total bigint,updated_at timestamptz)));
  v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);
  v_ar_rows:='[]'::jsonb;
  for v_ar_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_ar_days)a(data_date date,country text,platform_key text,alias_keys text[])
     where a.country=v_ar_item->>'country' and private.dashboard_admin_live_withdraw_key(v_ar_item->>'platform')=any(a.alias_keys)
      and a.data_date between case when v_daily then (v_ar_item->>'dataDate')::date else v_start end
                         and case when v_daily then (v_ar_item->>'dataDate')::date else v_end end) then
    v_ar_item:=v_ar_item||jsonb_build_object('source','AR','statisticBasis','applied_at_current_status',
     'complete',false,'sourceCompletenessVerified',false,'coverageBasis','unverified_source_continuity',
     'durationBasis','applied_to_completed','comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
   end if;
   v_ar_rows:=v_ar_rows||jsonb_build_array(v_ar_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_ar_rows);
 end if;
 if v_view='auto' and jsonb_array_length(v_ar_history_durations)>0 then
  v_ar_rows:='[]'::jsonb;
  for v_ar_item in select value from jsonb_array_elements(v_result->'rows') loop
   if v_ar_item->>'durationBasis'='applied_to_completed' and exists(
    select 1 from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],duration_sample_count bigint)
    where h.country=v_ar_item->>'country' and private.dashboard_admin_live_withdraw_key(v_ar_item->>'platform')=any(h.alias_keys) and h.duration_sample_count>0
     and h.data_date between case when v_daily then (v_ar_item->>'dataDate')::date else v_start end and case when v_daily then (v_ar_item->>'dataDate')::date else v_end end) then
    v_ar_item:=v_ar_item||jsonb_build_object('durationSource','native_historical_cache','durationCacheVerified',true,'durationCompletenessVerified',false);
   end if;
   if v_ar_item#>>'{previous,durationBasis}'='applied_to_completed' and exists(
    select 1 from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],duration_sample_count bigint)
    where h.country=v_ar_item->>'country' and private.dashboard_admin_live_withdraw_key(v_ar_item->>'platform')=any(h.alias_keys) and h.duration_sample_count>0
     and h.data_date between case when v_daily then (v_ar_item->>'dataDate')::date-1 else v_before end and case when v_daily then (v_ar_item->>'dataDate')::date-1 else v_start-1 end) then
    v_ar_item:=jsonb_set(v_ar_item,'{previous}',(v_ar_item->'previous')||jsonb_build_object('durationSource','native_historical_cache','durationCacheVerified',true,'durationCompletenessVerified',false));
   end if;
   v_ar_rows:=v_ar_rows||jsonb_build_array(v_ar_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_ar_rows);
 end if;
 -- duoli_native_operator_classification_v2: original collector rule, no status-based inference.
 if jsonb_array_length(v_duoli_days)>0 then
  v_duoli_meta:=jsonb_build_object('source','DUOLI','statisticBasis','created_at_current_status',
   'operatorBasis','source_operator','classificationAvailable',true,'classificationComparable',false,
   'reasonAvailable',false,'reasonAvailabilityBasis','not_ingested','reasonUnavailableMessage','原因字段未入库','complete',false,
   'sourceCompletenessVerified',false,'coverageBasis','unverified_source_continuity',
   'durationBasis','source_reported_audit_duration','comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
  v_result:=v_result||jsonb_build_object('source',v_result->>'source'||' + DUOLI native orders',
   'duoliCoverage',(select jsonb_build_object('source','DUOLI','timeBasis','created_at','operatorBasis','source_operator',
    'classificationAvailable',true,'complete',false,'currentComplete',false,'previousComplete',false,
    'coverageBasis','unverified_source_continuity','days',jsonb_agg(jsonb_build_object('date',d.data_date,
     'country',d.country,'platform',d.platform,'collected',d.total,'complete',false,
     'state',case when d.total is null then 'no_received_facts' else 'received_facts_unverified' end,
     'latestCollectedAt',d.updated_at) order by d.country,d.platform,d.data_date))
    from jsonb_to_recordset(v_duoli_days)d(data_date date,country text,platform text,total bigint,updated_at timestamptz)));
  v_result:=jsonb_set(v_result,'{comparison,complete}','false'::jsonb);
  v_duoli_rows:='[]'::jsonb;
  for v_duoli_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_to_recordset(v_duoli_days)d(country text,platform_key text)
    where d.country=v_duoli_item->>'country' and d.platform_key=private.dashboard_admin_live_withdraw_key(v_duoli_item->>'platform')) then
    v_duoli_item:=v_duoli_item||v_duoli_meta||jsonb_build_object('classificationPartial',coalesce((v_duoli_item->>'unclassifiedCount')::bigint>0,false));
    if jsonb_typeof(v_duoli_item->'previous')='object' then
     v_duoli_item:=jsonb_set(v_duoli_item,'{previous}',(v_duoli_item->'previous')||v_duoli_meta
      ||jsonb_build_object('classificationPartial',coalesce((v_duoli_item#>>'{previous,unclassifiedCount}')::bigint>0,
       coalesce((v_duoli_item#>>'{previous,total}')::bigint,0)-(v_duoli_item#>>'{previous,autoCount}')::bigint-(v_duoli_item#>>'{previous,manualCount}')::bigint>0,false),
       'unclassifiedCount',coalesce((v_duoli_item#>>'{previous,unclassifiedCount}')::bigint,
        greatest((v_duoli_item#>>'{previous,total}')::bigint-(v_duoli_item#>>'{previous,autoCount}')::bigint-(v_duoli_item#>>'{previous,manualCount}')::bigint,0))));
    end if;
   end if;
   v_duoli_rows:=v_duoli_rows||jsonb_build_array(v_duoli_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_duoli_rows);
  foreach v_duoli_period in array array['totals','previousTotals'] loop
   if jsonb_typeof(v_result->v_duoli_period)='object' then
    v_duoli_item:=(v_result->v_duoli_period)||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity');
    if v_view='auto' then
     select sum(d.total)::bigint into v_duoli_total from jsonb_to_recordset(v_duoli_days)d(data_date date,total bigint)
      where case when v_duoli_period='totals' then d.data_date>=v_start else d.data_date<v_start end;
     if v_duoli_total is not null then
      v_duoli_item:=v_duoli_item||jsonb_build_object('classificationAvailable',true,'classificationComparable',false,
       'classificationPartial',greatest(coalesce((v_duoli_item->>'total')::bigint,0)-coalesce((v_duoli_item->>'autoCount')::bigint,0)-coalesce((v_duoli_item->>'manualCount')::bigint,0),0)>0,
       'unclassifiedCount',greatest(coalesce((v_duoli_item->>'total')::bigint,0)-coalesce((v_duoli_item->>'autoCount')::bigint,0)-coalesce((v_duoli_item->>'manualCount')::bigint,0),0));
     end if;
    else
     select jsonb_build_object('autoCount',sum((r->>'auto_count')::bigint),'manualCount',sum((r->>'manual_count')::bigint),
      'unclassifiedCount',sum((r->>'unclassified_count')::bigint)) into v_duoli_rows
     from jsonb_to_recordset(v_duoli_days)d(data_date date,operator_rows jsonb)
      cross join lateral jsonb_array_elements(d.operator_rows)r
     where case when v_duoli_period='totals' then d.data_date>=v_start else d.data_date<v_start end
      and (v_account is null or position(lower(v_account) in lower(r->>'account'))>0);
     if v_duoli_rows->>'autoCount' is not null then
      v_duoli_item:=v_duoli_item||v_duoli_rows||jsonb_build_object('classificationAvailable',true,'classificationComparable',false,
       'classificationPartial',(v_duoli_item->>'processed')::bigint>(v_duoli_rows->>'autoCount')::bigint+(v_duoli_rows->>'manualCount')::bigint,
       'unclassifiedCount',greatest((v_duoli_item->>'processed')::bigint-(v_duoli_rows->>'autoCount')::bigint-(v_duoli_rows->>'manualCount')::bigint,0));
     end if;
    end if;
    v_result:=jsonb_set(v_result,array[v_duoli_period],v_duoli_item);
   end if;
  end loop;
 end if;
 -- Game66 notes are separate received fields; capability does not claim notes exist.
 if jsonb_array_length(coalesce(v_game->'rows','[]'::jsonb))>0 then
  v_game_rows:='[]'::jsonb;
  for v_game_item in select value from jsonb_array_elements(v_result->'rows') loop
   if exists(select 1 from jsonb_array_elements(v_game->'rows') g
    where g->>'country'=v_game_item->>'country'
     and private.dashboard_admin_live_withdraw_key(g->>'platform')=private.dashboard_admin_live_withdraw_key(v_game_item->>'platform')) then
    v_game_item:=v_game_item||jsonb_build_object('reasonAvailable',true,'sourceNotesAvailable',true,'sourceNoteFormat','game66_withdraw_notes_v1');
   end if;
   v_game_rows:=v_game_rows||jsonb_build_array(v_game_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_game_rows);
 end if;
 -- lg_business_notes_metadata_v1: only tag existing rows with an exact authorized native LG identity.
 with lg_catalog as materialized (select p.* from private.dashboard_admin_live_platforms() p where p.source='lg'),
 tagged as (select x.ordinality,x.value||case when exists(select 1 from lg_catalog p
  where p.country=x.value->>'country' and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)
   and private.dashboard_admin_live_withdraw_key(x.value->>'platform')=any(array[private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)]))
  then jsonb_build_object('reasonAvailable',true,'sourceNotesAvailable',true,'sourceNoteFormat','lg_business_notes_v1') else '{}'::jsonb end value
  from jsonb_array_elements(v_result->'rows') with ordinality x)
 select jsonb_set(v_result,'{rows}',coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)) into v_result from tagged;
 -- Report receipt completeness is distinct from successful-payment timestamps.
 select jsonb_build_object('source','NPG','timeBasis','created_at','successBasis','source_legacy_non_rejected',
  'currentComplete',coalesce(bool_and(complete) filter(where data_date>=v_start),false),
  'previousComplete',coalesce(bool_and(complete) filter(where data_date<v_start),false),
  'latestCollectedAt',max(observed_at) filter(where data_date>=v_start),
  'days',jsonb_agg(jsonb_build_object('country',country,'platform',platform,'date',data_date,
   'complete',complete,'collected',collected,'latestCollectedAt',observed_at,
   'state',case when observed_at is null then 'no_verified_received_report' when complete then 'complete' else 'observed_partial_day' end)
   order by country,platform,data_date)) into v_npg_coverage
 from (
  select m.country,m.platform,day::date data_date,
   coalesce((n.payload#>>'{npgSource,complete}')::boolean,false) complete,
   (n.payload#>>'{rows,0,total_count}')::bigint collected,n.captured_at observed_at
  from (values('哥伦比亚','NPG-COLOMBIA'),('墨西哥','NPG-MEXICO'),('智利','NPG-CHILE'))m(country,platform)
  cross join generate_series(v_before::timestamp,v_end::timestamp,interval '1 day')day
  left join jsonb_populate_recordset(null::public.newar_business_snapshots,v_npg)n
   on n.country=m.country and n.platform=m.platform and n.stat_date=day::date
  where private.dashboard_scope_allows(v_scope,m.country,m.platform)
   and (v_platforms is null or private.dashboard_admin_live_withdraw_key(m.platform)=any(v_platforms))
   and exists(select 1 from jsonb_array_elements(v_targets)t where t->>'country'=m.country
    and (not t?'platforms' or t->'platforms'='null'::jsonb
     or exists(select 1 from jsonb_array_elements_text(t->'platforms')z
      where private.dashboard_admin_live_withdraw_key(z)=private.dashboard_admin_live_withdraw_key(m.platform))))
 )n;
 if v_npg_coverage->'days'<>'null'::jsonb then
  v_result:=v_result||jsonb_build_object('npgCoverage',v_npg_coverage);
  if (v_npg_coverage->>'currentComplete')::boolean is not true
   or (v_npg_coverage->>'previousComplete')::boolean is not true then
   v_result:=jsonb_set(v_result,'{comparison}',coalesce(v_result->'comparison','{}')||
    jsonb_build_object('complete',false,'basis','npg_source_days_incomplete'));
  end if;
  select coalesce(jsonb_agg(r||case when (r->>'country',r->>'platform') in
   (('哥伦比亚','NPG-COLOMBIA'),('墨西哥','NPG-MEXICO'),('智利','NPG-CHILE')) then
    jsonb_build_object('source','NPG','reasonAvailable',false,'timeBasis','created_at',
     'successBasis','source_legacy_non_rejected','classificationBasis','source_legacy_operator',
     'complete',(v_npg_coverage->>'currentComplete')::boolean,
     'sourceCompletenessVerified',(v_npg_coverage->>'currentComplete')::boolean,
     'comparisonComparable',(v_npg_coverage->>'currentComplete')::boolean and (v_npg_coverage->>'previousComplete')::boolean)
   else '{}'::jsonb end),'[]'::jsonb) into v_game_rows from jsonb_array_elements(v_result->'rows')r;
  v_result:=jsonb_set(v_result,'{rows}',v_game_rows);
 end if;
 return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.withdraw_window_result(q jsonb, v jsonb, b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE row jsonb;outrows jsonb:='[]';p record;unsupported boolean:=false;availability jsonb:='[]';ok boolean;mask jsonb:=jsonb_build_object('total',null,'processed',null,'success',null,'rejected',null,'autoCount',null,'manualCount',null,'unclassifiedCount',null,'avgSeconds',null,'durationSampleCount',null,'durationTotalSeconds',null,'complete',false,'comparisonComparable',false,'creationTimeAvailable',false,'creationTimeReason','source_daily_report_only');
BEGIN
 FOR p IN SELECT *FROM private.withdraw_window_targets(q,b->'scope',b->'catalog')LOOP
  ok:=private.withdraw_window_whole_days(q)OR(p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10'));
  availability:=availability||jsonb_build_array(jsonb_build_object('platform',p.name,'country',p.country,'available',ok,'reason',CASE WHEN NOT ok THEN'source_daily_report_only'END));
  IF NOT ok THEN unsupported:=true;END IF;
 END LOOP;
 IF NOT private.withdraw_window_whole_days(q)THEN
  FOR row IN SELECT value FROM jsonb_array_elements(coalesce(v->'rows','[]'))LOOP
   SELECT x.*INTO p FROM private.withdraw_prepared_platforms(b->'catalog')x WHERE x.country=row->>'country'AND private.dashboard_admin_live_withdraw_key(row->>'platform')IN(private.dashboard_admin_live_withdraw_key(x.name),private.dashboard_admin_live_withdraw_key(x.source_name))LIMIT 1;
   ok:=FOUND AND p.source IN('wg','kb','newar','ar','duoli','game66')AND NOT(p.source='ar'AND left(q->>'startAt',10)::date<date'2026-10-10');
   IF NOT ok THEN unsupported:=true;row:=row||mask;IF row?'previous'THEN row:=jsonb_set(row,'{previous}',coalesce(row->'previous','{}')||mask);END IF;END IF;
   outrows:=outrows||jsonb_build_array(row);
  END LOOP;
  v:=jsonb_set(v,'{rows}',outrows);
  IF unsupported THEN v:=jsonb_set(v,'{totals}',coalesce(v->'totals','{}')||mask);v:=jsonb_set(v,'{previousTotals}',coalesce(v->'previousTotals','{}')||mask);v:=jsonb_set(v,'{comparison}',coalesce(v->'comparison','{}')||jsonb_build_object('complete',false));END IF;
 END IF;
 RETURN v||jsonb_build_object('creationAvailability',availability,'windows',jsonb_build_object('version',2,'creationStartAt',q->>'startAt','creationEndAt',q->>'endAt','successStartAt',q->>'successStartAt','successEndAt',q->>'successEndAt','successBasis',q->>'successBasis','creationMetricBasis','created_orders_current_status','successMetricBasis','independent_successful_source_orders'),'secondary',b->'secondary');
END;$function$;

