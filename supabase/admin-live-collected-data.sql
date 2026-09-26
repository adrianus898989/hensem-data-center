-- Complete, scoped inventory of the business feeds already received by this project.
-- Read only, on demand. It never joins daily reports into order-time aggregates.
begin;
create or replace function private.dashboard_admin_live_report_number(p_row jsonb,p_key text)
returns numeric language sql immutable parallel safe set search_path='' as $$
 select case when p_row->>p_key ~ '^-?[0-9]+([.][0-9]+)?$' then (p_row->>p_key)::numeric end
$$;
revoke all on function private.dashboard_admin_live_report_number(jsonb,text) from public,anon,authenticated;

create or replace view private.dashboard_admin_collected_feed_rows as
 select 'volume'::text dataset,'REPORT'::text source_system,country,platform,data_date,updated_at,
 direction,coalesce(nullif(raw_channel,''),channel)::text provider,
 jsonb_build_object('amount',amount,'count',count,'success',success_count,'failed',failed_count) metrics
 from public.third_party_volume where quarantined_at is null
 union all
 select 'panda_success','PANDA',coalesce(nullif(country,''),country_code),platform,stat_date,updated_at,direction,third_party,
 jsonb_build_object('count',submitted_count,'success',success_count,'failed',failed_count)
 from public.panda_success_rate_daily
 union all
 select 'auto','REPORT',country,platform,data_date,coalesce(source_updated_at,updated_at),'withdraw',null,
 jsonb_build_object('count',total,'success',success,'rejected',rejected,'auto',auto_count,'manual',manual_count,'avgSeconds',avg_seconds)
 from public.auto_withdraw_daily
 union all
 select 'operators','REPORT',country,platform,data_date,coalesce(source_updated_at,updated_at),'withdraw',account,
 jsonb_build_object('count',processed,'rejected',rejected,'avgSeconds',avg_seconds)
 from public.withdraw_operator_daily
 union all
 select 'workorders',source_system,coalesce(nullif(country,''),country_code),platform,stat_date,coalesce(source_updated_at,updated_at),null,third_party,
 jsonb_build_object('count',submitted_count,'amount',submitted_amount,'success',success_count,'successAmount',success_amount,
 'withdrawPending',withdraw_not_received_count,'withdrawPendingAmount',withdraw_not_received_amount,'withdrawSuccess',withdraw_success_count,'withdrawSuccessAmount',withdraw_success_amount)
 from public.workorder_deposit_daily
 union all
 select 'pending',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),'withdraw',null,
 jsonb_build_object('pending',private.dashboard_admin_live_report_number(snapshot->'totals','pending_count'),'pendingAmount',private.dashboard_admin_live_report_number(snapshot->'totals','pending_amount'))
 from public.withdraw_pending_daily
 union all
 select 'backlog',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),'withdraw',null,
 jsonb_build_object('pending',private.dashboard_admin_live_report_number(snapshot->'totals','pending_count'),'pendingAmount',private.dashboard_admin_live_report_number(snapshot->'totals','pending_amount'))
 from public.withdraw_pending_backlog_daily
 union all
 select 'reasons',source_system,country_code,platform,stat_date,updated_at,'withdraw',null,
 jsonb_build_object('count',private.dashboard_admin_live_report_number(snapshot->'totals','total'),'success',private.dashboard_admin_live_report_number(snapshot->'totals','success'),
 'rejected',private.dashboard_admin_live_report_number(snapshot->'totals','reject'),'auto',private.dashboard_admin_live_report_number(snapshot->'totals','auto'),'manual',private.dashboard_admin_live_report_number(snapshot->'totals','manual'))
 from public.withdraw_reasons_daily
 union all
 select 'ar_config','AR',country_code,platform,observed_local_date,received_at,null,null,jsonb_build_object('snapshots',1) from public.ar_config_daily
 union all
 select 'panda_config','PANDA',country_code,platform,observed_local_date,received_at,null,null,jsonb_build_object('snapshots',1) from public.panda_config_daily
 union all
 select 'wg_config','WG',country_code,platform,observed_local_date,received_at,null,null,jsonb_build_object('snapshots',1) from public.wg_config_daily
 union all
 select 'newar_'||s.kind,'NEW_AR',coalesce(nullif(s.country,''),s.country_code),s.platform,s.stat_date,coalesce(s.captured_at,s.updated_at),s.direction,r->>'third_party',
 jsonb_build_object('count',coalesce(private.dashboard_admin_live_report_number(r,'total_count'),private.dashboard_admin_live_report_number(r,'count')),
 'amount',private.dashboard_admin_live_report_number(r,'amount'),'successAmount',private.dashboard_admin_live_report_number(r,'success_amount'),
 'success',private.dashboard_admin_live_report_number(r,'success_count'),'failed',private.dashboard_admin_live_report_number(r,'failed_count'),
 'rejected',coalesce(private.dashboard_admin_live_report_number(r,'reject_count'),private.dashboard_admin_live_report_number(r,'rejected_count')),
 'auto',private.dashboard_admin_live_report_number(r,'auto_count'),'manual',private.dashboard_admin_live_report_number(r,'manual_count'),
 'completed',private.dashboard_admin_live_report_number(r,'completed_count'),'pending',private.dashboard_admin_live_report_number(r,'pending_count'))
 from public.newar_business_snapshots s
 left join lateral jsonb_array_elements(case when jsonb_typeof(s.payload->'rows')='array' then s.payload->'rows' else '[]'::jsonb end) r on true
 union all
 select 'deposit_results','SHEET',country,platform,record_date,coalesce(source_updated_at,updated_at),'charge',provider,
 jsonb_build_object('amount',amount,'count',1) from public.admin_deposit_issue_rows
 union all
 select 'deposit_entries','SHEET',country,platform,followup_date,coalesce(source_updated_at,updated_at),'charge',provider,
 jsonb_build_object('amount',amount,'count',1) from public.admin_deposit_followup_rows
 union all
 select 'lg_success','LG',country_code,platform,stat_date,coalesce(observed_at,updated_at),order_kind,scope_type||' / '||coalesce(third_party,raw_channel,'平台合计'),
 jsonb_build_object('count',total_count,'success',success_count,'failed',failed_count,'pending',pending_count,'unknown',unknown_count,'amount',total_amount,'successAmount',success_amount)
 from public.lg_success_daily
 union all
 select 'lg_pending','LG',country_code,platform,stat_date,updated_at,'withdraw',null,
 jsonb_build_object('pending',private.dashboard_admin_live_report_number(snapshot->'totals','pending_count'),'pendingAmount',private.dashboard_admin_live_report_number(snapshot->'totals','pending_amount'))
 from public.lg_pending_daily
 union all
 select 'collection_success',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),case source_system when 'RECHARGE_REVIEW' then 'charge' when 'WITHDRAW_REVIEW' then 'withdraw' end,null,
 jsonb_build_object('count',private.dashboard_admin_live_report_number(snapshot->'totals','submitted_count'),'success',private.dashboard_admin_live_report_number(snapshot->'totals','success_count'),'successAmount',private.dashboard_admin_live_report_number(snapshot->'totals','success_amount'))
 from public.collection_success_daily
 union all
 select 'workorder_bundle',system_name,coalesce(nullif(country,''),country_code),platform,stat_date,coalesce(source_updated_at,updated_at),null,null,
 jsonb_build_object('count',private.dashboard_admin_live_report_number(r,'total_count'),'completed',private.dashboard_admin_live_report_number(r,'completed_count'),
 'rejected',private.dashboard_admin_live_report_number(r,'rejected_count'),'pending',private.dashboard_admin_live_report_number(r,'pending_count'))
 from public.workorder_daily_bundle s left join lateral jsonb_array_elements(case when jsonb_typeof(daily_rows)='array' then daily_rows else '[]'::jsonb end)r on true
 union all
 select 'panda_dictionary','PANDA',country_code,platform,observed_local_date,received_at,null,null,jsonb_build_object('snapshots',1) from public.panda_config_dictionary_daily
 union all
 select 'member_notes',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),'withdraw',null,jsonb_build_object('snapshots',1) from public.withdraw_member_notes_daily
 union all
 select 'pending_orders',source_system,country_code,platform,stat_date,coalesce(snapshot_at,updated_at),'withdraw',raw_channel,jsonb_build_object('amount',amount,'count',1) from public.withdraw_pending_orders
 union all
 select 'midnight',source_system,country_code,platform,(scheduled_at at time zone timezone)::date,received_at,null,null,jsonb_build_object('snapshots',1) from public.provider_midnight_snapshots
 union all
 select 'game66_dictionary','GAME66',g.team_name,g.platform_name,(d.fetched_at at time zone 'Asia/Kolkata')::date,d.fetched_at,null,d.data_type,jsonb_build_object('snapshots',1)
 from public.game66_dictionary_snapshots d join public.game66_platforms g on g.id=d.platform_id;
revoke all on private.dashboard_admin_collected_feed_rows from public,anon,authenticated;

-- One index seek per LG scope; listing platforms never scans its order bodies.
create or replace function private.dashboard_admin_live_lg_scopes()
returns table(country_code text,platform text) language sql stable security definer set search_path='' as $$
 with recursive scopes as (
  (select country_code,platform from public.lg_orders order by country_code,platform limit 1)
  union all select n.country_code,n.platform from scopes s cross join lateral (
   select o.country_code,o.platform from public.lg_orders o where (o.country_code,o.platform)>(s.country_code,s.platform)
   order by o.country_code,o.platform limit 1)n
 ) select * from scopes
$$;
revoke all on function private.dashboard_admin_live_lg_scopes() from public,anon,authenticated;

create or replace function private.dashboard_admin_live_collected_data(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
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
  with feed_metadata as (
   -- Only indexed/report metadata is needed for this inventory. Do not expand
   -- snapshots, order bodies, providers or member/configuration payloads.
   select 'volume'::text dataset,
    case when sheet_name like 'AR_DIRECT%' then 'AR' when sheet_name like 'LG_DIRECT%' then 'LG' else 'REPORT' end::text source_system,
    coalesce(country,'') raw_country,platform raw_platform,data_date,updated_at,
    case when lower(btrim(direction)) in('charge','recharge','collect','deposit','代收') then 'charge' when lower(btrim(direction)) in('withdraw','payout','代付') then 'withdraw' end::text direction,
    case when (sheet_name like 'AR_DIRECT%' or sheet_name like 'LG_DIRECT%') then 'direct'
      when sheet_name like '[三方量表%]%' then 'google_sheets' else 'unknown' end::text provenance
   from public.third_party_volume where quarantined_at is null
   union all
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
$$;
revoke all on function private.dashboard_admin_live_collected_data(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_collected_data(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_collected_data(p_request)$$;
revoke all on function public.dashboard_admin_live_collected_data(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_collected_data(jsonb),public.dashboard_admin_live_collected_data(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
