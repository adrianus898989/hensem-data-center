-- Replace only NewAR third-party report feeds with scoped creation-day detail statistics.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
do $guard$
declare r record;p record;
begin
 if to_regprocedure('private.dashboard_admin_newar_report(jsonb,jsonb,date,date)') is not null then raise exception 'newar_report_helper_already_exists';end if;
 for r in select * from (values
 ('private.dashboard_admin_live_report_summary(jsonb)','445526032dbd003ba8ebe3dcb9f1da76',true,'{postgres=X/postgres,authenticated=X/postgres}'),
 ('private.dashboard_admin_live_report_source_rows(jsonb,date,date)','11438d060b9bb2892572ef429a99a349',false,'{postgres=X/postgres}')
 )v(signature,source_md5,definer,acl) loop
  select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid=r.signature::regprocedure;
  if md5(p.prosrc)<>r.source_md5 or p.prosecdef is distinct from r.definer or p.provolatile<>'s'
   or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.owner_name<>'postgres'
   or p.proacl::text is distinct from r.acl then raise exception 'newar_report_reader_baseline_drift';end if;
 end loop;
end;$guard$;
-- One materialized, scoped detail read per feed. Amounts never merge currencies.
create or replace function private.dashboard_admin_newar_report(p_feed jsonb,p_scope jsonb,p_start date,p_end date)
returns jsonb language sql stable set search_path='' set jit='off' as $function$
 with sites as materialized (
  select distinct p.name,p.country,p.source_name,p.timezone,n.launch_at
  from private.dashboard_admin_live_platforms() p join public.newar_detail_platforms n on n.platform=p.source_name
  where p.source='newar' and n.enabled and private.dashboard_scope_allows(p_scope,n.country_code,n.platform)
   and p_feed->>'dataset'='newar_third_party_volume' and p_feed->>'system'='NEW_AR' and p_feed->>'sourceKind'='direct'
   and p_feed->>'direction' in('charge','withdraw')
   and private.dashboard_admin_live_report_country(p_feed->>'country',p_feed->>'platform')=p.country
   and p_feed->>'platform' in(p.name,p.source_name)
 ), facts as materialized (
  select s.*,n.status_group,n.amount,nullif(btrim(n.currency),'') currency,n.captured_at,n.received_at,
   (n.created_at at time zone s.timezone)::date local_date,
   case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
    when n.dataset='withdraw' and n.status_group in('failed','rejected') and coalesce(btrim(n.provider),'') in('','人工取消') then '无三方（驳回）'
    else coalesce(nullif(btrim(n.provider),''),'未识别通道') end raw_provider
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset=p_feed->>'direction'
  where n.created_at>=p_start::timestamp at time zone s.timezone and n.created_at<(p_end+1)::timestamp at time zone s.timezone
   and (s.launch_at is null or n.created_at>=s.launch_at)
 ), money as (
  select case when count(*)>0 and count(currency)=count(*) and count(distinct currency)=1 then min(currency) end currency from facts
 ), days as materialized (
  select s.*,d::date local_date,d::timestamp at time zone s.timezone day_start,(d::date+1)::timestamp at time zone s.timezone day_end,
   (select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) from private.newar_detail_coverage_runs c
    where c.platform=s.source_name and c.dataset=p_feed->>'direction' and c.invalidated_at is null and c.observed_at<=statement_timestamp()
     and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone and c.end_at>d::timestamp at time zone s.timezone) ranges,
   greatest((select max(f.received_at) from facts f where f.source_name=s.source_name and f.local_date=d::date),
    (select max(c.observed_at) from private.newar_detail_coverage_runs c where c.platform=s.source_name and c.dataset=p_feed->>'direction'
     and c.invalidated_at is null and c.observed_at<=statement_timestamp() and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone
     and c.end_at>d::timestamp at time zone s.timezone)) latest_seen
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ), evidence as materialized (
  select d.*,day_end<=statement_timestamp() and (launch_at is null or day_start>=launch_at)
   and coalesce(ranges @> tstzrange(day_start,day_end,'[)'),false)
   and not exists(select 1 from facts f where f.source_name=d.source_name and f.local_date=d.local_date and f.captured_at>statement_timestamp()) complete from days d
 ), grouped as (
  select f.country,f.source_name,f.local_date,f.raw_provider,
   jsonb_build_object('count',count(*),'successCount',count(*) filter(where status_group='success'),
    'failedCount',count(*) filter(where status_group in('failed','rejected')),'pendingCount',count(*) filter(where status_group='pending'),
    'unknownCount',count(*) filter(where status_group is null or status_group not in('success','failed','rejected','pending')),
    'amount',case when m.currency is not null and count(amount)=count(*) then sum(amount) end,
    'successAmount',case when m.currency is not null and count(amount) filter(where status_group='success')=count(*) filter(where status_group='success')
     then coalesce(sum(amount) filter(where status_group='success'),0) end) metrics,max(f.received_at) updated_at
  from facts f cross join money m group by f.country,f.source_name,f.local_date,f.raw_provider,m.currency
 ), rows as (
  select local_date data_date,'provider'::text grain,private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) provider,metrics,updated_at from grouped
  union all
  select e.local_date,'provider',null,jsonb_build_object('count',0,'successCount',0,'failedCount',0,'pendingCount',0,'unknownCount',0,
    'amount',case when m.currency is not null then 0 end,'successAmount',case when m.currency is not null then 0 end),e.latest_seen
  from evidence e cross join money m where e.complete and not exists(select 1 from facts f where f.source_name=e.source_name and f.local_date=e.local_date)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.data_date,r.provider nulls last) from rows r),'[]'::jsonb),
  'currency',(select currency from money),'currencyBasis',case when (select currency from money) is not null then 'detail_currency' else 'mixed_or_unknown' end,
  'timezone',(select min(timezone) from sites),'statisticBasis','created_at_current_status','timeBasis','created_at',
  'detailCoverage',jsonb_build_object('complete',coalesce((select bool_and(complete) from evidence),false),
   'latestCollectedAt',(select max(latest_seen) from evidence),
   'days',coalesce((select jsonb_agg(jsonb_build_object('country',e.country,'platform',e.name,'date',e.local_date,'complete',e.complete,'latestCollectedAt',e.latest_seen) order by e.local_date,e.name) from evidence e),'[]'::jsonb)));
$function$;
revoke all on function private.dashboard_admin_newar_report(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;

do $patch$
declare d text;r record;before_meta jsonb;target regprocedure:='private.dashboard_admin_live_report_source_rows(jsonb,date,date)'::regprocedure;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,before_meta from pg_proc p where p.oid=target;
 for r in select * from (values
 ($old$ elsif p_feed->>'dataset'='newar_third_party_volume' then
  return query select t.stat_date,'provider'::text,nullif(r->>'third_party',''),
   jsonb_build_object('amount',private.dashboard_admin_live_report_number(r,'amount'),'count',private.dashboard_admin_live_report_number(r,'count'),
    'successAmount',private.dashboard_admin_live_report_number(r,'success_amount'),'successCount',private.dashboard_admin_live_report_number(r,'success_count'),
    'failedCount',private.dashboard_admin_live_report_number(r,'failed_count')),coalesce(t.captured_at,t.updated_at)
  from public.newar_business_snapshots t
  left join lateral jsonb_array_elements(case when jsonb_typeof(t.payload->'rows')='array' then t.payload->'rows' else '[]'::jsonb end)r on true
  where t.kind='third_party_volume' and coalesce(nullif(t.country,''),t.country_code)=p_feed->>'country' and t.platform=p_feed->>'platform' and t.stat_date between p_start and p_end
   and private.dashboard_admin_live_report_direction(t.direction)=p_feed->>'direction';
$old$,$new$ elsif p_feed->>'dataset'='newar_third_party_volume' then
  return query select r.* from jsonb_to_recordset(private.dashboard_admin_newar_report(p_feed,private.dashboard_admin_live_scope(),p_start,p_end)->'rows')
   r(data_date date,grain text,provider text,metrics jsonb,updated_at timestamptz);
$new$)
 )v(old_text,new_text) loop
  if (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 then raise exception 'newar_report_patch_anchor_drift';end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from before_meta then raise exception 'newar_report_metadata_changed';end if;
end;$patch$;

do $patch$
declare d text;r record;before_meta jsonb;target regprocedure:='private.dashboard_admin_live_report_summary(jsonb)'::regprocedure;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,before_meta from pg_proc p where p.oid=target;
 for r in select * from (values
 ($old$ with feeds as materialized(select value f from jsonb_array_elements(v_feeds)),source_rows as materialized(
  select f->>'id' feed_id,r.* from feeds cross join lateral private.dashboard_admin_live_report_source_rows(f,v_start,v_end)r$old$,$new$ with feeds as materialized(select value f from jsonb_array_elements(v_feeds)),newar_reports as materialized(
  select f->>'id' feed_id,private.dashboard_admin_newar_report(f,v_scope,v_start,v_end) body from feeds where f->>'dataset'='newar_third_party_volume'
 ),source_rows as materialized(
  select f->>'id' feed_id,r.* from feeds cross join lateral private.dashboard_admin_live_report_source_rows(f,v_start,v_end)r
   where f->>'dataset'<>'newar_third_party_volume'
  union all select n.feed_id,r.* from newar_reports n cross join lateral jsonb_to_recordset(n.body->'rows')
   r(data_date date,grain text,provider text,metrics jsonb,updated_at timestamptz)$new$),
 ($old$'groups',coalesce(g.groups,'[]'::jsonb)) order by f->>'id'$old$,$new$'groups',coalesce(g.groups,'[]'::jsonb))||coalesce(n.body-'rows','{}'::jsonb) order by f->>'id'$new$),
 ($old$from feeds left join groups g on g.feed_id=f->>'id' left join received r on r.feed_id=f->>'id';$old$,$new$from feeds left join groups g on g.feed_id=f->>'id' left join received r on r.feed_id=f->>'id' left join newar_reports n on n.feed_id=f->>'id';$new$),
 ($old$'timeBasis','source_report_date',$old$,$new$'timeBasis',case when exists(select 1 from newar_reports) then 'per_feed' else 'source_report_date' end,$new$)
 )v(old_text,new_text) loop
  if (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 then raise exception 'newar_report_patch_anchor_drift';end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from before_meta then raise exception 'newar_report_metadata_changed';end if;
end;$patch$;
commit;
