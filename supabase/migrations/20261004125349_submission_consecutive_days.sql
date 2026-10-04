-- Finite, actor-owned, one-day-at-a-time analysis jobs. Raw sources and the
-- original >15 invalid-submission reader remain unchanged. Each explicit query
-- gets fresh day captures; this is not claimed to be an atomic upstream snapshot.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create table private.dashboard_submission_streak_jobs (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,client_request_id uuid not null,
 platform_id uuid not null,request jsonb not null,platform jsonb not null,
 first_day date not null,end_day date not null,lookback_days integer not null check(lookback_days in (7,15,30)),
 excluded_partial_day_count integer not null check(excluded_partial_day_count in (0,1)),
 created_at timestamptz not null default statement_timestamp(),expires_at timestamptz not null,
 unique(actor_id,client_request_id),check(end_day-first_day=lookback_days)
);
create index dashboard_submission_streak_jobs_actor_expiry on private.dashboard_submission_streak_jobs(actor_id,expires_at);
create index dashboard_submission_streak_jobs_expiry on private.dashboard_submission_streak_jobs(expires_at);
create table private.dashboard_submission_streak_days (
 job_id uuid not null references private.dashboard_submission_streak_jobs(id) on delete cascade,
 day date not null,result jsonb not null,result_bytes integer not null check(result_bytes between 0 and 4194304),captured_at timestamptz not null default statement_timestamp(),primary key(job_id,day)
);
alter table private.dashboard_submission_streak_jobs enable row level security;
alter table private.dashboard_submission_streak_days enable row level security;
revoke all on private.dashboard_submission_streak_jobs,private.dashboard_submission_streak_days from public,anon,authenticated,service_role;

create function private.dashboard_submission_streak_capture_day(p_platform jsonb,p_day date,p_providers text[],p_currency text)
returns jsonb language plpgsql stable security invoker set search_path='' set jit='off' set work_mem='64MB' set enable_mergejoin='off' as $$
declare
 v_platform record;v_id uuid;v_start timestamptz;v_end timestamptz;v_from timestamptz;v_to timestamptz;
 v_currency text;v_providers text[]:=p_providers;v_source text;v_success text;v_sql text;v_result jsonb;
 v_time_filter text;v_undated_filter text;v_confirmations jsonb:='{}'::jsonb;
begin
 select * into v_platform from jsonb_to_record(p_platform) as t(id uuid,name text,source text,scope_group text,source_name text,country text,timezone text,currency text);
 v_id:=v_platform.id;v_currency:=coalesce(p_currency,v_platform.currency);
 v_from:=p_day::timestamp at time zone v_platform.timezone;v_to:=(p_day+1)::timestamp at time zone v_platform.timezone;
 v_start:=v_from;v_end:=v_to;
 if v_platform.source='ar' then
  v_time_filter:='a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)';v_undated_filter:='a.applied_at is null';
  if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
   execute 'select coalesce(jsonb_object_agg(order_no,confirmed_provider),''{}''::jsonb) from private.dashboard_admin_order_provider_confirmations where source_system=''AR'' and country_code=$1 and platform=$2 and order_kind=''recharge'' and active'
    into v_confirmations using v_platform.scope_group,v_platform.source_name;
  end if;
  v_source:=$q$select a.order_no order_id,nullif(btrim(a.member_id),'') member_id,
   a.applied_at::date local_day,a.applied_at at time zone $4 created_at,a.amount,$17::text currency,coalesce(nullif(btrim(a.raw_channel),''),$18->>a.order_no,'未识别通道') raw_provider,
   (a.status='已支付' and a.completed_at is null) success_time_missing,coalesce(a.status in ('已支付','待支付','支付失败','已取消'),false) status_known
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(a.member_id),'') member_id,a.completed_at::date as day
   from public.ar_collected_orders a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'
   and a.status='已支付' and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)$q$;
 elsif v_platform.source='newar' then
  v_time_filter:='n.created_at>=$5 and n.created_at<$6';v_undated_filter:='n.created_at is null';
  v_source:=$q$select coalesce(nullif(n.order_number,''),n.source_id) order_id,nullif(btrim(n.member_id),'') member_id,(n.created_at at time zone $4)::date local_day,n.created_at,n.amount,n.currency,
   case when coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值' else coalesce(nullif(btrim(n.provider),''),'未识别通道') end raw_provider,
   (n.status_group='success' and n.success_at is null) success_time_missing,coalesce(n.status_group in ('success','pending','failed','rejected'),false) status_known
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and ($source_time_filter$)
   and (t.launch_at is null or n.created_at>=t.launch_at or n.created_at is null)$q$;
  v_success:=$q$select nullif(btrim(n.member_id),'') member_id,(n.success_at at time zone $4)::date as day
   from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
   where n.platform=$3 and n.dataset='charge' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6
   and (t.launch_at is null or n.created_at>=t.launch_at)$q$;
 elsif v_platform.source='lg' then
  v_time_filter:='l.created_at>=$5 and l.created_at<$6';v_undated_filter:='l.created_at is null';
  v_source:=$q$select l.order_no order_id,nullif(btrim(l.member_id),'') member_id,(l.created_at at time zone $4)::date local_day,l.created_at,l.metric_amount amount,$17::text currency,
   coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') raw_provider,
   (l.status_class='success' and l.paid_at is null) success_time_missing,coalesce(l.status_class in ('success','pending','rejected'),false) status_known
   from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(l.member_id),'') member_id,(l.paid_at at time zone $4)::date as day from public.lg_orders l
   where l.country_code=$2 and l.platform=$3 and l.source_system='LG' and l.order_kind='recharge' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6$q$;
 elsif v_platform.source='game66' then
  v_time_filter:='c.create_time>=$5 and c.create_time<$6';v_undated_filter:='c.create_time is null';
  v_source:=$q$select c.order_num order_id,nullif(btrim(c.uid),'') member_id,(c.create_time at time zone $4)::date local_day,c.create_time created_at,coalesce(c.amount_display,c.amount_minor/100.0) amount,'INR'::text currency,
   coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') raw_provider,(c.status_code='1' and c.pay_time is null) success_time_missing,coalesce(c.status_code in ('1','0'),false) status_known
   from public.game66_charge_orders c where c.platform_id=$1 and ($source_time_filter$)$q$;
  v_success:=$q$select nullif(btrim(c.uid),'') member_id,(c.pay_time at time zone $4)::date as day from public.game66_charge_orders c
   where c.platform_id=$1 and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6$q$;
 else
  raise exception using errcode='22023',message='submission_source_unavailable';
 end if;
 -- Keep bounded time reads and the sparse NULL-time lookup as independent
 -- indexable branches; an OR would encourage full platform-history scans.
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 v_sql:='with source_rows as materialized ('||v_source||'), success_rows as not materialized ('||v_success||$q$),
 successes as materialized (
  select day,member_id,count(*) success_count from success_rows group by day,member_id
 ), uncertain_days as materialized (select day from successes where member_id is null),
 source_day_coverage as materialized (
  select local_day as day,count(*) order_count,
   count(*) filter(where member_id is null) missing_member_count,count(*) filter(where not status_known) unknown_status_count,
   count(*) filter(where created_at is null or nullif(btrim(order_id),'') is null) uncertain_sequence_count,
   count(*) filter(where amount is null and currency=$17) missing_amount_count,
   count(*) filter(where success_time_missing) missing_success_time_count,
   array_agg(member_id) filter(where created_at is null or success_time_missing) blocked_ids
  from source_rows group by local_day
 ), blocked_members as materialized (
  select distinct unnest(blocked_ids) member_id from source_day_coverage
 ), candidate_counts as materialized (
  -- Eliminate paid member-days before grouping. Most ordinary traffic never
  -- enters a wide materialized cohort or a DISTINCT-order/provider aggregate.
  select s.local_day as day,s.member_id,count(*) submitted_count,
   count(*) filter(where not status_known) unknown_status_count
  from source_rows s where s.created_at is not null and s.member_id is not null
   and not exists(select 1 from successes p where p.member_id=s.member_id and p.day=s.local_day)
   and not exists(select 1 from uncertain_days u where u.day=s.local_day)
   and not exists(select 1 from blocked_members b where b.member_id=s.member_id)
   and not exists(select 1 from blocked_members b where b.member_id is null)
  group by s.local_day,s.member_id having count(*)>=10
 ), candidate_orders as materialized (
  select s.*,s.local_day as day
  from source_rows s join candidate_counts c on c.member_id=s.member_id and c.day=s.local_day
 ), canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
  from (select distinct raw_provider from candidate_orders) names
 ), member_days as materialized (
  select s.day,s.member_id,count(*) submitted_count,
   count(*) filter(where not status_known) unknown_status_count,
   count(*) filter(where nullif(btrim(order_id),'') is null)=0 and count(distinct order_id)=count(*) sequence_known,
   case when count(*) filter(where amount is null or currency is distinct from $17)>0 then null else coalesce(sum(amount),0) end platform_submitted_amount,
   count(*) filter(where currency=$17 and ($8::text[] is null or c.provider=any($8))) selected_count,
   case when count(*) filter(where currency=$17 and ($8::text[] is null or c.provider=any($8)) and amount is null)>0 then null
    else coalesce(sum(amount) filter(where currency=$17 and ($8::text[] is null or c.provider=any($8))),0) end selected_amount,
   array_agg(distinct c.provider order by c.provider) filter(where currency=$17 and ($8::text[] is null or c.provider=any($8))) providers
  from candidate_orders s join canonical c using(raw_provider) group by s.day,s.member_id
 ), eligible as materialized (
  select m.* from member_days m where m.unknown_status_count=0 and m.sequence_known
 ), coverage as (
  -- Coverage describes the all-provider qualification scope. A compact daily
  -- aggregate avoids sorting/mapping every raw order in the coverage pass.
  select coalesce(sum(order_count) filter(where day is not null),0) order_count,
   coalesce(sum(missing_member_count),0)+(select coalesce(sum(success_count),0) from successes where member_id is null) missing_member_count,
   coalesce(sum(unknown_status_count),0) unknown_status_count,
   coalesce(sum(uncertain_sequence_count),0)+(select coalesce(sum(submitted_count),0) from member_days where not sequence_known) uncertain_sequence_count,
   coalesce(sum(missing_amount_count),0) missing_amount_count,coalesce(sum(missing_success_time_count),0) missing_success_time_count,
   count(day) covered_day_count from source_day_coverage

 ) select jsonb_build_object(
  'rows',(select coalesce(jsonb_agg(to_jsonb(e) order by member_id),'[]'::jsonb) from eligible e),
  'blockedMembers',(select coalesce(jsonb_agg(member_id),'[]'::jsonb) from blocked_members),
  'coverage',(select to_jsonb(c) from coverage c))
 $q$;
 execute v_sql into v_result using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,v_from,v_to,v_platform.country,
  v_providers,null::int,null::text,null::int,null::int,null::text,null::text,v_start,v_end,v_currency,v_confirmations;
 return v_result||jsonb_build_object('day',p_day,'capturedAt',statement_timestamp());
end;$$;
revoke all on function private.dashboard_submission_streak_capture_day(jsonb,date,text[],text) from public,anon,authenticated,service_role;

create function private.dashboard_submission_streak_result(p_job uuid,p_operation text,p_streak integer,p_member text,p_limit integer,p_offset integer)
returns jsonb language sql stable security invoker set search_path='' set jit='off' set work_mem='64MB' as $$
 with job as materialized (select * from private.dashboard_submission_streak_jobs where id=p_job),
 captured as materialized (select * from private.dashboard_submission_streak_days where job_id=p_job),
 blocked as materialized (select distinct b.value#>>'{}' member_id from captured c cross join lateral jsonb_array_elements(c.result->'blockedMembers')b(value)),
 eligible as materialized (
  select r.* from captured c cross join lateral jsonb_to_recordset(c.result->'rows') as r(
   day date,member_id text,submitted_count bigint,platform_submitted_amount numeric,selected_count bigint,selected_amount numeric,providers text[])
  where not exists(select 1 from blocked b where b.member_id=r.member_id) and not exists(select 1 from blocked b where b.member_id is null)
 ), numbered as (
  select e.*,e.day-(row_number() over(partition by e.member_id order by e.day))::int island from eligible e
 ), runs as materialized (
  select member_id,island,count(*)::int run_days,min(day) start_day,max(day) end_day
  from numbered group by member_id,island
 ), qualified_days as materialized (
  select n.*,r.run_days,r.start_day,r.end_day from numbered n join runs r using(member_id,island)
 ), member_runs as (
  select member_id,max(run_days) max_streak_days from runs group by member_id
 ), coverage as (
  select coalesce(sum((result->'coverage'->>'order_count')::bigint),0) order_count,
   coalesce(sum((result->'coverage'->>'missing_member_count')::bigint),0) missing_member_count,
   coalesce(sum((result->'coverage'->>'unknown_status_count')::bigint),0) unknown_status_count,
   coalesce(sum((result->'coverage'->>'uncertain_sequence_count')::bigint),0) uncertain_sequence_count,
   coalesce(sum((result->'coverage'->>'missing_amount_count')::bigint),0) missing_amount_count,
   coalesce(sum((result->'coverage'->>'missing_success_time_count')::bigint),0) missing_success_time_count,
   count(*) filter(where (result->'coverage'->>'order_count')::bigint>0) covered_day_count from captured
 ), complete as (
  select *,missing_member_count=0 and unknown_status_count=0 and uncertain_sequence_count=0 and missing_success_time_count=0 calculation_complete from coverage
 ), selected_members as materialized (
  select distinct t.days,q.member_id from (values(3),(5),(10))t(days) join qualified_days q on q.run_days>=t.days and q.selected_count>0
 ), metric_values as (
  select t.days,count(distinct q.member_id) member_count,count(q.member_id) member_days,coalesce(sum(q.selected_count),0) submitted_count,
   case when count(*) filter(where q.member_id is not null and q.selected_amount is null)>0 then null else coalesce(sum(q.selected_amount),0)::text end submitted_amount
  from (values(3),(5),(10))t(days) left join qualified_days q on q.run_days>=t.days
   and exists(select 1 from selected_members sm where sm.days=t.days and sm.member_id=q.member_id) group by t.days
 ), details as (
  select q.member_id,max(m.max_streak_days) max_streak_days,min(q.start_day) start_day,max(q.end_day) end_day,
   count(*) qualifying_days,sum(q.selected_count) submitted_count,
   case when count(*) filter(where q.selected_amount is null)>0 then null else coalesce(sum(q.selected_amount),0)::text end submitted_amount
  from qualified_days q join member_runs m using(member_id)
  where p_operation='members' and q.run_days>=p_streak and (p_member::text is null or q.member_id=p_member)
  group by q.member_id having sum(q.selected_count)>0
 ), detail_page as materialized (
  select * from details order by max_streak_days desc,submitted_count desc,member_id limit p_limit offset p_offset
 ), detail_rows as (
  select d.*,array(select distinct p from qualified_days q cross join lateral unnest(q.providers)p
    where q.member_id=d.member_id and q.run_days>=p_streak order by p) providers,
   (select jsonb_agg(jsonb_build_object('day',q.day,'submitted_count',q.selected_count,'platform_submitted_count',q.submitted_count,
     'submitted_amount',q.selected_amount::text,'platform_submitted_amount',q.platform_submitted_amount::text,'success_count',0,'providers',coalesce(to_jsonb(q.providers),'[]'::jsonb),
     'qualifies',true,'run_days',q.run_days) order by q.day)
    from qualified_days q where q.member_id=d.member_id and q.run_days>=p_streak) days
  from detail_page d
 )
 select jsonb_build_object(
  'streaks',(select jsonb_agg(jsonb_build_object('days',m.days,
   'member_count',case when c.calculation_complete then m.member_count end,
   'member_days',case when c.calculation_complete then m.member_days end,
   'submitted_count',case when c.calculation_complete then m.submitted_count end,
   'submitted_amount',case when c.calculation_complete then m.submitted_amount end,
   'observed_member_count',m.member_count,'observed_member_days',m.member_days,
   'observed_submitted_count',m.submitted_count,'observed_submitted_amount',m.submitted_amount) order by m.days) from metric_values m cross join complete c),
  'coverage',(select jsonb_build_object('orderCount',order_count,'missingMemberCount',missing_member_count,
   'unknownStatusCount',unknown_status_count,'orderSequenceUncertainCount',uncertain_sequence_count,
   'missingAmountCount',missing_amount_count,'missingSuccessTimeCount',missing_success_time_count,
   'coveredDayCount',covered_day_count,'noRecordDayCount',j.lookback_days-covered_day_count,'calculationComplete',calculation_complete,'sourceCompletenessVerified',false) from complete cross join job j),
  'total',case when p_operation='members' then (select count(*) from details) end,
  'rows',case when p_operation='members' then (select coalesce(jsonb_agg(to_jsonb(d) order by max_streak_days desc,submitted_count desc,member_id),'[]'::jsonb) from detail_rows d) end)
$$;
revoke all on function private.dashboard_submission_streak_result(uuid,text,integer,text,integer,integer) from public,anon,authenticated,service_role;

create function private.dashboard_admin_live_submission_streak(p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set jit='off' set work_mem='64MB' as $$
declare
 v_uid uuid:=auth.uid();v_op text:=p_request->>'operation';v_key text;v_id uuid;v_nonce uuid;v_platform record;
 v_job private.dashboard_submission_streak_jobs%rowtype;v_start timestamptz;v_end timestamptz;v_today date;v_last date;v_day date;
 v_capture_bytes integer;v_lookback int:=30;v_excluded int:=0;v_processed int;v_streak int:=3;v_offset int:=0;v_limit int:=20;v_member text;
 v_currency text;v_providers text[];v_result jsonb;v_capture jsonb;v_metadata jsonb;v_progress jsonb;
begin
 perform private.dashboard_admin_live_scope();
 if v_uid is null then raise exception using errcode='42501',message='authentication_required';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or v_op is null or v_op not in ('start','step','summary','members')
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>'operation' and not(
   v_op='start' and k=any(array['platformId','startAt','endAt','direction','providers','currency','lookbackDays','clientRequestId'])
   or v_op in ('step','summary','members') and k='jobId'
   or v_op='members' and k=any(array['streakDays','memberId','offset','limit']))) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if v_op='start' then
  foreach v_key in array array['platformId','startAt','endAt','direction','currency','clientRequestId'] loop
   if p_request ? v_key and p_request->v_key<>'null'::jsonb and (jsonb_typeof(p_request->v_key)<>'string'
    or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
    raise exception using errcode='22023',message='invalid_filter';end if;
  end loop;
  begin
   v_id:=(p_request->>'platformId')::uuid;v_nonce:=(p_request->>'clientRequestId')::uuid;
   if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
    or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception using errcode='22023',message='invalid_time';end if;
   v_start:=(p_request->>'startAt')::timestamptz;v_end:=(p_request->>'endAt')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   raise exception using errcode='22023',message='invalid_filter';end;
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied';end if;
  if v_platform.source not in ('ar','newar','lg','game66') then raise exception using errcode='22023',message='submission_source_unavailable';end if;
  if v_nonce is null or v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
   or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days' then
   raise exception using errcode='22023',message='invalid_range';end if;
  if coalesce(p_request->>'direction','charge')<>'charge' then raise exception using errcode='22023',message='invalid_direction';end if;
  if p_request ? 'lookbackDays' then
   if jsonb_typeof(p_request->'lookbackDays')<>'number' or p_request->>'lookbackDays' not in ('7','15','30') then
    raise exception using errcode='22023',message='invalid_lookback';end if;v_lookback:=(p_request->>'lookbackDays')::int;end if;
  if p_request ? 'providers' and p_request->'providers'<>'null'::jsonb then
   if jsonb_typeof(p_request->'providers')<>'array' or jsonb_array_length(p_request->'providers')>200
    or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string'
     or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
    raise exception using errcode='22023',message='invalid_filter';end if;end if;
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
  v_today:=(statement_timestamp() at time zone v_platform.timezone)::date;
  v_last:=least((v_end at time zone v_platform.timezone)::date,v_today);
  if (v_end at time zone v_platform.timezone)::time<>time '00:00' or (v_end at time zone v_platform.timezone)::date>v_today then v_excluded:=1;end if;
  v_metadata:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'country',v_platform.country,
   'scope_group',v_platform.scope_group,'source_name',v_platform.source_name,'currency',v_platform.currency,'timezone',v_platform.timezone);
  -- Only expired derived job data is removed; collected orders are never written.
  delete from private.dashboard_submission_streak_jobs where id in (
   select id from private.dashboard_submission_streak_jobs where expires_at<=statement_timestamp() order by expires_at limit 64 for update skip locked);
  select * into v_job from private.dashboard_submission_streak_jobs where actor_id=v_uid and client_request_id=v_nonce;
  if found then
   if v_job.request is distinct from p_request-'operation' then raise exception using errcode='22023',message='analysis_nonce_conflict';end if;
  else
   if (select count(*) from private.dashboard_submission_streak_jobs where actor_id=v_uid and expires_at>statement_timestamp())>=64 then
    raise exception using errcode='54000',message='analysis_job_limit';end if;
   insert into private.dashboard_submission_streak_jobs(actor_id,client_request_id,platform_id,request,platform,first_day,end_day,lookback_days,excluded_partial_day_count,expires_at)
    values(v_uid,v_nonce,v_id,p_request-'operation',v_metadata,v_last-v_lookback,v_last,v_lookback,v_excluded,statement_timestamp()+interval '1 hour')
    on conflict(actor_id,client_request_id) do nothing returning * into v_job;
   if not found then select * into v_job from private.dashboard_submission_streak_jobs where actor_id=v_uid and client_request_id=v_nonce;
    if v_job.request is distinct from p_request-'operation' then raise exception using errcode='22023',message='analysis_nonce_conflict';end if;end if;
  end if;
 else
  begin
   if jsonb_typeof(p_request->'jobId') is distinct from 'string' then raise exception using errcode='22023',message='invalid_job';end if;
   v_id:=(p_request->>'jobId')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_job';end;
  begin
   select * into v_job from private.dashboard_submission_streak_jobs where id=v_id and actor_id=v_uid for update nowait;
  exception when lock_not_available then raise exception using errcode='55000',message='analysis_busy';end;
  if not found then raise exception using errcode='42501',message='analysis_job_denied';end if;
  if v_job.expires_at<=statement_timestamp() then raise exception using errcode='22023',message='analysis_job_expired';end if;
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_job.platform_id;
  if not found or v_job.platform->>'source' is distinct from v_platform.source
   or v_job.platform->>'scope_group' is distinct from v_platform.scope_group or v_job.platform->>'source_name' is distinct from v_platform.source_name
   or v_job.platform->>'country' is distinct from v_platform.country
   or v_job.platform->>'timezone' is distinct from v_platform.timezone or v_job.platform->>'currency' is distinct from v_platform.currency then
   raise exception using errcode='42501',message='platform_denied';end if;
 end if;
 if v_op='members' then
  if jsonb_typeof(p_request->'streakDays') is distinct from 'number' or p_request->>'streakDays' not in ('3','5','10') then
   raise exception using errcode='22023',message='invalid_streak';end if;v_streak:=(p_request->>'streakDays')::int;
  if p_request ? 'offset' then
   if jsonb_typeof(p_request->'offset')<>'number' or p_request->>'offset' !~ '^[0-9]{1,7}$' then
    raise exception using errcode='22023',message='invalid_offset';end if;v_offset:=(p_request->>'offset')::int;end if;
  if p_request ? 'limit' then
   if jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' not in ('20','50','100') then
    raise exception using errcode='22023',message='invalid_limit';end if;v_limit:=(p_request->>'limit')::int;end if;
  if p_request ? 'memberId' and p_request->'memberId'<>'null'::jsonb and (jsonb_typeof(p_request->'memberId')<>'string'
   or length(p_request->>'memberId')>200 or p_request->>'memberId' ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_member';end if;v_member:=nullif(btrim(p_request->>'memberId'),'');
 end if;
 if v_op='step' then
  select v_job.first_day+i into v_day from generate_series(0,v_job.lookback_days-1)i
   where not exists(select 1 from private.dashboard_submission_streak_days d where d.job_id=v_job.id and d.day=v_job.first_day+i)
   order by i limit 1;
  if found then
   select array_agg(value) into v_providers from jsonb_array_elements_text(coalesce(nullif(v_job.request->'providers','null'::jsonb),'[]'::jsonb));
   v_capture:=private.dashboard_submission_streak_capture_day(v_job.platform,v_day,v_providers,coalesce(nullif(btrim(v_job.request->>'currency'),''),v_job.platform->>'currency'));
   v_capture_bytes:=octet_length(v_capture::text);
   if v_capture_bytes>4194304 or v_capture_bytes+(select coalesce(sum(result_bytes),0) from private.dashboard_submission_streak_days where job_id=v_job.id)>16777216 then
    raise exception using errcode='54000',message='analysis_day_limit';end if;
   insert into private.dashboard_submission_streak_days(job_id,day,result,result_bytes) values(v_job.id,v_day,v_capture,v_capture_bytes);
  end if;
 end if;
 select count(*) into v_processed from private.dashboard_submission_streak_days where job_id=v_job.id;
 v_progress:=jsonb_build_object('version',1,'jobId',v_job.id,'status',case when v_processed=v_job.lookback_days then 'complete' else 'pending' end,
  'processedDays',v_processed,'totalDays',v_job.lookback_days,'expiresAt',v_job.expires_at,
  'platformId',v_job.platform_id,'lookbackDays',v_job.lookback_days,'clientRequestId',v_job.client_request_id,
  'startAt',v_job.request->>'startAt','endAt',v_job.request->>'endAt');
 if v_op in ('start','step') then return v_progress;end if;
 if v_processed<>v_job.lookback_days then raise exception using errcode='55000',message='analysis_not_ready';end if;
 v_result:=private.dashboard_submission_streak_result(v_job.id,v_op,v_streak,v_member,v_limit,v_offset);
 return v_result||v_progress||jsonb_build_object('threshold',10,'thresholdComparison','gte','asOf',statement_timestamp(),
  'streakDays',case when v_op='members' then v_streak end,'offset',case when v_op='members' then v_offset end,'limit',case when v_op='members' then v_limit end,
  'startAt',v_job.request->>'startAt','endAt',v_job.request->>'endAt','lookbackDays',v_job.lookback_days,
  'dayStart',v_job.first_day::timestamp at time zone (v_job.platform->>'timezone'),'dayEnd',v_job.end_day::timestamp at time zone (v_job.platform->>'timezone'),
  'evaluatedStartDate',v_job.first_day,'evaluatedEndDate',v_job.end_day-1,
  'coverage',(v_result->'coverage')||jsonb_build_object('completeDayCount',v_job.lookback_days,'excludedPartialDayCount',v_job.excluded_partial_day_count),
  'captureStartedAt',v_job.created_at,'captureCompletedAt',(select max(captured_at) from private.dashboard_submission_streak_days where job_id=v_job.id),
  'snapshotAtomic',false,'platform',v_job.platform-'scope_group'-'source_name',
  'basis','platform_local_complete_days_all_providers_zero_success_consecutive','operation',case when v_op='members' then 'streakMembers' else 'streaks' end);
end;$$;
create function public.dashboard_admin_live_submission_streak(p_request jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.dashboard_admin_live_submission_streak(p_request)$$;
revoke all on function private.dashboard_admin_live_submission_streak(jsonb),public.dashboard_admin_live_submission_streak(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_admin_live_submission_streak(jsonb),public.dashboard_admin_live_submission_streak(jsonb) to authenticated;

-- Add only the events action; do not grant any new role permission implicitly.
do $catalog$
declare p record;c jsonb;before_metadata jsonb;after_metadata jsonb;definition text;new_source text;
begin
 select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('private.dashboard_role_catalog()');
 if not found or md5(p.prosrc)<>'eee3100170bb146782d4fb34e77d680a' or p.prosecdef or p.provolatile<>'i'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text[] is distinct from array['postgres=X/postgres']::text[] then
  raise exception 'submission_streak_catalog_baseline_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';c:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(c->'pages')x where x->>'id'='events' and x->'requests' ? 'submissionAnalysis')<>1 then
  raise exception 'submission_streak_catalog_events_missing';end if;
 c:=jsonb_set(c,'{pages}',(select jsonb_agg(case when x->>'id'='events' then jsonb_set(x,'{requests}',(x->'requests')||'"submissionStreak"'::jsonb) else x end order by ord)
  from jsonb_array_elements(c->'pages') with ordinality a(x,ord)));
 new_source:=E'\nselect '||quote_literal(c::text)||E'::jsonb\n';definition:=pg_catalog.pg_get_functiondef(p.oid);
 execute replace(definition,p.prosrc,new_source);
 select to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata then raise exception 'submission_streak_catalog_metadata_drift';end if;
end;$catalog$;

do $gateway$
declare p record;definition text;before_metadata jsonb;after_metadata jsonb;
 v_detail text:=$old$action='submissionAnalysis' and v_operation='members'$old$;
 v_anchor text:=$old$ rpc:=case action$old$;
 v_rpc text:=$old$  when 'submissionAnalysis' then 'dashboard_admin_live_submission_analysis'$old$;
begin
 select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.dashboard_admin_execute(text,jsonb)');
 if not found or pg_catalog.md5(p.prosrc)<>'919efd6ed96be29dec14b59545c9bc07' or not p.prosecdef
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text[] is distinct from array['postgres=X/postgres','authenticated=X/postgres']::text[]
  or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' then
  raise exception 'submission_streak_gateway_baseline_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';definition:=pg_catalog.pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,v_detail,'')))/length(v_detail)<>1
  or (length(definition)-length(replace(definition,v_anchor,'')))/length(v_anchor)<>1
  or (length(definition)-length(replace(definition,v_rpc,'')))/length(v_rpc)<>1 then
  raise exception 'submission_streak_gateway_anchor_drift';end if;
 definition:=replace(definition,v_detail,$new$action in ('submissionAnalysis','submissionStreak') and v_operation='members'$new$);
 definition:=replace(definition,v_anchor,$new$ if action='submissionStreak' and p_page<>'events' then
  raise exception using errcode='42501',message='page_action_denied';end if;
 rpc:=case action$new$);
 definition:=replace(definition,v_rpc,v_rpc||E'\n'||$new$  when 'submissionStreak' then 'dashboard_admin_live_submission_streak'$new$);
 execute definition;
 select to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata then raise exception 'submission_streak_gateway_metadata_drift';end if;
end;$gateway$;
notify pgrst,'reload schema';
commit;
