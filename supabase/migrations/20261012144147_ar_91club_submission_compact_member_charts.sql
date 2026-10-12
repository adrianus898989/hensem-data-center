-- ROOT-only atomic metadata-guarded 91-only install. No source/fact/order writes.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';
do $install$
declare p record;v_before jsonb;v_after jsonb;v_def text;v_body text;v_old text;v_new text;
 v_generation text;v_generations_after text;v_receipts jsonb;v_receipts_after jsonb;
begin
 if current_user<>'postgres'or current_setting('server_version_num')::int/10000<>17
 then raise exception 'ar91_chart_owner_version_required';end if;
 -- Metadata only. Compatible with normal source ingestion and autovacuum;
 -- prevent DDL/TRUNCATE races, with NOWAIT instead of queued maintenance.
 lock table public.ar_collected_orders,private.ar_91club_submission_facts,
  private.ar_91club_submission_epoch,private.ar_91club_submission_ready,
  private.ar_91club_submission_null_ready,private.ar_91club_submission_future_ready
  in access share mode nowait;
 select * into p from pg_catalog.pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure;
 if p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s'or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')or p.prokind<>'f'
  or p.pronargs<>1 or p.pronargdefaults<>0 or p.proargnames is distinct from array['p_request']::text[]
  or pg_get_function_arguments(p.oid)is distinct from 'p_request jsonb'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.proisstrict or p.proleakproof
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'ar91_chart_reader_metadata_changed';end if;
 if(select count(*)from pg_proc hp where hp.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
  and hp.proowner='postgres'::regrole and not hp.prosecdef and hp.provolatile='s'and hp.proparallel='u'
  and not hp.proretset and not hp.proisstrict and not hp.proleakproof and hp.pronargdefaults=0
  and hp.proconfig=array['search_path=""']::text[]and hp.proacl::text='{postgres=X/postgres}'
  and(case when hp.proname='ar_91club_submission_generation'then hp.pronargs=0 and hp.proargnames is null
   and pg_get_function_arguments(hp.oid)=''and hp.prolang=(select oid from pg_language where lanname='sql')
   and md5(hp.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and hp.prorettype='text'::regtype
  else hp.pronargs=2 and hp.proargnames=array['p_from','p_to']::text[]
   and pg_get_function_arguments(hp.oid)='p_from date, p_to date'
   and hp.prolang=(select oid from pg_language where lanname='plpgsql')
   and md5(hp.prosrc)='7252e3966d916239a3ce212ba91dc763'and hp.prorettype='boolean'::regtype end))<>2
 then raise exception 'ar91_chart_proof_metadata_changed';end if;
 v_generation:=private.ar_91club_submission_generation();
 if v_generation is null then raise exception 'ar91_chart_population_metadata_unproven';end if;
 select jsonb_build_object('epoch',(select jsonb_agg(to_jsonb(e))from private.ar_91club_submission_epoch e),
  'days',(select jsonb_agg(to_jsonb(d)order by data_date)from private.ar_91club_submission_ready d),
  'null',(select jsonb_agg(to_jsonb(n))from private.ar_91club_submission_null_ready n),
  'future',(select jsonb_agg(to_jsonb(f))from private.ar_91club_submission_future_ready f))into v_receipts;
 v_before:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='f8fbf153322b08eb42daa2c8a09d77d8'then return;
 elsif md5(p.prosrc)<>'5b026afa37c300143302323eeccb6def'then raise exception 'ar91_chart_reader_baseline_changed';end if;
 v_def:=pg_get_functiondef(p.oid);
 v_old:=$old1$ if v_platform.source='ar' then v_undated_source:=replace(v_source,'$source_time_filter$',v_undated_filter);end if;
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 v_sql:='with source_rows as not materialized ('||v_source||'), successes as materialized ('||v_success||$q$),
 canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider from (select distinct raw_provider from source_rows) names
$old1$;
 v_new:=$new1$ if v_platform.source='ar' then v_undated_source:=replace(v_source,'$source_time_filter$',v_undated_filter);end if;
 v_source:=replace(v_source,'$source_time_filter$',v_time_filter)||' union all '||replace(v_source,'$source_time_filter$',v_undated_filter);
 if v_currency is not null and v_currency<>v_platform.currency then raise exception using errcode='22023',message='invalid_currency';end if;
 if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and v_operation='summary' and v_charts
  and (v_from at time zone v_platform.timezone)::date>=date '2026-10-10' then
  -- Hold ordinary metadata read locks through the statement before checking
  -- exact source maintenance and three-set readiness. No source rows are read.
  perform 1 from public.ar_collected_orders limit 0;
  perform 1 from private.ar_91club_submission_facts limit 0;
  perform 1 from private.ar_91club_submission_epoch limit 0;
  perform 1 from private.ar_91club_submission_ready limit 0;
  perform 1 from private.ar_91club_submission_null_ready limit 0;
  perform 1 from private.ar_91club_submission_future_ready limit 0;
  if (select count(*)=2 from pg_catalog.pg_proc p where p.oid in('private.ar_91club_submission_generation()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure)
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s' and p.proparallel='u' and not p.proretset and not p.proisstrict and not p.proleakproof and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
   and(case when p.proname='ar_91club_submission_generation'then p.pronargs=0 and p.proargnames is null and pg_get_function_arguments(p.oid)=''else p.pronargs=2 and p.proargnames=array['p_from','p_to']::text[]and pg_get_function_arguments(p.oid)='p_from date, p_to date'end)
   and(case when p.proname='ar_91club_submission_generation' then p.prolang=(select oid from pg_language where lanname='sql')and md5(p.prosrc)='acd188a5da0cb2f63381bd5922e3a1cf'and p.prorettype='text'::regtype else p.prolang=(select oid from pg_language where lanname='plpgsql')and md5(p.prosrc)='7252e3966d916239a3ce212ba91dc763'and p.prorettype='boolean'::regtype end))then
   if private.ar_91club_submission_can_read((v_from at time zone v_platform.timezone)::date,(v_to at time zone v_platform.timezone)::date)then
   -- The same full-population proof also covers chart inputs. Keep the generic
   -- chart/amount/qualification SQL unchanged; only use the exact native copy.
   v_source:=replace(v_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_success:=replace(v_success,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   v_undated_source:=replace(v_undated_source,'from public.ar_collected_orders a','from private.ar_91club_submission_facts a');
   -- Current can_read fingerprints a VALIDATED CHECK fixing all four keys.
   -- Keep bind fences; do not remove any money atom or provider/date filter.
   v_source:=replace(v_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_success:=replace(v_success,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   v_undated_source:=replace(v_undated_source,$ar91_identity$where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$ar91_identity$,$ar91_fence$where $2::text='IN' and $3::text='91CLUB'$ar91_fence$);
   -- The chart needs native amounts for every selected order. Expand only
   -- this exact current rule; drift keeps the ordinary helper call unchanged.
   if exists(select 1 from pg_catalog.pg_proc m
    where m.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
    and md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
    and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_language where lanname='sql')
    and m.provolatile='i'and m.proparallel='s'and not m.prosecdef and not m.proisstrict and not m.proleakproof
    and m.proconfig is not distinct from array['search_path=""']::text[]
    and m.proacl::text is not distinct from '{postgres=X/postgres}'and m.pronargdefaults=0
    and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8
    and m.proargnames=array['p_country','p_kind','p_channel_type','p_version','p_local','p_local_currency','p_issue','p_legacy_display']::text[]
    and pg_get_function_arguments(m.oid)='p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric')then
    v_source:=replace(v_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
    v_undated_source:=replace(v_undated_source,$ar91_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount)$ar91_amount_call$,$ar91_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (a.amount)
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (a.amount)
 END$ar91_amount_case$);
   end if;
   end if;
  end if;
 end if;
 v_sql:='with source_rows as not materialized ('||v_source||'), successes as materialized ('||v_success||$q$),
 canonical as materialized (
  select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider from (select distinct raw_provider from source_rows) names
$new1$;
 if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1
 then raise exception 'ar91_chart_exact_block_changed_1';end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old2$   end if;
  end if;
 end if;
 if v_platform.source='ar' then
  v_sql:=replace(v_sql,'select distinct member_id from source_rows where created_at is null and member_id is not null',
   'select distinct member_id from ('||v_undated_source||') s where created_at is null and member_id is not null');
$old2$;
 v_new:=$new2$   end if;
  end if;
 end if;
 if v_operation='summary'and v_charts
  and v_platform.source='ar'and v_platform.scope_group='IN'and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts'in v_source)>0 then
  -- Exact proved 91CLUB chart lane; main auth, proof/money guard, source dates,
  -- independent completed-day read, status and finite threshold rules persist.
 v_sql:=$compact$with source_rows as not materialized ($compact$||v_source||$compact$),successes as materialized ($compact$||v_success||$compact$),
 typed_orders as materialized (
  -- One compact native pass. Original getters/money atoms remain intact;
  -- the summary never consumes per-order source status or raw level text.
  select s.order_id,s.member_id,s.created_at,(s.created_at at time zone $4)::date as day,
   case when s.created_at is not null then s.amount end amount,s.currency,s.raw_provider,s.paid,s.status_known,
   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count
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
$compact$;
 end if;
 if v_operation='summary' and v_charts and v_platform.source='ar'
  and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'
  and position('from private.ar_91club_submission_facts' in v_source)>0 then
  -- Validated fixed four-key population + immediate five-key PK make order_id
  -- unique. Preserve blank IDs and whole-history unplaced-member exclusion.
  -- Exact generation has already proved native int4 types. Its canonical int
  -- text has only 0..9999 / 0..999999999 accepted by the original regex.
  v_sql:=replace(v_sql,'a.member_level::text level_text','a.member_level member_level_native');
  v_sql:=replace(v_sql,'a.recharge_count::text count_text','a.recharge_count recharge_count_native');
  v_sql:=replace(v_sql,$parseold$   case when s.created_at is not null then case
    when upper(btrim(s.level_text))~'^L(V)?[0-9]{1,4}$'then regexp_replace(upper(btrim(s.level_text)),'^LV?','')::int
    when btrim(s.level_text)~'^[0-9]{1,4}$'then btrim(s.level_text)::int end end member_level,
   case when s.created_at is not null and btrim(s.count_text)~'^[0-9]{1,9}$'then btrim(s.count_text)::int end recharge_count$parseold$,$parsenew$   case when s.created_at is not null and s.member_level_native between 0 and 9999 then s.member_level_native end member_level,
   case when s.created_at is not null and s.recharge_count_native between 0 and 999999999 then s.recharge_count_native end recharge_count$parsenew$);
  v_sql:=replace(v_sql,$seqold$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and count(distinct order_id)=count(*)and bool_and(u.member_id is null)sequence_known$seqold$,$seqnew$count(*)filter(where nullif(btrim(order_id),'')is null)=0 and bool_and(u.member_id is null)sequence_known$seqnew$);
 end if;
 if v_platform.source='ar' then
  v_sql:=replace(v_sql,'select distinct member_id from source_rows where created_at is null and member_id is not null',
   'select distinct member_id from ('||v_undated_source||') s where created_at is null and member_id is not null');
$new2$;
 if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1
 then raise exception 'ar91_chart_exact_block_changed_2';end if;
 v_def:=replace(v_def,v_old,v_new);
 execute v_def;
 select to_jsonb(installed_fn)-'prosrc',installed_fn.prosrc into v_after,v_body from pg_proc installed_fn
  where installed_fn.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure;
 if md5(v_body)<>'f8fbf153322b08eb42daa2c8a09d77d8'or v_after is distinct from v_before
 then raise exception 'ar91_chart_post_hash_metadata_changed';end if;
 v_generations_after:=private.ar_91club_submission_generation();
 select jsonb_build_object('epoch',(select jsonb_agg(to_jsonb(e))from private.ar_91club_submission_epoch e),
  'days',(select jsonb_agg(to_jsonb(d)order by data_date)from private.ar_91club_submission_ready d),
  'null',(select jsonb_agg(to_jsonb(n))from private.ar_91club_submission_null_ready n),
  'future',(select jsonb_agg(to_jsonb(f))from private.ar_91club_submission_future_ready f))into v_receipts_after;
 if v_generation is distinct from v_generations_after or v_receipts is distinct from v_receipts_after
 then raise exception 'ar91_chart_proof_state_changed';end if;
end;$install$;
commit;
