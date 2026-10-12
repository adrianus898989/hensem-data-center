-- MAANWIN charge summary charts: only proved typed inputs. All original
-- authentication, fresh catalog and 91/OKWIN kernels remain byte-identical.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path='';
do $install$
declare current_body text;definition text;original_metadata jsonb;
begin
 if current_user<>'postgres'then raise exception'maan_reader_install_owner_only';end if;
 lock table public.newar_detail_records in access share mode nowait;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_fact','sync_maan_submission_fact','invalidate_maan_submission_ready','guard_maan_submission_control_write','maan_submission_generation','backfill_maan_submission_window','check_maan_submission_window','maintain_maan_submission_window']))::text))is distinct from '462bf7f52237cb34446203e56c14d58e'or (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['begin_maan_submission_day','verify_maan_submission_hour','approve_maan_submission_day','approve_maan_submission_future','maan_submission_can_read']))::text))is distinct from '6501ed5e8575d0b74f9f8fde047fc4a8'or private.maan_submission_generation()is null then raise exception'maan_reader_prerequisite_drift';end if;
 if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['dashboard_admin_live_submission_analysis']))::text))is distinct from '35d256a0ebef927e80079083283a044c'then raise exception'maan_reader_metadata_drift';end if;
 select prosrc,to_jsonb(p)-'prosrc'into current_body,original_metadata from pg_proc p where p.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure;
 if md5(current_body)='cd7a262ccf7398acd43d5c18d43e627a'then return;end if;
 if md5(current_body)<>'f8fbf153322b08eb42daa2c8a09d77d8'then raise exception'maan_reader_definition_drift';end if;
 definition:=pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,$anchor$ execute v_sql into v_result using $anchor$,'')))/length($anchor$ execute v_sql into v_result using $anchor$)<>1 then raise exception'maan_reader_anchor_drift';end if;
 definition:=replace(definition,$anchor$ execute v_sql into v_result using $anchor$,$replacement$ -- Exact MAAN charge charts only. Original auth/catalog/filter validation has
 -- already completed; unproved days, schema/maintenance drift or other zones
 -- keep the ordinary native path. No cache or upstream completeness is implied.
 if v_operation='summary'and v_charts and v_platform.source='newar'
 and v_platform.scope_group='IN'and v_platform.source_name='MAANWIN'
 and v_platform.timezone in('Asia/Kolkata','Asia/Calcutta')
 and (v_from at time zone v_platform.timezone)::date>=date'2026-10-10'
 and to_regclass('private.maan_submission_facts')is not null
 and to_regclass('private.maan_submission_epoch')is not null
 and to_regclass('private.maan_submission_ready')is not null
 and to_regclass('private.maan_submission_future_ready')is not null then
  perform 1 from public.newar_detail_records limit 0;
  perform 1 from private.maan_submission_facts limit 0;
  perform 1 from private.maan_submission_epoch limit 0;
  perform 1 from private.maan_submission_ready limit 0;
  perform 1 from private.maan_submission_future_ready limit 0;
  if (select md5((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'returnsSet',p.proretset,'kind',p.prokind,'defaults',p.pronargdefaults,'variadic',p.provariadic,'config',p.proconfig,'acl',p.proacl::text)order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname=any(array['maan_submission_generation','maan_submission_can_read']))::text))is not distinct from '8df2fa80e7e883e25106e7b77eb51bd9'then
   if private.maan_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
    v_sql:=$maan_query$with source_rows as not materialized (select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at>=$5 and f.created_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)
 union all select f.order_id,f.member_id,f.created_at,f.amount,f.currency,f.raw_provider,f.paid,f.status_known,
 f.member_level member_level_native,f.recharge_count recharge_count_native
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.created_at is null
 and(t.launch_at is null or f.created_at>=t.launch_at or f.created_at is null)),successes as materialized (select f.member_id,(f.success_at at time zone $4)::date as day
 from private.maan_submission_facts f join public.newar_detail_platforms t on t.platform=f.platform
 where f.platform=$3 and f.dataset='charge'and f.paid and f.success_at>=$5 and f.success_at<$6
 and(t.launch_at is null or f.created_at>=t.launch_at)),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then s.member_level_native end member_level,
   case when s.created_at is not null then s.recharge_count_native end recharge_count
  from source_rows s
 ),canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider)provider
  from(select distinct raw_provider from typed_orders)names
 ),unplaced_members as materialized (
  select distinct member_id from typed_orders where created_at is null and member_id is not null
 ),orders as not materialized (
  select o.*,c.provider,coalesce(($8::text[]is null or c.provider=any($8))and o.created_at>=$15 and o.created_at<$16 and o.currency=$17,false)selected
  from typed_orders o join canonical c using(raw_provider)where created_at is not null
 ),member_days as materialized (
  -- Keep whole-day/all-provider qualification and exact DISTINCT sequence.
  -- No full-cohort money SUM or detail-only first/last values in a chart read.
  select day,member_id,count(*)submitted_count,count(*)filter(where paid)cohort_success_count,
   bool_and(status_known)statuses_known,count(*)filter(where not status_known)unknown_status_count,
   count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known,
   count(*)filter(where selected)selected_count,
   case when max(recharge_count)>0 then 'funded'when count(recharge_count)=count(*)and max(recharge_count)=0 and count(member_level)=count(*)and max(member_level)=0 then 'new'else 'unknown'end member_class,
   bool_or(member_level=0)has_l0
  from orders left join unplaced_members u using(member_id)where member_id is not null group by day,member_id
 ),eligible as materialized (
  select m.*from member_days m where submitted_count>10 and cohort_success_count=0 and statuses_known and sequence_known
   and($24::jsonb is null or coalesce(($24->m.day::text->>'dataComplete')::boolean,false))
   and not exists(select 1 from successes s where s.member_id=m.member_id and s.day=m.day)
 ),selected_orders as not materialized (
  select o.day,o.member_id,o.provider,o.created_at,o.amount,o.paid,o.status_known,o.member_level,o.recharge_count
  from orders o where selected
 ),selected_coverage as (
  select count(*)order_count,count(*)filter(where member_id is null)missing_member_count,
   count(*)filter(where member_level is null)missing_level_count,count(*)filter(where recharge_count is null)missing_recharge_count,
   count(*)filter(where member_id is null and not status_known)missing_member_unknown_count
  from selected_orders
 ),qualified as not materialized (
  select o.day,o.member_id,o.provider,o.amount,m.submitted_count,m.member_class,m.has_l0
  from selected_orders o join eligible m using(day,member_id)
 ), qualified_members as materialized (
  -- Aggregate each provider/member/day once before calculating thresholds.
  select day,member_id,provider,max(submitted_count) submitted_count,max(member_class) member_class,bool_or(has_l0) has_l0,
   count(*) invalid_count,count(*) filter(where amount is null) missing_amount,coalesce(sum(amount),0) invalid_amount
  from qualified where $14='summary' group by day,member_id,provider
 ), metric_values as (
  select q.provider,t.threshold,count(distinct q.member_id) filter(where q.invalid_count>0) member_count,count(distinct(q.day,q.member_id)) filter(where q.invalid_count>0) member_days,
   count(distinct q.member_id) qualified_member_count,count(distinct(q.day,q.member_id)) qualified_member_days,
   sum(q.invalid_count) invalid_count,case when sum(q.missing_amount)>0 then null else sum(q.invalid_amount)::text end invalid_amount,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.has_l0) l0_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='new') new_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='funded') funded_members,
   count(distinct q.member_id) filter(where q.invalid_count>0 and q.member_class='unknown') unknown_members
  from qualified_members q cross join unnest($22::integer[]) t(threshold) where q.submitted_count>t.threshold
  group by grouping sets ((q.provider,t.threshold),(t.threshold))
 ), dimensions as (select null::text provider union all select distinct provider from selected_orders), metrics as (
  select d.provider,t.threshold,coalesce(m.member_count,0) member_count,coalesce(m.member_days,0) member_days,
   coalesce(m.qualified_member_count,0) qualified_member_count,coalesce(m.qualified_member_days,0) qualified_member_days,
   coalesce(m.invalid_count,0) invalid_count,case when m.threshold is null then '0' else m.invalid_amount end invalid_amount,
   coalesce(m.l0_members,0) l0_members,coalesce(m.new_members,0) new_members,coalesce(m.funded_members,0) funded_members,coalesce(m.unknown_members,0) unknown_members
  from dimensions d cross join unnest($22::integer[]) t(threshold)
  left join metric_values m on m.provider is not distinct from d.provider and m.threshold=t.threshold
 ),
 dashboard_orders as materialized (
  select o.provider,o.created_at,o.day,o.amount,o.paid,(e.member_id is not null) flagged
  from selected_orders o left join eligible e on e.day=o.day and e.member_id=o.member_id and e.submitted_count>$9 where $14='summary' and $21
 ), monitoring as (
  select provider,count(*) order_count,count(*) filter(where paid) success_count,
   case when count(*) filter(where amount is null)>0 then null else coalesce(sum(amount),0)::text end order_amount,
   count(*) filter(where flagged) invalid_count,
   case when count(*) filter(where flagged and amount is null)>0 then null else coalesce(sum(amount) filter(where flagged),0)::text end invalid_amount,
   min(created_at at time zone $4) filter(where flagged) first_at,max(created_at at time zone $4) filter(where flagged) last_at
  from dashboard_orders group by grouping sets ((),(provider))
 ), heatmap as (
  select provider,extract(hour from created_at at time zone $4)::int as hour,count(*) count
  from dashboard_orders where flagged group by provider,hour
 ), daily_chart as (
  select day,count(*) order_count,count(*) filter(where flagged) invalid_count
  from dashboard_orders group by day
 ), amount_chart as (
  select case when amount is null then 'unknown' when $19::numeric[] is null then 'unconfigured'
   when amount<$19[1] then 'below' when amount>$19[11] then 'above' when amount=$19[11] then 'band:9'
   else 'band:'||(select i-1 from generate_series(1,10)i where amount >= $19[i] and amount < $19[i+1])::text end bucket,
   count(*) count
  from dashboard_orders where flagged group by bucket
 ), frequency_chart as (
  select case when max(submitted_count)>=100 then '100+' when max(submitted_count)>=50 then '50–99'
   when max(submitted_count)>=30 then '30–49' when max(submitted_count)>=20 then '20–29' else '10–19' end band
  from qualified_members where $14='summary' and $21 group by day,member_id
 ), frequency_counts as (select band,count(*) count from frequency_chart group by band)
 select jsonb_build_object(
  'dashboard',case when $14='summary' and $21 then jsonb_build_object(
   'version',3,'threshold',$9,'exemptCount',0,'thresholdComparison','gt','amountBands',$20::jsonb,
   'monitoring',(select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first),'[]'::jsonb) from monitoring m),
   'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by provider,hour),'[]'::jsonb) from heatmap h),
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by day),'[]'::jsonb) from daily_chart d),
   'amounts',(select coalesce(jsonb_agg(to_jsonb(a) order by bucket),'[]'::jsonb) from amount_chart a),
   'frequency',(select coalesce(jsonb_agg(to_jsonb(f) order by band),'[]'::jsonb) from frequency_counts f)) end,
  'metrics',case when $14='summary' then (select coalesce(jsonb_agg(to_jsonb(m) order by provider nulls first,threshold),'[]'::jsonb) from metrics m) end,
  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,
   -- Count the actual unknown-status rows in the selected members' whole-day
   -- cohorts, including another provider/time slice. Those rows prevent a
   -- no-success conclusion; unrelated member-days must not taint this scope.
   -- Missing-member rows cannot be joined to a cohort, so retain the selected
   -- unknown rows separately without counting known affected rows as unknown.
   'unknownStatusCount',coalesce((select sum(unknown_status_count)::bigint from member_days where selected_count>0),0)
     +sc.missing_member_unknown_count,
   'orderSequenceUncertainCount',coalesce((select sum(selected_count)::bigint from member_days where not sequence_known),0),
   'sourceCompletenessVerified',false) from selected_coverage sc),
  'total',null,'members',null,'rows',null,'amountGroups',null,'memberId',null,'day',null,'offset',null,'limit',null,'hasMore',null)
$maan_query$;
   end if;
  end if;
 end if;
 execute v_sql into v_result using $replacement$);
 execute definition;
 if (select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from 'cd7a262ccf7398acd43d5c18d43e627a'or (select to_jsonb(p)-'prosrc'from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)is distinct from original_metadata then raise exception'maan_reader_after_assertion_failed';end if;
end;$install$;
commit;
