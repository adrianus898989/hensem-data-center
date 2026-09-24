-- Read-only daily statistics, shared source parity and independently scoped reason details.
-- The existing main UI and the ingestion paths are unchanged.
begin;
create or replace function private.dashboard_admin_live_withdraw_key(p_name text)
returns text language sql immutable set search_path='' as $$
 select case upper(btrim(p_name)) when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN'
 when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end;
$$;
revoke all on function private.dashboard_admin_live_withdraw_key(text) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_game66_withdraw(
  p_start date,
  p_end date, p_country text, p_platforms text[]
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_operator_rows jsonb := '[]'::jsonb;
  v_latest timestamptz;
  v_operator_latest timestamptz;
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  perform private.dashboard_admin_live_scope();
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 366 then
    raise exception using errcode = '22023', message = 'GAME66_INVALID_DATE_RANGE';
  end if;

  v_scope := private.dashboard_admin_live_scope();
  v_start_at := p_start::timestamp at time zone 'Asia/Kolkata';
  v_end_at := (p_end + 1)::timestamp at time zone 'Asia/Kolkata';

  with daily_grouped as (
    select
      (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case p.team_code
        when 'hong_kong' then 'HK_TEAM'
        when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code)
      end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform,
      count(*)::bigint as total,
      count(*) filter (where w.status_code in ('1', '3'))::bigint as success,
      count(*) filter (where w.status_code = '-1')::bigint as rejected,
      count(*) filter (where w.auto_commit = '2')::bigint as auto_count,
      count(*) filter (where w.auto_commit is distinct from '2')::bigint as manual_count,
      count(*) filter (where w.status_code = '1')::bigint as submitted_count,
      count(*) filter (where w.status_code = '3')::bigint as paid_count,
      count(*) filter (where w.status_code = '2')::bigint as payout_failed_count,
      coalesce(avg(greatest(0::numeric, extract(epoch from (
        coalesce(w.update_time, w.submit_time, w.last_seen_at, w.create_time) - w.create_time
      )))) filter (where w.create_time is not null), 0)::numeric as avg_seconds,
      max(coalesce(w.last_seen_at, w.update_time, w.submit_time, w.create_time)) as updated_at
    from public.game66_withdraw_orders w
    join public.game66_platforms p on p.id = w.platform_id
    where p.team_name=p_country and (p_platforms is null or private.dashboard_admin_live_withdraw_key(p.platform_name)=any(p_platforms)) and w.create_time >= v_start_at
      and w.create_time < v_end_at
      and private.dashboard_scope_allows(
        v_scope,
        case p.team_code
          when 'hong_kong' then 'HK_TEAM'
          when 'red_crab' then 'RED_CRAB'
          else upper(p.team_code)
        end,
        p.platform_name
      )
    group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66', data_date::text, country_code, platform)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'total', total,
      'success', success,
      'rejected', rejected,
      'auto_count', auto_count,
      'manual_count', manual_count,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object(
        'submitted_count', submitted_count,
        'paid_count', paid_count,
        'payout_failed_count', payout_failed_count,
        'success_status_codes', jsonb_build_array('1', '3'),
        'reject_status_code', '-1'
      ),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform), '[]'::jsonb),
    max(updated_at)
  into v_rows, v_latest
  from daily_grouped;

  with operator_grouped as (
    select
      (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case p.team_code
        when 'hong_kong' then 'HK_TEAM'
        when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code)
      end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform,
      case
        when w.auto_commit = '2' then '自动审核'
        else coalesce(
          nullif(pg_catalog.btrim(w.audit_admin), ''),
          nullif(pg_catalog.btrim(w.lock_admin), ''),
          nullif(pg_catalog.btrim(w.lock_user_admin), ''),
          '人工审核（未标记账号）'
        )
      end as account,
      count(*)::bigint as processed,
      count(*) filter (where w.status_code = '-1')::bigint as rejected,
      coalesce(avg(greatest(0::numeric, extract(epoch from (
        coalesce(w.update_time, w.submit_time, w.last_seen_at, w.create_time) - w.create_time
      )))) filter (where w.create_time is not null), 0)::numeric as avg_seconds,
      max(coalesce(w.last_seen_at, w.update_time, w.submit_time, w.create_time)) as updated_at
    from public.game66_withdraw_orders w
    join public.game66_platforms p on p.id = w.platform_id
    where p.team_name=p_country and (p_platforms is null or private.dashboard_admin_live_withdraw_key(p.platform_name)=any(p_platforms)) and w.create_time >= v_start_at
      and w.create_time < v_end_at
      and private.dashboard_scope_allows(
        v_scope,
        case p.team_code
          when 'hong_kong' then 'HK_TEAM'
          when 'red_crab' then 'RED_CRAB'
          else upper(p.team_code)
        end,
        p.platform_name
      )
    group by 1, 2, 3, 4, 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66-operator', data_date::text, country_code, platform, account)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'account', account,
      'processed', processed,
      'rejected', rejected,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object('operator_source', case when account = '自动审核' then 'auto_commit' else 'audit_admin' end),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform, account), '[]'::jsonb),
    max(updated_at)
  into v_operator_rows, v_operator_latest
  from operator_grouped;

  v_latest := greatest(v_latest, v_operator_latest);
  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'operatorRows', v_operator_rows,
    'latestWriteAt', v_latest
  );
end;
$$;


revoke all on function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) from public,anon,authenticated;
create or replace function private.dashboard_admin_live_can_note()
returns boolean language sql stable security definer set search_path='' as $$
 select public.dashboard_has_permission('auto_withdraw') and exists(select 1 from public.dashboard_profiles p
   where p.auth_user_id=auth.uid() and p.active and p.role in('owner','admin'));
$$;
revoke all on function private.dashboard_admin_live_can_note() from public,anon,authenticated;

create or replace function private.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_start date;v_end date;v_before date;v_days integer;
 v_country text;v_platforms text[];v_account text;v_key text;v_view text;v_sort text;v_asc boolean;
 v_limit integer;v_offset integer;v_result jsonb;v_game jsonb:='{}'::jsonb;v_daily boolean;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768 or
  p_request-array['startAt','endAt','country','platform','platforms','account','view','sort','ascending','daily','offset','limit']<>'{}'::jsonb then
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
 if exists(select 1 from private.dashboard_admin_live_platforms() where source='game66' and country=v_country) then
  v_game:=private.dashboard_admin_live_game66_withdraw(v_before,v_end,v_country,v_platforms);
 end if;
 with direct as materialized (
  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key from public.newar_business_snapshots s
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.country=v_country and s.stat_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,s.country_code,s.platform)
 ), legacy_daily as (
  select distinct on(a.data_date,a.country,private.dashboard_admin_live_withdraw_key(a.platform))
   a.data_date,a.country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform) as platform_key,
   a.total::bigint,a.success::bigint,a.rejected::bigint,a.auto_count::bigint,
   coalesce(a.manual_count,greatest(a.total-a.auto_count,0))::bigint as manual_count,a.avg_seconds::numeric,
   a.source_updated_at,a.updated_at
  from public.auto_withdraw_daily a where a.country=v_country and a.data_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,a.country,a.platform)
   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.platform_key=private.dashboard_admin_live_withdraw_key(a.platform) and n.payload ? 'rows')
  order by a.data_date,a.country,private.dashboard_admin_live_withdraw_key(a.platform),coalesce(a.updated_at,a.source_updated_at) desc
 ), daily_source as materialized (
  select * from legacy_daily
  union all
  select n.stat_date,n.country,n.platform,n.platform_key,(r->>'total_count')::bigint,(r->>'success_count')::bigint,
   (r->>'reject_count')::bigint,(r->>'auto_count')::bigint,coalesce((r->>'manual_count')::bigint,greatest((r->>'total_count')::bigint-(r->>'auto_count')::bigint,0)),
   (r->>'total_handle_seconds')::numeric/nullif((r->>'handle_count')::numeric,0),n.captured_at,n.updated_at
  from direct n cross join lateral jsonb_array_elements(n.payload->'rows')r
  union all
  select (r->>'data_date')::date,r->>'country',r->>'platform',private.dashboard_admin_live_withdraw_key(r->>'platform'),
   (r->>'total')::bigint,(r->>'success')::bigint,(r->>'rejected')::bigint,(r->>'auto_count')::bigint,(r->>'manual_count')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz
  from jsonb_array_elements(coalesce(v_game->'rows','[]'::jsonb))r
 ), legacy_operators as (
  select distinct on(o.data_date,o.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account)
   o.data_date,o.country,o.platform,private.dashboard_admin_live_withdraw_key(o.platform) as platform_key,o.account,
   o.processed::bigint,o.rejected::bigint,o.avg_seconds::numeric,o.source_updated_at,o.updated_at
  from public.withdraw_operator_daily o where o.country=v_country and o.data_date between v_before and v_end
   and private.dashboard_scope_allows(v_scope,o.country,o.platform)
   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.platform_key=private.dashboard_admin_live_withdraw_key(o.platform) and n.payload ? 'operator_rows')
  order by o.data_date,o.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account,coalesce(o.updated_at,o.source_updated_at) desc
 ), operator_source as materialized (
  select * from legacy_operators
  union all
  select n.stat_date,n.country,n.platform,n.platform_key,r->>'operator',(r->>'processed_count')::bigint,(r->>'reject_count')::bigint,
   (r->>'total_handle_seconds')::numeric/nullif((r->>'handle_count')::numeric,0),n.captured_at,n.updated_at
  from direct n cross join lateral jsonb_array_elements(n.payload->'operator_rows')r
  union all
  select (r->>'data_date')::date,r->>'country',r->>'platform',private.dashboard_admin_live_withdraw_key(r->>'platform'),r->>'account',
   (r->>'processed')::bigint,(r->>'rejected')::bigint,(r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz
  from jsonb_array_elements(coalesce(v_game->'operatorRows','[]'::jsonb))r
 ), daily as materialized (
  select * from daily_source where v_platforms is null or platform_key=any(v_platforms)
 ), operators as materialized (
  select * from operator_source where (v_platforms is null or platform_key=any(v_platforms)) and (v_account is null or position(lower(v_account) in lower(account))>0)
 ), daily_group as (
  select country,platform_key,max(platform) platform,case when v_daily then data_date else v_start end as group_date,
   (data_date>=v_start) current_period,sum(total)::bigint total,sum(success)::bigint success,sum(rejected)::bigint rejected,
   sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count,
   sum(avg_seconds*total)/nullif(sum(total) filter(where avg_seconds is not null),0) avg_seconds,
   max(source_updated_at) source_updated_at,count(distinct data_date) covered_days
  from daily group by 1,2,4,5
 ), operator_group as (
  select country,platform_key,max(platform) platform,account,case when v_daily then data_date else v_start end as group_date,
   (data_date>=v_start) current_period,sum(processed)::bigint processed,sum(rejected)::bigint rejected,
   sum(avg_seconds*processed)/nullif(sum(processed) filter(where avg_seconds is not null),0) avg_seconds,
   max(source_updated_at) source_updated_at,count(distinct data_date) covered_days
  from operators group by 1,2,4,5,6
 ), presented as materialized (
  select d.country,d.platform,d.platform_key,d.group_date,''::text account,
   jsonb_build_object('dataDate',d.group_date,'country',d.country,'platform',d.platform,'total',d.total,'success',d.success,'rejected',d.rejected,
   'autoCount',d.auto_count,'manualCount',d.manual_count,'unclassifiedCount',greatest(d.total-d.auto_count-d.manual_count,0),
   'avgSeconds',d.avg_seconds,'sourceUpdatedAt',d.source_updated_at,'coveredDays',d.covered_days,
   'previous',case when p.platform_key is not null then jsonb_build_object('total',p.total,'success',p.success,'rejected',p.rejected,'autoCount',p.auto_count,'manualCount',p.manual_count,'avgSeconds',p.avg_seconds,'coveredDays',p.covered_days) end) item
  from daily_group d left join daily_group p on p.country=d.country and p.platform_key=d.platform_key
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  where d.current_period and v_view='auto'
  union all
  select d.country,d.platform,d.platform_key,d.group_date,d.account,
   jsonb_build_object('dataDate',d.group_date,'country',d.country,'platform',d.platform,'account',d.account,'processed',d.processed,'rejected',d.rejected,
   'success',greatest(d.processed-d.rejected,0),'avgSeconds',d.avg_seconds,'sourceUpdatedAt',d.source_updated_at,'coveredDays',d.covered_days,
   'previous',case when p.platform_key is not null then jsonb_build_object('processed',p.processed,'success',greatest(p.processed-p.rejected,0),'rejected',p.rejected,'avgSeconds',p.avg_seconds,'coveredDays',p.covered_days) end)
  from operator_group d left join operator_group p on p.country=d.country and p.platform_key=d.platform_key and p.account=d.account
    and (case when v_daily then p.group_date=d.group_date-1 else not p.current_period end)
  where d.current_period and v_view='operators'
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
   'avgSeconds',sum(avg_seconds*total)/nullif(sum(total) filter(where avg_seconds is not null),0),'platforms',count(distinct platform_key),'coveredDays',count(distinct data_date)) item
  from daily group by 1
 ), operator_totals as (
  select (data_date>=v_start) current_period,jsonb_build_object('processed',sum(processed),'rejected',sum(rejected),'success',sum(greatest(processed-rejected,0)),
   'avgSeconds',sum(avg_seconds*processed)/nullif(sum(processed) filter(where avg_seconds is not null),0),'operators',count(distinct (platform_key,account)),
   'platforms',count(distinct platform_key),'coveredDays',count(distinct data_date)) item from operators group by 1
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
        (select count(distinct platform_key) from daily where data_date>=v_start)=(select count(distinct platform_key) from daily where data_date<v_start)
        else (select count(distinct(platform_key,account)) from operators where data_date>=v_start)=(select count(distinct(platform_key,account)) from operators where data_date<v_start) end),
  'canWriteNotes',private.dashboard_admin_live_can_note(),
  'platforms',coalesce((select jsonb_agg(platform order by platform) from (select distinct platform from daily_source union select distinct platform from operator_source) p),'[]'::jsonb),
  'notes',coalesce((select jsonb_agg(jsonb_build_object('date',n.data_date,'country',n.country,'platform',n.platform,'reason',n.reason,'updatedAt',n.updated_at,
    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text))) from public.auto_withdraw_notes n where n.country=v_country and n.data_date between v_start and v_end
    and (v_platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_auto_withdraw(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;
create or replace function public.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_auto_withdraw(p_request)$$;
revoke all on function public.dashboard_admin_live_auto_withdraw(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
