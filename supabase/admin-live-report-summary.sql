-- Scoped source-day reports, separate from order creation/success-time statistics.
-- No source table is changed. Requires admin-live-collected-data.sql and its mapping helpers.
begin;
create or replace function private.dashboard_admin_live_report_direction(p_direction text)
returns text language sql immutable parallel safe set search_path='' as $$
 select case lower(btrim(p_direction)) when 'charge' then 'charge' when 'recharge' then 'charge' when 'collect' then 'charge' when 'deposit' then 'charge' when '代收' then 'charge'
 when 'withdraw' then 'withdraw' when 'payout' then 'withdraw' when '代付' then 'withdraw' end
$$;
revoke all on function private.dashboard_admin_live_report_direction(text) from public,anon,authenticated;

-- Internal projection: only source numbers and harmless references, never raw/config/member payloads.
-- The public entrypoint validates every exact source identity and account scope before invoking it.
create or replace function private.dashboard_admin_live_report_source_rows(p_feed jsonb,p_start date,p_end date)
returns table(data_date date,grain text,provider text,metrics jsonb,updated_at timestamptz)
language plpgsql stable set search_path='' set jit=off as $$
begin
 if p_feed->>'dataset'='volume' then
  return query select t.data_date,'provider'::text,coalesce(nullif(t.raw_channel,''),nullif(t.channel,'')),
   jsonb_build_object('amount',t.amount,'count',t.count),t.updated_at
  from public.third_party_volume t
  where t.quarantined_at is null and (t.country=p_feed->>'country' or (p_feed->>'country'='' and t.country is null)) and t.platform=p_feed->>'platform' and t.data_date between p_start and p_end
   and private.dashboard_admin_live_report_direction(t.direction)=p_feed->>'direction'
   and case when t.sheet_name like 'AR_DIRECT%' then 'AR' when t.sheet_name like 'LG_DIRECT%' then 'LG' else 'REPORT' end=p_feed->>'system'
   and case when t.sheet_name like 'AR_DIRECT%' or t.sheet_name like 'LG_DIRECT%' then 'direct' when t.sheet_name like '[三方量表%]%' then 'google_sheets' else 'unknown' end=p_feed->>'sourceKind';
 elsif p_feed->>'dataset'='panda_success' then
  return query select t.stat_date,'provider'::text,nullif(t.third_party,''),
   jsonb_build_object('count',t.submitted_count,'successCount',t.success_count,'failedCount',t.failed_count),t.updated_at
  from public.panda_success_rate_daily t
  where coalesce(nullif(t.country,''),t.country_code)=p_feed->>'country' and t.platform=p_feed->>'platform' and t.stat_date between p_start and p_end
   and private.dashboard_admin_live_report_direction(t.direction)=p_feed->>'direction';
 elsif p_feed->>'dataset'='lg_success' then
  return query select t.stat_date,case t.scope_type when 'third_party' then 'provider' else t.scope_type end,
   case t.scope_type when 'platform' then null when 'channel' then nullif(t.raw_channel,'') else nullif(t.third_party,'') end,
   jsonb_build_object('amount',t.total_amount,'count',t.total_count,'successAmount',t.success_amount,'successCount',t.success_count,'failedCount',t.failed_count,'pendingCount',t.pending_count,'unknownCount',t.unknown_count),coalesce(t.observed_at,t.updated_at)
  from public.lg_success_daily t
  where t.country_code=p_feed->>'country' and t.platform=p_feed->>'platform' and t.stat_date between p_start and p_end
   and t.order_kind=case p_feed->>'direction' when 'charge' then 'recharge' else 'withdraw' end
   and t.scope_type in('platform','third_party','channel');
 elsif p_feed->>'dataset'='collection_success' then
  return query select t.stat_date,'platform'::text,null::text,
   jsonb_build_object('count',private.dashboard_admin_live_report_number(t.snapshot->'totals','submitted_count'),
    'successCount',private.dashboard_admin_live_report_number(t.snapshot->'totals','success_count'),
    'successAmount',private.dashboard_admin_live_report_number(t.snapshot->'totals','success_amount')),coalesce(t.snapshot_at,t.updated_at)
  from public.collection_success_daily t
  where t.country_code=p_feed->>'country' and t.platform=p_feed->>'platform' and t.stat_date between p_start and p_end and t.source_system=p_feed->>'system';
 elsif p_feed->>'dataset'='newar_third_party_volume' then
  return query select t.stat_date,'provider'::text,nullif(r->>'third_party',''),
   jsonb_build_object('amount',private.dashboard_admin_live_report_number(r,'amount'),'count',private.dashboard_admin_live_report_number(r,'count'),
    'successAmount',private.dashboard_admin_live_report_number(r,'success_amount'),'successCount',private.dashboard_admin_live_report_number(r,'success_count'),
    'failedCount',private.dashboard_admin_live_report_number(r,'failed_count')),coalesce(t.captured_at,t.updated_at)
  from public.newar_business_snapshots t
  left join lateral jsonb_array_elements(case when jsonb_typeof(t.payload->'rows')='array' then t.payload->'rows' else '[]'::jsonb end)r on true
  where t.kind='third_party_volume' and coalesce(nullif(t.country,''),t.country_code)=p_feed->>'country' and t.platform=p_feed->>'platform' and t.stat_date between p_start and p_end
   and private.dashboard_admin_live_report_direction(t.direction)=p_feed->>'direction';
 elsif p_feed->>'dataset'='auto' then
  return query select t.data_date,'platform'::text,null::text,
   jsonb_build_object('count',t.total,'successCount',t.success,'rejectedCount',t.rejected,'autoCount',t.auto_count,'manualCount',t.manual_count),coalesce(t.source_updated_at,t.updated_at)
  from public.auto_withdraw_daily t
  where t.country=p_feed->>'country' and t.platform=p_feed->>'platform' and t.data_date between p_start and p_end
   and case when t.source_sheet like 'AR_DIRECT%' then 'AR' when t.source_sheet like 'LG_DIRECT%' then 'LG' else 'REPORT' end=p_feed->>'system'
   and case when t.source_sheet like 'AR_DIRECT%' or t.source_sheet like 'LG_DIRECT%' then 'direct' when t.source_sheet like 'raw_daily_%' then 'google_sheets' else 'unknown' end=p_feed->>'sourceKind';
 end if;
end;$$;
revoke all on function private.dashboard_admin_live_report_source_rows(jsonb,date,date) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_report_summary(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_start date;v_end date;v_feed jsonb;v_key text;v_country text;
 v_feeds jsonb:='[]'::jsonb;v_panghu text[]:=array[]::text[];v_result jsonb;v_keys text[]:=array[]::text[];v_identity text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>131072
  or p_request-array['startAt','endAt','feeds']<>'{}'::jsonb or not(p_request ?& array['startAt','endAt','feeds'])
  or jsonb_typeof(p_request->'startAt')<>'string' or jsonb_typeof(p_request->'endAt')<>'string'
  or p_request->>'startAt' !~ '^\d{4}-\d{2}-\d{2}$' or p_request->>'endAt' !~ '^\d{4}-\d{2}-\d{2}$'
  or jsonb_typeof(p_request->'feeds')<>'array' then raise exception using errcode='22023',message='invalid_report_request';end if;
 if jsonb_array_length(p_request->'feeds') not between 1 and 250 then raise exception using errcode='22023',message='invalid_report_feed_count';end if;
 begin v_start:=(p_request->>'startAt')::date;v_end:=(p_request->>'endAt')::date;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid_report_range';end;
 if v_start<date '2000-01-01' or v_end-v_start not between 0 and 30 then raise exception using errcode='22023',message='invalid_report_range';end if;
 -- Resolve the explicit Panghu identity set once, not one unindexed probe per feed.
 if exists(select 1 from jsonb_array_elements(p_request->'feeds') f where upper(btrim(f->>'country')) in('BR','巴西','BRAZIL')) then
  select coalesce(array_agg(distinct platform_key),'{}'::text[]) into v_panghu from (
   select upper(btrim(platform)) platform_key from public.third_party_volume where quarantined_at is null and country in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   union select upper(btrim(platform)) from public.panda_success_rate_daily where coalesce(nullif(country,''),country_code) in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   union select upper(btrim(platform)) from public.newar_business_snapshots where kind='third_party_volume' and coalesce(nullif(country,''),country_code) in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   union select upper(btrim(platform)) from public.auto_withdraw_daily where country in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  )p;
 end if;
 for v_feed in select value from jsonb_array_elements(p_request->'feeds') loop
  if jsonb_typeof(v_feed)<>'object' or v_feed-array['dataset','system','country','platform','direction','sourceKind']<>'{}'::jsonb
   or not(v_feed ?& array['dataset','system','country','platform','direction','sourceKind']) then raise exception using errcode='22023',message='invalid_report_feed';end if;
  foreach v_key in array array['dataset','system','country','platform','direction','sourceKind'] loop
   if jsonb_typeof(v_feed->v_key)<>'string' or length(v_feed->>v_key)>200 or v_feed->>v_key ~ '[[:cntrl:]]'
    or (v_key<>'country' and nullif(btrim(v_feed->>v_key),'') is null) then raise exception using errcode='22023',message='invalid_report_filter';end if;
  end loop;
  if v_feed->>'dataset' not in('volume','panda_success','lg_success','collection_success','newar_third_party_volume','auto')
   or v_feed->>'direction' not in('charge','withdraw') or v_feed->>'sourceKind' not in('direct','google_sheets','unknown')
   or upper(btrim(v_feed->>'platform')) in('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then raise exception using errcode='22023',message='invalid_report_source';end if;
  if (v_feed->>'dataset' in('volume','auto') and not((v_feed->>'sourceKind'='direct' and v_feed->>'system' in('AR','LG')) or (v_feed->>'sourceKind' in('google_sheets','unknown') and v_feed->>'system'='REPORT')))
   or (v_feed->>'dataset'='panda_success' and (v_feed->>'system'<>'PANDA' or v_feed->>'sourceKind'<>'direct'))
   or (v_feed->>'dataset'='lg_success' and (v_feed->>'system'<>'LG' or v_feed->>'sourceKind'<>'direct'))
   or (v_feed->>'dataset'='newar_third_party_volume' and (v_feed->>'system'<>'NEW_AR' or v_feed->>'sourceKind'<>'direct'))
   or (v_feed->>'dataset'='collection_success' and (v_feed->>'sourceKind'<>'direct' or v_feed->>'system'<>case v_feed->>'direction' when 'charge' then 'RECHARGE_REVIEW' else 'WITHDRAW_REVIEW' end))
   or (v_feed->>'dataset'='auto' and v_feed->>'direction'<>'withdraw') then raise exception using errcode='22023',message='invalid_report_source';end if;
  v_country:=private.dashboard_admin_live_report_country(v_feed->>'country',v_feed->>'platform');
  -- Same authoritative Panghu rule as the collected-data catalog, including future platform names.
  if upper(btrim(v_feed->>'country')) in('BR','巴西','BRAZIL') and upper(btrim(v_feed->>'platform'))=any(v_panghu) then v_country:='胖虎巴西';end if;
  if private.dashboard_scope_allows(v_scope,v_country,v_feed->>'platform') is not true then raise exception using errcode='42501',message='scope_denied';end if;
  v_identity:=jsonb_build_array(v_feed->>'dataset',v_feed->>'system',v_feed->>'country',v_feed->>'platform',v_feed->>'direction',v_feed->>'sourceKind')::text;
  if v_identity=any(v_keys) then continue;end if;v_keys:=array_append(v_keys,v_identity);
  v_feeds:=v_feeds||jsonb_build_array(v_feed||jsonb_build_object('id',md5(v_identity),'displayCountry',v_country));
 end loop;
 with feeds as materialized(select value f from jsonb_array_elements(v_feeds)),source_rows as materialized(
  select f->>'id' feed_id,r.* from feeds cross join lateral private.dashboard_admin_live_report_source_rows(f,v_start,v_end)r
 ), rolled as materialized(
  select feed_id,grain,provider,data_date,grouping(provider) gp,grouping(data_date) gd,count(*) records,count(distinct data_date) days,max(updated_at) updated_at,
   jsonb_build_object('amount',case when count(private.dashboard_admin_live_report_number(metrics,'amount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'amount')) end,'count',case when count(private.dashboard_admin_live_report_number(metrics,'count'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'count')) end,'successAmount',case when count(private.dashboard_admin_live_report_number(metrics,'successAmount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'successAmount')) end,'successCount',case when count(private.dashboard_admin_live_report_number(metrics,'successCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'successCount')) end,'failedCount',case when count(private.dashboard_admin_live_report_number(metrics,'failedCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'failedCount')) end,'pendingCount',case when count(private.dashboard_admin_live_report_number(metrics,'pendingCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'pendingCount')) end,'unknownCount',case when count(private.dashboard_admin_live_report_number(metrics,'unknownCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'unknownCount')) end,'rejectedCount',case when count(private.dashboard_admin_live_report_number(metrics,'rejectedCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'rejectedCount')) end,'autoCount',case when count(private.dashboard_admin_live_report_number(metrics,'autoCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'autoCount')) end,'manualCount',case when count(private.dashboard_admin_live_report_number(metrics,'manualCount'))=count(*) then sum(private.dashboard_admin_live_report_number(metrics,'manualCount')) end) metrics,
   jsonb_build_object('amount',count(private.dashboard_admin_live_report_number(metrics,'amount')),'count',count(private.dashboard_admin_live_report_number(metrics,'count')),'successAmount',count(private.dashboard_admin_live_report_number(metrics,'successAmount')),'successCount',count(private.dashboard_admin_live_report_number(metrics,'successCount')),'failedCount',count(private.dashboard_admin_live_report_number(metrics,'failedCount')),'pendingCount',count(private.dashboard_admin_live_report_number(metrics,'pendingCount')),'unknownCount',count(private.dashboard_admin_live_report_number(metrics,'unknownCount')),'rejectedCount',count(private.dashboard_admin_live_report_number(metrics,'rejectedCount')),'autoCount',count(private.dashboard_admin_live_report_number(metrics,'autoCount')),'manualCount',count(private.dashboard_admin_live_report_number(metrics,'manualCount'))) metric_coverage
  from source_rows group by grouping sets((feed_id,grain),(feed_id,grain,provider),(feed_id,grain,data_date),(feed_id,grain,provider,data_date))
 ), packed as materialized(
  select *,jsonb_build_object('records',records,'days',days,'updatedAt',updated_at,'metrics',metrics,'metricCoverage',metric_coverage) body from rolled
 ), provider_days as materialized(
  select feed_id,grain,data_date,jsonb_agg(body||jsonb_build_object('provider',provider) order by provider nulls last) providers
  from packed where gp=0 and gd=0 group by feed_id,grain,data_date
 ), daily as materialized(
  select d.feed_id,d.grain,jsonb_agg(d.body||jsonb_build_object('date',d.data_date,'providers',coalesce(p.providers,'[]'::jsonb)) order by d.data_date) days
  from packed d left join provider_days p using(feed_id,grain,data_date) where d.gp=1 and d.gd=0 group by d.feed_id,d.grain
 ), providers as materialized(
  select feed_id,grain,jsonb_agg(body||jsonb_build_object('provider',provider) order by provider nulls last) providers
  from packed where gp=0 and gd=1 group by feed_id,grain
 ), groups as materialized(
  select s.feed_id,jsonb_agg(s.body||jsonb_build_object('grain',s.grain,'providers',coalesce(p.providers,'[]'::jsonb),'daily',coalesce(d.days,'[]'::jsonb)) order by s.grain) groups
  from packed s left join providers p using(feed_id,grain) left join daily d using(feed_id,grain)
  where s.gp=1 and s.gd=1 group by s.feed_id
 ), received as(select feed_id,count(*) records,max(updated_at) updated_at from source_rows group by feed_id)
 select jsonb_build_object('version',1,'startAt',v_start,'endAt',v_end,'timeBasis','source_report_date',
  'feeds',coalesce(jsonb_agg(jsonb_build_object('id',f->>'id','dataset',f->>'dataset','system',f->>'system','rawCountry',f->>'country','rawPlatform',f->>'platform',
   'country',f->>'displayCountry','direction',f->>'direction','sourceKind',f->>'sourceKind','currency',null,'currencyBasis','source_not_provided','timezone',null,
   'status',case when r.records>0 then 'received' else 'not_received' end,'records',coalesce(r.records,0),'updatedAt',r.updated_at,
   'groups',coalesce(g.groups,'[]'::jsonb)) order by f->>'id'),'[]'::jsonb)) into v_result
 from feeds left join groups g on g.feed_id=f->>'id' left join received r on r.feed_id=f->>'id';
 -- Never truncate aggregates: an oversized result is explicitly retried with fewer feeds/days.
 if octet_length(v_result::text)>16777216 then raise exception using errcode='54000',message='report_result_too_large';end if;
 return v_result;
end;$$;
revoke all on function private.dashboard_admin_live_report_summary(jsonb) from public,anon,authenticated;
create or replace function public.dashboard_admin_live_report_summary(p_request jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_report_summary(p_request)$$;
revoke all on function public.dashboard_admin_live_report_summary(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_report_summary(jsonb),public.dashboard_admin_live_report_summary(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
