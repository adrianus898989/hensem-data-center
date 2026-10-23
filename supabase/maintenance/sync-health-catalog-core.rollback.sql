-- Shared catalog core. No source, queue, budget or public API changes.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $migration$
declare actual jsonb;before_deps jsonb;after_deps jsonb;
begin
 if current_user<>'postgres'then raise exception 'health migration owner required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('health_catalog_core_v1',0))then raise exception 'health migration busy';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_collected_data(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres,authenticated=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"jsonb","strict":false,"bodyMd5":"50a18718e3725388cd1ec1c167a23897","language":"plpgsql","parallel":"u","arguments":"p_request jsonb DEFAULT '{}'::jsonb","leakproof":false,"signature":"private.dashboard_admin_live_collected_data(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_collected_data(jsonb)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_native_collected_data(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"jsonb","strict":false,"bodyMd5":"ce2d86eca4db321e06d68dc394ae7d78","language":"plpgsql","parallel":"u","arguments":"p_request jsonb DEFAULT '{}'::jsonb","leakproof":false,"signature":"private.dashboard_admin_live_native_collected_data(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_native_collected_data(jsonb)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_sync_health_rows(timestamp with time zone)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"a3463e9ff2d11889308f2ba94b51849d","language":"plpgsql","parallel":"u","arguments":"p_asof timestamp with time zone","leakproof":false,"signature":"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_sync_health_rows(timestamp with time zone)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_wg_current_feeds(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"e6ca485b832b5420a2dc1785cabb2fd4","language":"sql","parallel":"u","arguments":"p_feeds jsonb","leakproof":false,"signature":"private.dashboard_admin_wg_current_feeds(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_wg_current_feeds(jsonb)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_collected_data_core(jsonb,boolean)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"jsonb","strict":false,"bodyMd5":"08445a99399a2086159c0587e2de3958","language":"plpgsql","parallel":"u","arguments":"p_request jsonb, p_include_order_intake boolean","leakproof":false,"signature":"private.dashboard_collected_data_core(jsonb,boolean)","volatility":"s","securityDefiner":false}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_collected_data_core(jsonb,boolean)';end if;
with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency()) select jsonb_object_agg(k,v order by k)into before_deps from tokens;
 if before_deps is null or (select count(*)from jsonb_each(before_deps)where key like 'scope:%')<6 or (select count(*)from jsonb_each(before_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(before_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception 'health dependency proof unavailable';end if;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_native_collected_data(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_key text;v_operation text:=coalesce(p_request->>'operation','catalog');
 v_start date;v_end date;v_result jsonb;v_country text;v_zone text;v_start_at timestamptz;v_end_at timestamptz;v_limit int:=coalesce((p_request->>'limit')::int,50);v_offset int:=coalesce((p_request->>'offset')::int,0);
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>8192
 or p_request-array['operation','dataset','country','platform','startAt','endAt','offset','limit','direction','sourceKind']<>'{}'::jsonb
 or v_operation not in ('catalog','rows') or v_limit not in(20,30,50,100,500) or v_offset not between 0 and 1000000 then
 raise exception using errcode='22023',message='invalid_request';end if;
 foreach v_key in array array['operation','dataset','country','platform','startAt','endAt','direction','sourceKind'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_filter';end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception using errcode='22023',message='invalid_pagination';end if;
 end loop;
 if p_request ? 'direction' and p_request->>'direction' not in('charge','withdraw') then raise exception using errcode='22023',message='invalid_direction';end if;
 if p_request ? 'sourceKind' and (p_request->>'dataset'<>'volume' or p_request->>'sourceKind' not in('direct','google_sheets','unknown')) then raise exception using errcode='22023',message='invalid_source';end if;
 if v_operation='catalog' then
  if p_request-array['operation']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  with volume_metadata as materialized (
   select country,platform,direction,sheet_name,
    min(data_date) filter(where data_date between date '2000-01-01' and current_date+1) first_date,
    max(data_date) filter(where data_date between date '2000-01-01' and current_date+1) last_date,
    count(*) filter(where data_date is null or data_date<date '2000-01-01' or data_date>current_date+1) date_issues,
    max(updated_at) updated_at,count(*) rows
   from public.third_party_volume where quarantined_at is null
   group by country,platform,direction,sheet_name
  ), feed_metadata(dataset,source_system,raw_country,raw_platform,data_date,updated_at,direction,provenance) as (
   select 'auto',case when source_sheet like 'AR_DIRECT%' then 'AR' when source_sheet like 'LG_DIRECT%' then 'LG' else 'REPORT' end,
    coalesce(country,''),platform,data_date,coalesce(source_updated_at,updated_at),'withdraw',
    case when source_sheet like 'AR_DIRECT%' or source_sheet like 'LG_DIRECT%' then 'direct'
     when source_sheet like 'raw_daily_%' then 'google_sheets' else 'unknown' end
   from public.auto_withdraw_daily
   union all
   select 'panda_success','PANDA',coalesce(nullif(country,''),country_code),platform,stat_date,updated_at,
    case when lower(btrim(direction)) in('charge','recharge','collect','deposit','代收') then 'charge' when lower(btrim(direction)) in('withdraw','payout','代付') then 'withdraw' end,'direct'
   from public.panda_success_rate_daily
   union all
   select 'lg_success','LG',country_code,platform,stat_date,coalesce(observed_at,updated_at),
    case order_kind when 'recharge' then 'charge' when 'withdraw' then 'withdraw' end,'direct'
   from public.lg_success_daily
   union all
   select 'collection_success',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),case source_system when 'RECHARGE_REVIEW' then 'charge' when 'WITHDRAW_REVIEW' then 'withdraw' end,'direct'
   from public.collection_success_daily
   union all
   select 'newar_third_party_volume','NEW_AR',coalesce(nullif(country,''),country_code),platform,stat_date,coalesce(captured_at,updated_at),
    case lower(btrim(direction)) when 'charge' then 'charge' when 'withdraw' then 'withdraw' end,'direct'
   from public.newar_business_snapshots where kind='third_party_volume'
   union all
   select 'ar_config',coalesce(t.source_system,case when c.parser_version like 'newar-%' then 'NEW_AR' else 'AR' end),c.country_code,c.platform,c.observed_local_date,c.received_at,null,'direct'
   from public.ar_config_daily c left join public.ar_config_targets t on t.country_code=c.country_code and t.platform=c.platform
   union all
   select 'panda_config','PANDA',country_code,platform,observed_local_date,received_at,null,'direct'
   from public.panda_config_daily
   union all
   select 'wg_config','WG',country_code,platform,observed_local_date,received_at,null,'direct'
   from public.wg_config_daily
   union all
   select 'game66_config',case g.team_code when 'hong_kong' then 'GAME66_HK' when 'red_crab' then 'GAME66_RED_CRAB' else 'GAME66' end,
    g.team_name,g.platform_name,(r.last_seen_at at time zone 'Asia/Kolkata')::date,r.last_seen_at,null,'direct'
   from public.game66_review_rules r join public.game66_platforms g on g.id=r.platform_id
  ), actual as materialized (
   select dataset,source_system,raw_country,raw_platform,direction,provenance,
    min(data_date) filter(where data_date between date '2000-01-01' and current_date+1) first_date,
    max(data_date) filter(where data_date between date '2000-01-01' and current_date+1) last_date,
    count(*) filter(where data_date is null or data_date<date '2000-01-01' or data_date>current_date+1) date_issues,
    max(updated_at) updated_at,count(*) rows
   from feed_metadata
   where nullif(btrim(raw_platform),'') is not null
    and upper(btrim(raw_platform)) not in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   group by dataset,source_system,raw_country,raw_platform,direction,provenance
   union all
   select 'volume'::text dataset,
    case when sheet_name like 'AR_DIRECT%' then 'AR' when sheet_name like 'LG_DIRECT%' then 'LG' else 'REPORT' end::text source_system,
    coalesce(country,'') raw_country,platform raw_platform,
    case when lower(btrim(direction)) in('charge','recharge','collect','deposit','代收') then 'charge' when lower(btrim(direction)) in('withdraw','payout','代付') then 'withdraw' end::text direction,
    case when (sheet_name like 'AR_DIRECT%' or sheet_name like 'LG_DIRECT%') then 'direct'
      when sheet_name like '[三方量表%]%' then 'google_sheets' else 'unknown' end::text provenance,
    min(first_date) first_date,max(last_date) last_date,sum(date_issues)::bigint date_issues,
    max(updated_at) updated_at,sum(rows)::bigint rows
   from volume_metadata
   where nullif(btrim(platform),'') is not null
    and upper(btrim(platform)) not in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   group by 1,2,3,4,5,6
   union all
   -- Separate each received LG order direction. An order registry alone is
   -- never proof that both collections and payouts have arrived.
   select 'lg_orders','LG',s.country_code,s.platform,
    case k.order_kind when 'recharge' then 'charge' else 'withdraw' end,'direct',
    null::date,(o.created_at at time zone case s.country_code
     when 'IN' then 'Asia/Kolkata' when 'ID' then 'Asia/Jakarta' when 'PK' then 'Asia/Karachi'
     when 'PH' then 'Asia/Manila' when 'BR' then 'America/Sao_Paulo' else 'UTC' end)::date,
    case when o.created_at is null then 1::bigint else 0::bigint end,o.updated_at,null::bigint
   from private.dashboard_admin_live_lg_scopes() s cross join (values('recharge'),('withdraw')) k(order_kind)
   cross join lateral (
    (select created_at,updated_at from public.lg_orders o
      where o.country_code=s.country_code and o.platform=s.platform and o.order_kind=k.order_kind
       and o.created_at is not null order by created_at desc limit 1)
    union all
    (select null::timestamptz,updated_at from public.lg_orders o
      where o.country_code=s.country_code and o.platform=s.platform and o.order_kind=k.order_kind
       and o.created_at is null limit 1)
    limit 1
   ) o
  ), normalized as materialized (
   select a.*,case when upper(btrim(a.raw_country)) in ('BR','巴西','BRAZIL') and exists(
    select 1 from actual x where upper(btrim(x.raw_country)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') and upper(btrim(x.raw_platform))=upper(btrim(a.raw_platform)))
    then '胖虎巴西' else private.dashboard_admin_live_report_country(a.raw_country,a.raw_platform) end as display_country
   from actual a
  ), keyed as materialized (
   select n.*,private.dashboard_admin_live_report_country(n.raw_country,n.raw_platform) lookup_country,
    private.dashboard_admin_live_deposit_platform_key(n.display_country,n.raw_platform) platform_key
   from normalized n
  ), mapping_keys as materialized (
   -- Compute normalization once per mapping, not once per feed × mapping.
   select team_name,platform_name,source_system,
    private.dashboard_admin_live_report_country(source_country,source_platform) country,
    private.dashboard_admin_live_withdraw_key(source_platform) source_key,
    private.dashboard_admin_live_withdraw_key(platform_name) name_key
   from public.dashboard_platform_team_map where active
  ), classified as (
   select a.*,coalesce(nullif(a.display_country,''),'未标记地区') country,
    case when a.display_country='胖虎巴西' then '胖虎' else m.team end team,
    coalesce(m.name,a.raw_platform) name,a.source_system system
   from keyed a
   left join lateral (
    select case when count(distinct team_name)=1 then min(team_name) end team,
     case when count(distinct platform_name)=1 then min(platform_name) end name
    from mapping_keys m
    where m.country=a.lookup_country and a.platform_key in(m.source_key,m.name_key)
     and (a.source_system in('REPORT','SHEET','RECHARGE_REVIEW','WITHDRAW_REVIEW') or m.source_system=a.source_system or a.source_system like m.source_system||'_%')
   )m on true
   where private.dashboard_scope_allows(v_scope,a.display_country,a.raw_platform)
  )
  select jsonb_build_object('version',2,'rows',coalesce(jsonb_agg(jsonb_build_object(
   'dataset',dataset,'system',system,'rawCountry',raw_country,'rawPlatform',raw_platform,'country',country,'name',name,
   'team',coalesce(nullif(team,''),'待归类'),'dateIssues',date_issues,'firstDate',first_date,'lastDate',last_date,'updatedAt',updated_at,'records',rows,
   'directions',case when direction is null then '[]'::jsonb else jsonb_build_array(direction) end,
   'provenance',jsonb_build_object('kind',provenance,'label',case provenance when 'direct' then '采集器直传 Supabase' when 'google_sheets' then 'Google 表格同步' else '来源待核对' end))
   order by country,name,dataset,raw_country,direction,provenance),'[]'::jsonb)||private.dashboard_admin_live_order_intake()) into v_result from classified;
  return v_result;
 end if;
 if not(p_request ?& array['dataset','country','platform','startAt','endAt']) or nullif(p_request->>'platform','') is null
 or p_request->>'startAt' !~ '^\d{4}-\d{2}-\d{2}$' or p_request->>'endAt' !~ '^\d{4}-\d{2}-\d{2}$' then
  raise exception using errcode='22023',message='invalid_range';end if;
 v_start:=(p_request->>'startAt')::date;v_end:=(p_request->>'endAt')::date;
 if v_end-v_start not between 0 and 30 then raise exception using errcode='22023',message='invalid_range';end if;
 v_country:=private.dashboard_admin_live_report_country(p_request->>'country',p_request->>'platform');
 if upper(btrim(p_request->>'country')) in ('BR','巴西','BRAZIL') and exists(select 1 from public.third_party_volume f
  where f.quarantined_at is null and upper(btrim(f.country)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') and f.platform=p_request->>'platform') then v_country:='胖虎巴西';end if;
 if private.dashboard_scope_allows(v_scope,v_country,p_request->>'platform') is not true then
  raise exception using errcode='42501',message='scope_denied';end if;
 if p_request->>'dataset'='lg_orders' then
  v_zone:=case v_country when '菲律宾' then 'Asia/Manila' when '印尼' then 'Asia/Jakarta' when '巴基斯坦' then 'Asia/Karachi' when '印度' then 'Asia/Kolkata' when '巴西' then 'America/Sao_Paulo' when '胖虎巴西' then 'America/Sao_Paulo' else null end;
  if v_zone is null then raise exception using errcode='22023',message='missing_source_timezone';end if;
  v_start_at:=v_start::timestamp at time zone v_zone;v_end_at:=(v_end+1)::timestamp at time zone v_zone;
  with filtered as materialized (
   select order_no,order_kind,order_amount,status_text,status_class,created_at,paid_at,finished_at,third_party,raw_channel,updated_at
   from public.lg_orders where country_code=p_request->>'country' and platform=p_request->>'platform'
    and order_kind in('recharge','withdraw') and (not(p_request ? 'direction') or order_kind=case p_request->>'direction' when 'charge' then 'recharge' else 'withdraw' end) and created_at>=v_start_at and created_at<v_end_at
  ), page as(select * from filtered order by created_at desc,order_kind,order_no offset v_offset limit v_limit)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'date',(created_at at time zone v_zone)::date,'direction',order_kind,'provider',coalesce(third_party,raw_channel),
   'orderNumber',order_no,'status',coalesce(status_text,status_class),'createdAt',created_at,'successAt',case when status_class='success' then paid_at end,
   'metrics',jsonb_build_object('amount',order_amount,'count',1),'updatedAt',updated_at)) from page),'[]'::jsonb),'offset',v_offset,'limit',v_limit) into v_result;
  return v_result;
 end if;
 if p_request->>'dataset'='volume' then
  with filtered as materialized (
   select data_date,direction,coalesce(nullif(raw_channel,''),channel) provider,
    jsonb_build_object('amount',amount,'count',count) metrics,updated_at,
    jsonb_strip_nulls(jsonb_build_object('sheetName',sheet_name,'row',source_row)) source_reference
   from public.third_party_volume f
   where f.quarantined_at is null and coalesce(f.country,'')=p_request->>'country' and f.platform=p_request->>'platform'
    and f.data_date between v_start and v_end
    and (not(p_request ? 'direction') or case lower(btrim(f.direction)) when '代收' then 'charge' when 'recharge' then 'charge' when 'deposit' then 'charge' when 'collect' then 'charge' when '代付' then 'withdraw' when 'payout' then 'withdraw' else lower(btrim(f.direction)) end=p_request->>'direction')
    and (not(p_request ? 'sourceKind') or case when f.sheet_name like '[三方量表%]%' then 'google_sheets' when f.sheet_name like 'AR_DIRECT%' or f.sheet_name like 'LG_DIRECT%' then 'direct' else 'unknown' end=p_request->>'sourceKind')
  ), page as (
   select * from filtered order by data_date desc,direction nulls last,provider nulls last,updated_at desc,metrics::text offset v_offset limit v_limit
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('date',data_date,'direction',direction,'provider',provider,'metrics',jsonb_strip_nulls(metrics),'updatedAt',updated_at,'sourceReference',source_reference)) from page),'[]'::jsonb),'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit) into v_result;
  return v_result;
 end if;
 with filtered as materialized (
  select data_date,direction,provider,metrics,updated_at from private.dashboard_admin_collected_feed_rows f
  where f.dataset=p_request->>'dataset' and coalesce(f.country,'')=p_request->>'country' and f.platform=p_request->>'platform'
   and f.data_date between v_start and v_end
   and (not(p_request ? 'direction') or case lower(btrim(f.direction)) when '代收' then 'charge' when 'recharge' then 'charge' when 'deposit' then 'charge' when 'collect' then 'charge' when '代付' then 'withdraw' when 'payout' then 'withdraw' else lower(btrim(f.direction)) end=p_request->>'direction')
 ), page as (
  select * from filtered order by data_date desc,direction nulls last,provider nulls last,updated_at desc,metrics::text
  offset v_offset limit v_limit
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('date',data_date,'direction',direction,'provider',provider,
  'metrics',jsonb_strip_nulls(metrics),'updatedAt',updated_at)) from page),'[]'::jsonb),'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit)
 into v_result;
 return v_result;
end;
$function$

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
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_key text;v_kind text;v_zone text;v_launch timestamptz;v_seen timestamptz;v_has boolean;v_run record;v_lg_runs jsonb;v_first date;v_feed_keys text[]:=array[]::text[];v_feed_key text;
begin
 -- The catalog already normalizes Panghu and enforces account scope. Do not
 -- consult lastDate to infer day coverage; every returned day is checked below.
 select coalesce(jsonb_agg(f),'[]'::jsonb) into v_feeds from jsonb_array_elements(coalesce(private.dashboard_admin_live_collected_data('{"operation":"catalog"}'::jsonb)->'rows','[]'::jsonb)) f where f->>'dataset'<>'orders'
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
   v_lg_runs:=null;
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
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
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
 drop function private.dashboard_collected_data_core(jsonb,boolean);
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_collected_data(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres,authenticated=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"jsonb","strict":false,"bodyMd5":"50a18718e3725388cd1ec1c167a23897","language":"plpgsql","parallel":"u","arguments":"p_request jsonb DEFAULT '{}'::jsonb","leakproof":false,"signature":"private.dashboard_admin_live_collected_data(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_collected_data(jsonb)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_native_collected_data(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"jsonb","strict":false,"bodyMd5":"deebe55d14d07d8dfccf83ee032a91bc","language":"plpgsql","parallel":"u","arguments":"p_request jsonb DEFAULT '{}'::jsonb","leakproof":false,"signature":"private.dashboard_admin_live_native_collected_data(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_native_collected_data(jsonb)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_live_sync_health_rows(timestamp with time zone)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"4f7b6f978b78830054406d97aee8aa24","language":"plpgsql","parallel":"u","arguments":"p_asof timestamp with time zone","leakproof":false,"signature":"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_live_sync_health_rows(timestamp with time zone)';end if;
select jsonb_build_object('signature',p.oid::regprocedure::text,'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(p.proowner),'acl',proacl::text,'securityDefiner',prosecdef,'language',l.lanname,'volatility',provolatile,'config',proconfig,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'cost',procost,'rows',prorows,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.dashboard_admin_wg_current_feeds(jsonb)');
 if actual is distinct from $expected${"acl":"{postgres=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"e6ca485b832b5420a2dc1785cabb2fd4","language":"sql","parallel":"u","arguments":"p_feeds jsonb","leakproof":false,"signature":"private.dashboard_admin_wg_current_feeds(jsonb)","volatility":"s","securityDefiner":true}$expected$::jsonb then raise exception 'health exact function contract changed: %','private.dashboard_admin_wg_current_feeds(jsonb)';end if;
with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency()) select jsonb_object_agg(k,v order by k)into after_deps from tokens;
 if after_deps is null or (select count(*)from jsonb_each(after_deps)where key like 'scope:%')<6 or (select count(*)from jsonb_each(after_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(after_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception 'health dependency proof unavailable';end if;
 if before_deps is distinct from after_deps then raise exception 'health dependency drift';end if;
end;$migration$;
commit;
