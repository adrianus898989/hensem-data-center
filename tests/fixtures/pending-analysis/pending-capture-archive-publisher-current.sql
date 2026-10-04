-- Actual production private publisher definition; no business records or credentials.
CREATE OR REPLACE FUNCTION private.archive_withdraw_pending_capture(p_source_system text, p_country_code text, p_platform text, p_snapshot_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h public.withdraw_pending_backlog_daily%rowtype; archive_key uuid; expected_days integer;
  partitions jsonb; detail_rows jsonb; groups_actual jsonb; groups_expected jsonb;
  partition_count bigint; meta_count bigint; meta_amount numeric; order_count bigint; unique_count bigint; order_amount numeric;
  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb;
begin
  if p_source_system is distinct from 'WITHDRAW_REVIEW' or p_country_code is null or p_country_code !~ '^[A-Z]{2}$'
    or nullif(btrim(p_platform),'') is null or p_snapshot_at is null or not isfinite(p_snapshot_at)
    or p_snapshot_at>clock_timestamp()+interval '5 minutes' then return null; end if;
  -- Match the existing platform publication lock. No per-order lookup or lock.
  perform pg_advisory_xact_lock(hashtextextended('withdraw-pending-backlog:'||jsonb_build_array(p_source_system,p_country_code,p_platform)::text,0));
  select b.* into h from public.withdraw_pending_backlog_daily b
    where b.source_system=p_source_system and b.country_code=p_country_code and b.platform=p_platform and b.snapshot_at=p_snapshot_at;
  if not found then return null; end if;
  select a.id into archive_key from private.withdraw_pending_capture_archive a where
    a.source_system=h.source_system and a.country_code=h.country_code and a.platform=h.platform
    and a.snapshot_at=h.snapshot_at and a.window_start=h.window_start and a.window_end=h.window_end;
  if found then return archive_key; end if;
  expected_days:=h.window_end-h.window_start+1;
  if expected_days not between 1 and 30 or h.capture_date<>h.window_end+1 or h.stat_date<>h.window_end
    or h.snapshot#>'{coverage,complete}' is distinct from 'true'::jsonb
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{coverage,fetched_count}'
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{coverage,unique_count}'
    or h.snapshot#>'{coverage,expected_count}' is distinct from h.snapshot#>'{totals,pending_count}'
    or nullif(h.snapshot->>'timezone','') is null
    or (h.snapshot#>>'{totals,pending_amount}')::numeric::text in ('NaN','Infinity','-Infinity')
    then return null; end if;
  -- All evidence is read in one MVCC statement. A zero partition still needs an
  -- exact detailed receipt and timestamp; no missing day is invented as zero.
  with days as materialized (
    select d.*,r.order_count as receipt_count from public.withdraw_pending_daily d
      join public.withdraw_pending_order_receipts r on r.snapshot_id=d.snapshot_id
      and r.scope=d.snapshot-array['schema_version','coverage','totals','groups']
    where d.source_system=h.source_system and d.country_code=h.country_code and d.platform=h.platform
      and d.stat_date between h.window_start and h.window_end and d.snapshot_at=h.snapshot_at
      and d.snapshot->>'timezone'=h.snapshot->>'timezone'
  ), orders as materialized (
    select o.* from days d join public.withdraw_pending_orders o
      on o.source_system=d.source_system and o.country_code=d.country_code and o.platform=d.platform
      and o.stat_date=d.stat_date and o.snapshot_id=d.snapshot_id and o.snapshot_at=d.snapshot_at
  ), day_totals as (
    select stat_date,count(*) as n,sum(amount) as amount from orders group by stat_date
  ), provider_totals as (
    select raw_channel,channel_type,count(*) as n,sum(amount) as amount from orders group by raw_channel,channel_type
  ) select
    (select count(*) from days),
    (select coalesce(sum((snapshot#>>'{totals,pending_count}')::bigint),0) from days),
    (select coalesce(sum((snapshot#>>'{totals,pending_amount}')::numeric),0) from days),
    (select coalesce(bool_or(d.receipt_count<>(d.snapshot#>>'{totals,pending_count}')::bigint
      or coalesce(t.n,0)<>d.receipt_count or coalesce(t.amount,0)<>(d.snapshot#>>'{totals,pending_amount}')::numeric
      or d.snapshot#>'{coverage,complete}' is distinct from 'true'::jsonb
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{coverage,fetched_count}'
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{coverage,unique_count}'
      or d.snapshot#>'{coverage,expected_count}' is distinct from d.snapshot#>'{totals,pending_count}'),false)
      from days d left join day_totals t using(stat_date)),
    (select count(*) from orders),(select count(distinct order_no) from orders),
    (select coalesce(sum(amount),0) from orders),
    (select coalesce(bool_or(status is distinct from '已提交' or nullif(btrim(order_no),'') is null
      or amount is null or amount<0 or amount::text in ('NaN','Infinity','-Infinity')
      or applied_at is not null and not isfinite(applied_at)
      or nullif(btrim(raw_channel),'') is null or nullif(btrim(channel_type),'') is null
      or timezone is distinct from h.snapshot->>'timezone'),false) from orders),
    (select coalesce(jsonb_agg(jsonb_build_object('stat_date',stat_date,'snapshot_id',snapshot_id,'snapshot_at',snapshot_at,
      'order_count',receipt_count) order by stat_date),'[]'::jsonb) from days),
    (select coalesce(jsonb_agg(jsonb_build_object('order_no',order_no,'stat_date',stat_date,'amount',amount,'applied_at',applied_at,
      'raw_channel',raw_channel,'channel_type',channel_type,'status',status,'snapshot_id',snapshot_id,'snapshot_at',snapshot_at)
      order by order_no),'[]'::jsonb) from orders),
    (select coalesce(jsonb_agg(jsonb_build_object('raw_channel',raw_channel,'channel_type',channel_type,
      'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals)
  into partition_count,meta_count,meta_amount,bad_partitions,order_count,unique_count,order_amount,bad_orders,partitions,detail_rows,groups_actual;
  select coalesce(jsonb_agg(value order by value->>'raw_channel',value->>'channel_type'),'[]'::jsonb)
    into groups_expected from jsonb_array_elements(h.snapshot->'groups');
  if partition_count<>expected_days or bad_partitions or bad_orders or meta_count<>order_count or unique_count<>order_count
    or meta_amount::text in ('NaN','Infinity','-Infinity') or order_amount::text in ('NaN','Infinity','-Infinity')
    or meta_amount<>order_amount or order_count<>(h.snapshot#>>'{totals,pending_count}')::bigint
    or order_amount<>(h.snapshot#>>'{totals,pending_amount}')::numeric or groups_actual<>groups_expected
    then return null; end if;
  -- Reuse ONLY an exact, still-current identity. The legacy producer does not
  -- carry a team/native-source/currency; unknown identity/currency stays unknown.
  with native as (
    select 'AR'::text as source_system,t.country_code,t.platform,t.timezone,t.currency
      from public.ar_config_targets t where t.source_system='AR' and t.country_code=h.country_code and t.platform=h.platform
    union all select 'NEW_AR',n.country_code,n.platform,n.timezone,n.currency
      from public.newar_detail_platforms n where n.enabled and n.country_code=h.country_code and n.platform=h.platform
  ) select coalesce(jsonb_agg(jsonb_build_object('source_system',i.source_system,'platform_id',i.platform_id,
      'team_name',i.team_name,'currency',i.currency)),'[]'::jsonb) into native_candidates
    from private.collector_platform_identities i join native n on n.source_system=i.source_system
      and n.country_code=i.country_code and n.platform=i.source_platform and n.timezone=i.timezone
      and n.currency is not distinct from i.currency
    join public.dashboard_platform_team_map m on m.id=i.mapping_id and m.active
      and m.source_system=i.source_system and m.country_code=i.country_code and m.source_platform=i.source_platform
      and m.source_country=i.source_country and m.team_name=i.team_name
    where i.country_code=h.country_code and i.source_platform=h.platform and i.timezone=h.snapshot->>'timezone'
      and (not(i.country_code='IN' and ((i.source_system='AR' and i.source_platform in('Shree.Win','Veer.Game'))
        or (i.source_system='NEW_AR' and i.source_platform='DhaniWin')))
        or (i.verified_at<=h.snapshot_at and m.updated_at<=h.snapshot_at))
      and (select count(*) from public.dashboard_platform_team_map other
        where other.active and other.source_system=i.source_system
          and other.country_code=i.country_code and other.source_platform=i.source_platform)=1;
  if jsonb_array_length(native_candidates)=1 then identity:=native_candidates->0; else identity:=null; end if;
  insert into private.withdraw_pending_capture_archive(source_system,country_code,platform,stat_date,capture_date,window_start,window_end,
    window_days,snapshot_id,snapshot_at,snapshot,timezone,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,
    partition_snapshots,pending_count,pending_amount)
  values(h.source_system,h.country_code,h.platform,h.stat_date,h.capture_date,h.window_start,h.window_end,
    expected_days,h.snapshot_id,h.snapshot_at,h.snapshot,h.snapshot->>'timezone',
    (h.snapshot_at at time zone (h.snapshot->>'timezone'))::time between time '00:00' and time '00:05',
    case when identity is null then 'legacy_unbound' else 'resolved' end,identity->>'source_system',(identity->>'platform_id')::uuid,
    identity->>'team_name',identity->>'currency',partitions,order_count,order_amount) returning id into archive_key;
  insert into private.withdraw_pending_capture_orders(archive_id,order_no,source_system,country_code,platform,stat_date,amount,applied_at,timezone,
    raw_channel,channel_type,status,snapshot_id,snapshot_at)
  select archive_key,value->>'order_no',h.source_system,h.country_code,h.platform,(value->>'stat_date')::date,(value->>'amount')::numeric,
    (value->>'applied_at')::timestamp,h.snapshot->>'timezone',value->>'raw_channel',value->>'channel_type',value->>'status',
    (value->>'snapshot_id')::uuid,(value->>'snapshot_at')::timestamptz from jsonb_array_elements(detail_rows);
  return archive_key;
end;
$function$
