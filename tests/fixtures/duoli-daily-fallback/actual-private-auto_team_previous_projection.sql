CREATE OR REPLACE FUNCTION private.auto_team_previous_projection(q jsonb, b jsonb, v jsonb, authorized_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_start date;v_end date;v_before date;v_days integer:=1;v_daily boolean:=false;
 v_wg_days jsonb:=b->'wg';v_yash_days jsonb:=b->'yash';v_newar_days jsonb:=b->'newar';v_ar_days jsonb:=b->'ar';v_duoli_days jsonb:=b->'duoli';v_ar_history_durations jsonb:=b->'arHistory';v_game jsonb;
 rows jsonb;control jsonb;candidate jsonb;evidence jsonb;k text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='auto_team_transport_denied'; END IF;
 -- Eligibility is optional transport only. Original reader already authorized
 -- this exact immutable bundle and returned its unmodified financial DTO.
 IF q->>'country' IS DISTINCT FROM '印度' OR coalesce(q->>'view','auto')<>'auto' OR coalesce((q->>'daily')::boolean,false)
 OR coalesce((q->>'offset')::integer,0)<>0 OR coalesce((q->>'limit')::integer,20)<>500
 OR jsonb_typeof(q->'scopeTargets') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'scopeTargets')<>3
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q->'scopeTargets')t WHERE t->>'country' NOT IN('印度','香港','红膏蟹'))
 OR q->'platforms' IS DISTINCT FROM '[]'::jsonb OR b->'request' IS DISTINCT FROM authorized_request
 OR b#>>'{scope,mode}' IS DISTINCT FROM 'all' OR v->>'view' IS DISTINCT FROM 'auto' OR v->>'version' IS DISTINCT FROM '2'
 OR jsonb_typeof(v->'rows') IS DISTINCT FROM 'array' OR (v->>'total')::integer>500
 OR jsonb_typeof(v->'previousTotals') IS DISTINCT FROM 'object'
 OR q->>'startAt' IS DISTINCT FROM left(q->>'startAt',10)||'T00:00:00.000Z'
 OR q->>'endAt' IS DISTINCT FROM left(q->>'startAt',10)||'T23:59:59.000Z'
 OR left(q->>'startAt',10)::date<date '2026-10-11'
 OR jsonb_array_length(v_wg_days)<>0 OR jsonb_array_length(v_duoli_days)<>0 OR jsonb_array_length(v_ar_history_durations)<>0
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure AND md5(prosrc)='e00e877d3b41ff84de16603986a95e8b')
 THEN RETURN v; END IF;
 v_start:=left(q->>'startAt',10)::date;v_end:=v_start;v_before:=v_start-1;
 SELECT jsonb_build_object('rows',coalesce(jsonb_agg(r),'[]')) INTO v_game
 FROM jsonb_each(b->'game66')g CROSS JOIN LATERAL jsonb_array_elements(g.value->'rows')r;
 WITH prior_daily_source(data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,duration_sample_count,duration_total_seconds,duration_basis) as (
  select (r->>'data_date')::date,r->>'country',r->>'platform',private.dashboard_admin_live_withdraw_key(r->>'platform'),
   (r->>'total')::bigint,(r->>'success')::bigint,(r->>'rejected')::bigint,(r->>'auto_count')::bigint,(r->>'manual_count')::bigint,
   (r->>'avg_seconds')::numeric,(r->>'source_updated_at')::timestamptz,(r->>'updated_at')::timestamptz,
   case when r->>'avg_seconds' is not null and (r->>'total')::bigint>0 then (r->>'total')::bigint else 0 end,
   case when (r->>'total')::bigint>0 then (r->>'avg_seconds')::numeric*(r->>'total')::bigint end,'source_reported_processing'::text
  from jsonb_array_elements(coalesce(v_game->'rows','[]'::jsonb))r
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

 ), daily as materialized (select * from daily_source), daily_group as (
  select country,platform_key,max(platform) platform,case when v_daily then data_date else v_start end as group_date,
   (data_date>=v_start) current_period,sum(total)::bigint total,sum(success)::bigint success,sum(rejected)::bigint rejected,
   sum(auto_count)::bigint auto_count,sum(manual_count)::bigint manual_count,
   sum(duration_total_seconds)/nullif(sum(duration_sample_count),0) avg_seconds,
   sum(duration_sample_count)::bigint duration_sample_count,sum(duration_total_seconds) duration_total_seconds,
   case when count(distinct duration_basis) filter(where duration_sample_count>0)>1 then 'mixed_source_processing' else min(duration_basis) filter(where duration_sample_count>0) end duration_basis,
   max(source_updated_at) source_updated_at,count(distinct data_date) covered_days
  from daily group by 1,2,4,5

 ), previous_rows as (select
   jsonb_build_object('dataDate',v_before,'country',d.country,'platform',d.platform,'total',d.total,'success',d.success,'rejected',d.rejected,
   'autoCount',d.auto_count,'manualCount',d.manual_count,'unclassifiedCount',greatest(d.total-d.auto_count-d.manual_count,0),
   'avgSeconds',d.avg_seconds,'durationSampleCount',d.duration_sample_count,
   'durationTotalSeconds',d.duration_total_seconds::text,'durationBasis',d.duration_basis,'sourceUpdatedAt',d.source_updated_at,'coveredDays',d.covered_days) item
 from daily_group d where not d.current_period)
 SELECT coalesce(jsonb_agg(item ORDER BY item->>'country',item->>'platform'),'[]') INTO rows FROM previous_rows;
 IF jsonb_array_length(rows)=0 OR jsonb_array_length(rows)>500 THEN RETURN v; END IF;
 -- Exact independent baseline proof. Any legacy report/duration contribution
 -- absent from this bundle makes optional transport unavailable, never zero.
 SELECT jsonb_build_object('total',sum((r->>'total')::numeric),'success',sum((r->>'success')::numeric),
 'rejected',sum((r->>'rejected')::numeric),'autoCount',sum((r->>'autoCount')::numeric),'manualCount',sum((r->>'manualCount')::numeric),
 'unclassifiedCount',sum((r->>'unclassifiedCount')::numeric),'durationSampleCount',sum((r->>'durationSampleCount')::numeric),
 'durationTotalSeconds',sum((r->>'durationTotalSeconds')::numeric),
 'avgSeconds',sum((r->>'durationTotalSeconds')::numeric)/nullif(sum((r->>'durationSampleCount')::numeric),0),
 'durationBasis',case when count(distinct r->>'durationBasis')filter(where (r->>'durationSampleCount')::numeric>0)>1 then 'mixed_source_processing'else min(r->>'durationBasis')filter(where (r->>'durationSampleCount')::numeric>0)end,
 'platforms',count(distinct (r->>'country',private.dashboard_admin_live_withdraw_key(r->>'platform'))),'coveredDays',1)INTO control
 FROM jsonb_array_elements(rows)r;
 FOREACH k IN ARRAY ARRAY['total','success','rejected','autoCount','manualCount','unclassifiedCount','durationSampleCount','durationTotalSeconds','avgSeconds','platforms','coveredDays']LOOP
  IF (control->>k)::numeric IS DISTINCT FROM (v->'previousTotals'->>k)::numeric THEN RETURN v; END IF;
 END LOOP;
 IF control->'durationBasis' IS DISTINCT FROM v#>'{previousTotals,durationBasis}'THEN RETURN v; END IF;
 SELECT jsonb_build_object('contract','auto-team-duration-v1','direction','withdraw',
 'window',jsonb_build_array(q->>'startAt',q->>'endAt',v_before),
 'current',jsonb_build_object('rows',jsonb_agg(jsonb_build_object('index',x.ordinality-1,'country',x.value->'country','platform',x.value->'platform','value',x.value->>'durationTotalSeconds')ORDER BY x.ordinality),
 'total',v#>>'{totals,durationTotalSeconds}'),'previous',jsonb_build_object('total',v#>>'{previousTotals,durationTotalSeconds}'))INTO evidence
 FROM jsonb_array_elements(v->'rows')WITH ORDINALITY x;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(evidence#>'{current,rows}')x WHERE x->>'value'IS NOT NULL AND(length(x->>'value')>512 OR x->>'value'!~'^(0|[1-9][0-9]*)([.][0-9]+)?$'))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY[evidence#>>'{current,total}',evidence#>>'{previous,total}'])x WHERE x IS NOT NULL AND(length(x)>512 OR x!~'^(0|[1-9][0-9]*)([.][0-9]+)?$'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows)x WHERE x->>'durationTotalSeconds'IS NOT NULL AND(length(x->>'durationTotalSeconds')>512 OR x->>'durationTotalSeconds'!~'^(0|[1-9][0-9]*)([.][0-9]+)?$'))THEN RETURN v; END IF;
 candidate:=v||jsonb_build_object('previousRows',rows,'previousRowsContract','auto-team-previous-v1','teamDurationExact',evidence);
 IF octet_length(candidate::text)>4194304 THEN RETURN v; END IF;
 RETURN candidate;
EXCEPTION WHEN data_exception THEN RETURN v;
END;$function$
