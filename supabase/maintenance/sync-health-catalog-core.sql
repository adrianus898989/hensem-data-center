CREATE OR REPLACE FUNCTION private.dashboard_collected_data_core(p_request jsonb, p_include_order_intake boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_key text;v_operation text:=coalesce(p_request->>'operation','catalog');
 v_start date;v_end date;v_result jsonb;v_country text;v_zone text;v_start_at timestamptz;v_end_at timestamptz;v_limit int:=coalesce((p_request->>'limit')::int,50);v_offset int:=coalesce((p_request->>'offset')::int,0);
begin
 if p_include_order_intake is null or (not p_include_order_intake and v_operation<>'catalog') then raise exception using errcode='22023',message='invalid_catalog_mode';end if;
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
   order by country,name,dataset,raw_country,direction,provenance),'[]'::jsonb)||case when p_include_order_intake then private.dashboard_admin_live_order_intake() else '[]'::jsonb end) into v_result from classified;
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

