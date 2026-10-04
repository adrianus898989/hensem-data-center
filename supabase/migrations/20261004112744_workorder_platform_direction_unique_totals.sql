-- Add exact platform/business original-order totals in the existing single-pass reader.
-- No data writes, source identity/state changes, new RPCs or expanded grants.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
do $install$
declare target regprocedure:='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure;
  p pg_proc%rowtype;metadata jsonb;definition text;
begin
 select * into p from pg_proc where oid=target;
 select pg_get_functiondef(target) into definition;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.prosecdef or p.proconfig is distinct from array['search_path=""'] or p.provolatile<>'s' then
  raise exception 'workorder_platform_totals_metadata_or_acl_drift';end if;
 if md5(p.prosrc)='14b1fb584d1d86332a71f9b6451816dd' then
  if md5(definition)<>'c16c906df1ddd814be59fa1c232fb68f' then raise exception 'workorder_platform_totals_target_definition_drift';end if;
  return;
 end if;
 if md5(p.prosrc)<>'a7bcb66755d22ddb9d6228cf94c91a4e' or md5(definition)<>'e0713eb8bc59b72e0ccc50de7d097b7a' then
  raise exception 'workorder_platform_totals_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_workorder_unique_totals(p_request jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb:=private.dashboard_admin_live_scope();
  v_start date:=(p_result->>'startDate')::date; v_end date:=(p_result->>'endDate')::date;
  v_metrics jsonb; v_result jsonb:=p_result;
begin
  -- WORKORDER_PENDING_DETAIL_DIAGNOSTICS_V1: describe the collection policy without changing original-order totals.
  -- WORKORDER_KNOWN_PROVIDER_ATTRIBUTION_V1: keep source coverage local to its cohort.
  -- NEW_AR deposit issues are stored separately from AR issue details. The
  -- independent order_number may fall back to a work-order number in collectors;
  -- only explicit depositOrderNo/rechargeNumber fields prove a deposit original.
  -- Existing daily cohorts remain the independent expected-count evidence.
  with cohorts as materialized (
    select r->>'countryCode' as country_code,r->>'country' as country,
      r->>'sourcePlatform' as source_platform,r->>'platformId' as platform_id,r->>'platform' as platform,
      private.dashboard_admin_live_workorder_platform_key(r->>'countryCode',r->>'sourcePlatform') as platform_key,
      r->>'provider' as provider,r->>'direction' as direction,
      r->>'source' as source,coalesce((r->>'submittedCount')::bigint,0) as expected_count
    from jsonb_array_elements(coalesce(p_result->'byPlatformProvider','[]'::jsonb)) r
  ), coverage_catalog as materialized (
    select x.*,p.id::text as resolved_id,p.country as resolved_country,p.scope_group as country_code,
      p.source,p.source_name,p.currency as resolved_currency,
      private.dashboard_admin_live_workorder_platform_key(p.scope_group,p.source_name) as platform_key
    from jsonb_array_elements(coalesce(p_result#>'{coverage,platforms}','[]'::jsonb)) cp(value)
    cross join lateral (select cp.value,cp.value->>'platform' as platform,cp.value->>'sourcePlatform' as source_platform,
      cp.value->>'platformId' as platform_id) x
    left join private.dashboard_admin_live_platforms() p on p.id::text=x.platform_id
  ), coverage_days as materialized (
    -- A daily row proves receipt for that day, including a returned zero. It is
    -- not a collection manifest and never proves that a missing day was zero.
    select distinct c.resolved_id,w.stat_date
    from coverage_catalog c join public.workorder_deposit_daily w on w.country_code=c.country_code
      and w.source_system='AR_WORKORDER' and w.stat_date between v_start and v_end
      and private.dashboard_admin_live_workorder_platform_key(w.country_code,w.platform)=c.platform_key
    where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
  ), source_platform_coverage as materialized (
    select c.country_code,c.platform_key,
      coalesce((c.value->>'complete')::boolean,false) and c.resolved_id is not null as complete,
      c.value||jsonb_build_object('source',c.source,'countryCode',c.country_code,
        'identityResolved',c.resolved_id is not null,
        'missingDates',case when c.resolved_id is not null then (
          select coalesce(jsonb_agg(day::date order by day),'[]'::jsonb)
          from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') day
          where not exists(select 1 from coverage_days d where d.resolved_id=c.resolved_id and d.stat_date=day::date)) end) as info
    from coverage_catalog c
  ), native_targets as materialized (
    select c.country_code,c.country,c.platform_key,c.direction,
      array_agg(distinct candidate.platform) as native_platforms
    from cohorts c cross join lateral (
      select c.source_platform as platform union select c.platform_key
      union select a.platform from (values ('82BET'),('82LOTTERY'),('OK.WIN'),('OKWIN'),('VEER.GAME'),('VEERGAME'),
        ('RAJA'),('RAJALOTTERY'),('RAJAGAME'),('RAJAGAMES'),('SHREE.WIN'),('SHREEWIN')) a(platform)
      where upper(c.country_code)='IN'
        and private.dashboard_admin_live_workorder_platform_key(c.country_code,a.platform)=c.platform_key
    ) candidate
    where coalesce(c.source,'ar')='ar'
    group by c.country_code,c.country,c.platform_key,c.direction
  ), authorized_native_targets as materialized (
    select distinct t.country_code,t.country,t.platform_key,t.direction,n.platform
    from native_targets t cross join lateral unnest(t.native_platforms) n(platform)
    where private.dashboard_scope_allows(v_scope,t.country_code,n.platform)
  ), newar_targets as materialized (
    -- Match the authorized catalog's exact native source identity and country.
    -- No fuzzy spellings, user-supplied raw platform, or cross-country joins.
    select c.country_code,c.country,c.platform_key,c.direction,
      min(n.platform) as platform,min(n.timezone) as timezone,min(n.launch_at) as launch_at
    from (select distinct country_code,country,platform_key,direction from cohorts where source='newar' and direction='charge') c
    join private.dashboard_admin_live_platforms() p on p.source='newar' and p.country=c.country
      and c.platform_key=any(array[
        private.dashboard_admin_live_workorder_platform_key(c.country_code,p.name),
        private.dashboard_admin_live_workorder_platform_key(c.country_code,p.source_name)])
    join public.newar_detail_platforms n on n.platform=p.source_name and n.country_code=c.country_code
      and n.country=c.country and n.enabled
    where private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
      and (n.launch_at is null or n.launch_at<=statement_timestamp())
    group by c.country_code,c.country,c.platform_key,c.direction
    having count(distinct n.platform)=1
  ), raw_details as materialized (
    select 'ar'::text as source,d.country_code,t.country,t.platform_key,d.platform,
      case d.issue_kind when 'deposit' then 'charge' else 'withdraw' end as direction,
      coalesce(nullif(btrim(d.third_party),''),'未识别三方') as raw_provider,
      nullif(btrim(d.channel_type),'') as channel_type,
      nullif(btrim(d.payment_order_no),'') as payment_order_no,
      nullif(btrim(d.source_order_no),'') as source_order_no,
      case when d.amount::text not in ('NaN','Infinity','-Infinity') then d.amount end as amount,
      d.status_code=4 as successful,d.status_code=1 as pending,d.kyc_connected as kyc_connected,
      d.submitted_date as issue_date,'ar_payment_order_missing'::text as reference_issue
    from authorized_native_targets t join public.ar_workorder_issue_details d
      on d.country_code=t.country_code and d.platform=t.platform
      and d.issue_kind=case t.direction when 'charge' then 'deposit' else 'withdraw' end
      and d.submitted_date between v_start and v_end
    where d.system_name='AR'
    union all
    select 'newar'::text,t.country_code,t.country,t.platform_key,n.platform,'charge'::text,
      coalesce(nullif(btrim(n.provider),''),'未识别三方'),nullif(btrim(n.channel_type),''),
      -- Missing original identity remains unknown. Neither source_id nor
      -- order_number is a safe substitute for a missing deposit reference.
      coalesce(case when jsonb_typeof(n.raw->'depositOrderNo')='string'
        then nullif(btrim(n.raw->>'depositOrderNo'),'') end,
        case when jsonb_typeof(n.raw->'rechargeNumber')='string'
        then nullif(btrim(n.raw->>'rechargeNumber'),'') end),
      nullif(btrim(n.order_number),''),
      case when n.currency=cfg.currency and n.amount::text not in ('NaN','Infinity','-Infinity') then n.amount end,
      n.status_code='4',n.status_code='1',
      -- NEW_AR kycConnectState numeric meanings are unconfirmed. Preserve unknown
      -- until a source-backed mapping is established; never reuse AR enums.
      null::boolean as kyc_connected,
      (n.created_at at time zone t.timezone)::date as issue_date,
      case when (n.raw ? 'depositOrderNo' and n.raw->'depositOrderNo'<>'null'::jsonb and jsonb_typeof(n.raw->'depositOrderNo')<>'string')
        or (n.raw ? 'rechargeNumber' and n.raw->'rechargeNumber'<>'null'::jsonb and jsonb_typeof(n.raw->'rechargeNumber')<>'string')
        then 'newar_reference_type_unsupported' else 'newar_explicit_reference_missing' end as reference_issue
    from newar_targets t join public.newar_detail_platforms cfg on cfg.platform=t.platform
    join public.newar_detail_records n on n.platform=t.platform and n.dataset='workorder'
      and n.created_at>=(v_start::timestamp at time zone t.timezone)
      and n.created_at<((v_end+1)::timestamp at time zone t.timezone)
      and (t.launch_at is null or n.created_at>=t.launch_at)
    where n.workorder_type in ('存款未到账','存款未到账自动化')
  ), provider_names as materialized (
    -- Resolve each distinct source label once, not once per issue record.
    select x.*,private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type) as provider
    from (select distinct country,platform,raw_provider,channel_type from raw_details) x
  ), mapped_details as materialized (
    -- payment_order_no is the collector's explicit recharge/withdrawal order.
    -- source_order_no comes from the independent orderNo source field; its
    -- business meaning is not confirmed, so it cannot replace a missing original.
    select d.*,p.provider,d.payment_order_no as original_order_no,
      regexp_replace(lower(btrim(coalesce(p.provider,''))),'[[:space:]_-]+','','g')
        in ('','未标记三方','未识别三方','未识别通道','未分类三方','未提供','unknown','unmarked') as unknown_provider,
      exists(select 1 from cohorts c where c.country_code=d.country_code and c.platform_key=d.platform_key
        and c.direction=d.direction and c.provider=p.provider and coalesce(c.source,'ar')=d.source) as selected_cohort
    from raw_details d join provider_names p on p.country=d.country and p.platform=d.platform
      and p.raw_provider=d.raw_provider and p.channel_type is not distinct from d.channel_type
  ), details as materialized (
    select * from mapped_details where selected_cohort
  ), original_groups as materialized (
    -- Keep one grouped pass. Unknown rows may supplement the status, amount and
    -- KYC evidence of one selected, known provider on the exact same original.
    -- A second known provider remains a real conflict and never borrows evidence
    -- from an unselected provider or an unknown-label cohort.
    select source,country_code,platform_key,direction,original_order_no,
      array_agg(distinct provider) as source_providers,
      coalesce(array_agg(distinct provider) filter(where not unknown_provider),'{}'::text[]) as known_providers,
      bool_or(selected_cohort and not unknown_provider) as known_selected,
      count(*) filter(where unknown_provider) as unknown_provider_records,
      bool_or(successful) filter(where selected_cohort) as selected_successful,
      bool_or(successful) filter(where selected_cohort or unknown_provider) as related_successful,
      array_agg(distinct issue_date) filter(where selected_cohort) as selected_issue_dates,
      array_agg(distinct issue_date) filter(where selected_cohort or unknown_provider) as related_issue_dates,
      case when bool_or(kyc_connected) filter(where selected_cohort) then true
        when count(*) filter(where selected_cohort and kyc_connected is null)>0 then null
        else false end as selected_kyc_matched,
      case when bool_or(kyc_connected) filter(where selected_cohort or unknown_provider) then true
        when count(*) filter(where (selected_cohort or unknown_provider) and kyc_connected is null)>0 then null
        else false end as related_kyc_matched,
      coalesce(array_agg(distinct amount) filter(where selected_cohort and amount is not null),'{}'::numeric[]) as selected_amounts,
      coalesce(array_agg(distinct amount) filter(where (selected_cohort or unknown_provider) and amount is not null),'{}'::numeric[]) as related_amounts
    from mapped_details where original_order_no is not null
    group by source,country_code,platform_key,direction,original_order_no
    having bool_or(selected_cohort)
  ), originals as materialized (
    select g.source,g.country_code,g.platform_key,g.direction,g.original_order_no,
      case when cardinality(g.known_providers)>0 then g.known_providers else g.source_providers end as providers,
      cardinality(g.known_providers)>1 as provider_conflict,
      cardinality(g.known_providers)=0 as provider_unresolved,
      r.include_related and g.unknown_provider_records>0 as provider_resolved,
      g.unknown_provider_records,
      case when r.include_related then g.related_successful else g.selected_successful end as successful,
      case when r.include_related then g.related_issue_dates else g.selected_issue_dates end as issue_dates,
      case when r.include_related then g.related_kyc_matched else g.selected_kyc_matched end as kyc_matched,
      cardinality(a.amounts) as amount_variants,
      case when cardinality(a.amounts)=1 then a.amounts[1] end as amount
    from original_groups g
    cross join lateral (select cardinality(g.known_providers)=1 and g.known_selected as include_related) r
    cross join lateral (select case when r.include_related then g.related_amounts else g.selected_amounts end as amounts) a
  ), platform_direction_scopes as materialized (
    -- Exact authorized native identities only. Conflicting/unknown provider
    -- labels do not divide an original into multiple platform totals.
    select jsonb_build_array('platformDirection',c.source,c.country_code,c.platform_key,c.direction)::text as key,
      c.source,c.country_code,c.platform_key,c.direction,min(c.platform_id) as platform_id,
      min(c.country) as country,min(c.platform) as platform,sum(c.expected_count) as expected_count
    from cohorts c join (select distinct resolved_id,resolved_country,country_code,source,platform_key
      from coverage_catalog where resolved_id is not null) p
      on p.resolved_id=c.platform_id and p.source=c.source and p.resolved_country=c.country
      and p.country_code=c.country_code and p.platform_key=c.platform_key
    where c.source in ('ar','newar') and c.direction in ('charge','withdraw')
    group by c.source,c.country_code,c.platform_key,c.direction
    having count(distinct c.platform_id)=1
  ), scope_definitions as (
    select 'summary'::text as key,coalesce((p_result#>>'{summary,submittedCount}')::bigint,0) as expected_count,
      coalesce(p_request->>'direction','all') in ('all','charge') as kyc_enabled
    union all select jsonb_build_array('direction',key)::text,coalesce((value->>'submittedCount')::bigint,0),key='charge'
      from jsonb_each(coalesce(p_result->'byDirection','{}'::jsonb))
    union all select jsonb_build_array('provider',r->>'provider',r->>'direction')::text,coalesce((r->>'submittedCount')::bigint,0),r->>'direction'='charge'
      from jsonb_array_elements(coalesce(p_result->'byProvider','[]'::jsonb)) r
    union all select jsonb_build_array('platform',country_code,platform_key,provider,direction)::text,sum(expected_count),direction='charge'
      from cohorts group by country_code,platform_key,provider,direction
    union all select key,expected_count,direction='charge' from platform_direction_scopes
  ), scope_source_links as (
    select distinct k.key,c.country_code,c.platform_key,
      case when k.key like '["platformDirection",%' then c.source end as source
    from cohorts c cross join lateral (values
      (jsonb_build_array('provider',c.provider,c.direction)::text),
      (jsonb_build_array('platform',c.country_code,c.platform_key,c.provider,c.direction)::text),
      (jsonb_build_array('platformDirection',c.source,c.country_code,c.platform_key,c.direction)::text)) k(key)
  ), scope_source_coverage as materialized (
    select s.key,coalesce(bool_and(c.complete),false) as complete,
      jsonb_build_object('complete',coalesce(bool_and(c.complete),false),
        'platforms',coalesce(jsonb_agg(distinct c.info) filter(where c.info is not null),'[]'::jsonb)) as info
    from scope_definitions s left join source_platform_coverage c on
      s.key='summary' or s.key like '["direction",%'
      or exists(select 1 from scope_source_links l where l.key=s.key and l.country_code=c.country_code and l.platform_key=c.platform_key
        and (l.source is null or l.source=c.info->>'source'))
    group by s.key
  ), daily_source as materialized (
    select c.source,c.country_code,c.country,c.platform_key,w.platform,w.stat_date,
      coalesce(nullif(btrim(w.third_party),''),'未识别三方') raw_provider,nullif(btrim(w.channel_type),'') channel_type,
      w.submitted_count,w.withdraw_not_received_count,w.submitted_amount,w.withdraw_not_received_amount,
      -- Legacy AR summaries include pending records that v46 collectors intentionally
      -- omit from original-order details. Plain status names refer to deposits only.
      case when c.source='ar' and jsonb_typeof(w.status_counts)='object' then
        case when w.submitted_count is null or w.submitted_count<0 then null::bigint
        when w.submitted_count=0 then (
          -- WORKORDER_ZERO_DAILY_PENDING_DIAGNOSTICS_V4: zero is explicit in
          -- this received raw row, not inferred from a missing row or another
          -- channel. Empty state maps and valid withdrawal-only maps add no
          -- deposit pending records. Any deposit states must all be valid zeroes.
          select case when count(*)=0 or (
            bool_and(s.key=any(array['待处理','处理中','已驳回','已处理','系统处理中',
              '存款/待处理','存款/处理中','存款/已驳回','存款/已处理','存款/系统处理中',
              '提款/待处理','提款/处理中','提款/已驳回','提款/已处理','提款/系统处理中'])
              and coalesce(s.value ~ '^[0-9]{1,15}$',false)
              and case when s.value ~ '^[0-9]{1,15}$'
                then s.key like '提款/%' or s.value::bigint=0 else false end)
            and not (bool_or(s.key like '存款/%')
              and bool_or(s.key not like '存款/%' and s.key not like '提款/%'))
          ) then 0::bigint end
          from jsonb_each_text(w.status_counts) s
        )
        when coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理') ~ '^[0-9]{1,15}$'
          then coalesce(w.status_counts->>'存款/待处理',w.status_counts->>'待处理')::bigint
        -- WORKORDER_SPARSE_PENDING_DIAGNOSTICS_V3: collectors omit zero-count states.
        -- Prove an omitted pending key is zero only from an entire valid deposit
        -- state map matching this raw daily row's submitted count. Never infer it
        -- from another channel, a withdrawal prefix, an empty map or malformed keys.
        when not (w.status_counts ?| array['存款/待处理','待处理']) then (
          select case when count(*)>0
            and bool_and(s.key=any(array['处理中','已驳回','已处理','系统处理中',
              '存款/处理中','存款/已驳回','存款/已处理','存款/系统处理中'])
              and coalesce(s.value ~ '^[0-9]{1,15}$',false))
            -- Mixed legacy/plain and prefixed deposit maps could double-count a
            -- state. Keep them unknown rather than accepting a coincidental sum.
            and not (bool_or(s.key like '存款/%') and bool_or(s.key not like '存款/%'))
            and sum(case when s.value ~ '^[0-9]{1,15}$' then s.value::bigint end)=w.submitted_count
            then 0::bigint end
          from jsonb_each_text(w.status_counts) s
          where s.key not like '提款/%'
        ) end
      end as deposit_pending_count
    from (select distinct coalesce(source,'ar') source,country_code,country,platform_key from cohorts) c
    join public.workorder_deposit_daily w on w.country_code=c.country_code and w.source_system='AR_WORKORDER'
      and w.stat_date between v_start and v_end
      and private.dashboard_admin_live_workorder_platform_key(w.country_code,w.platform)=c.platform_key
    where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
  ), daily_names as materialized (
    select x.*,private.dashboard_admin_live_workorder_provider(country,platform,raw_provider,channel_type) provider
    from (select distinct country,platform,raw_provider,channel_type from daily_source) x
  ), daily_expected as materialized (
    select d.source,d.country_code,d.platform_key,p.provider,k.direction,d.stat_date as issue_date,sum(k.expected_count) expected_count,
      case when bool_and(k.expected_amount is not null and k.expected_amount::text not in ('NaN','Infinity','-Infinity')) then sum(k.expected_amount) end as expected_amount,
      case when k.direction='charge' and bool_and(d.deposit_pending_count is not null) then sum(d.deposit_pending_count) end as pending_count
    from daily_source d join daily_names p on p.country=d.country and p.platform=d.platform
      and p.raw_provider=d.raw_provider and p.channel_type is not distinct from d.channel_type
    cross join lateral (values ('charge'::text,d.submitted_count,d.submitted_amount),('withdraw'::text,d.withdraw_not_received_count,d.withdraw_not_received_amount)) k(direction,expected_count,expected_amount)
    where exists(select 1 from cohorts c where coalesce(c.source,'ar')=d.source and c.country_code=d.country_code
      and c.platform_key=d.platform_key and c.provider=p.provider and c.direction=k.direction)
    group by d.source,d.country_code,d.platform_key,p.provider,k.direction,d.stat_date
  ), daily_details as materialized (
    select source,country_code,platform_key,provider,direction,issue_date,count(*) detail_count,count(*) filter(where pending) as pending_detail_count,
      case when bool_and(amount is not null) then sum(amount) end as detail_amount,
      count(*) filter(where original_order_no is null) missing_order_number_count,
      count(*) filter(where original_order_no is null and source_order_no is not null) source_order_only_count,
      count(*) filter(where original_order_no is null and reference_issue='ar_payment_order_missing') ar_reference_missing_count,
      count(*) filter(where original_order_no is null and reference_issue='newar_explicit_reference_missing') newar_reference_missing_count,
      count(*) filter(where original_order_no is null and reference_issue='newar_reference_type_unsupported') unsupported_reference_count
    from details group by source,country_code,platform_key,provider,direction,issue_date
  ), daily_original_issues as materialized (
    -- Only problematic originals expand to day buckets; avoid a raw-record join
    -- back to the full original aggregate (quadratic on large live ranges).
    select o.source,o.country_code,o.platform_key,p.provider,o.direction,day.issue_date,
      count(*) filter(where o.provider_conflict) provider_conflict_count,
      count(*) filter(where o.provider_unresolved) unresolved_provider_order_count,
      count(*) filter(where o.provider_resolved) resolved_provider_order_count,
      sum(o.unknown_provider_records) as unknown_provider_record_count,
      count(*) filter(where o.amount_variants>1) amount_conflict_count,
      count(*) filter(where o.amount_variants=0) missing_amount_count
    from originals o cross join lateral unnest(o.providers) p(provider)
    cross join lateral unnest(o.issue_dates) day(issue_date)
    where (o.provider_conflict or o.provider_unresolved or o.provider_resolved or o.amount_variants<>1)
      and exists(select 1 from cohorts c where coalesce(c.source,'ar')=o.source and c.country_code=o.country_code
        and c.platform_key=o.platform_key and c.direction=o.direction and c.provider=p.provider)
    group by o.source,o.country_code,o.platform_key,p.provider,o.direction,day.issue_date
  ), excluded_type_details as materialized (
    -- These collected NEW_AR USDT issues are outside the existing fiat-original
    -- read model. Count evidence only; never infer their original ID or amount.
    select x.source,x.country_code,x.platform_key,x.direction,x.issue_date,
      private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type) as provider,
      sum(x.record_count) as record_count,
      case when bool_and(x.record_amount is not null) then sum(x.record_amount) end as record_amount,
      case when bool_and(x.currency is not null) and count(distinct x.currency)=1 then min(x.currency) end as currency
    from (
      select 'newar'::text source,t.country_code,t.country,t.platform_key,t.direction,n.platform,
        coalesce(nullif(btrim(n.provider),''),'未识别三方') raw_provider,nullif(btrim(n.channel_type),'') channel_type,
        (n.created_at at time zone t.timezone)::date issue_date,count(*) record_count,
        case when bool_and(n.amount is not null and n.amount::text not in ('NaN','Infinity','-Infinity')) then sum(n.amount) end as record_amount,
        case when bool_and(nullif(btrim(n.currency),'') is not null) and count(distinct n.currency)=1 then min(n.currency) end as currency
      from newar_targets t join public.newar_detail_records n on n.platform=t.platform and n.dataset='workorder'
        and n.created_at>=(v_start::timestamp at time zone t.timezone)
        and n.created_at<((v_end+1)::timestamp at time zone t.timezone)
        and (t.launch_at is null or n.created_at>=t.launch_at)
      where n.workorder_type='USDT存款未到账自动化'
      group by t.country_code,t.country,t.platform_key,t.direction,n.platform,n.provider,n.channel_type,
        (n.created_at at time zone t.timezone)::date
    ) x group by x.source,x.country_code,x.platform_key,x.direction,x.issue_date,
      private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type)
  ), diagnostic_days as materialized (
    select coalesce(e.source,d.source) source,coalesce(e.country_code,d.country_code) country_code,
      coalesce(e.platform_key,d.platform_key) platform_key,coalesce(e.provider,d.provider) provider,
      coalesce(e.direction,d.direction) direction,coalesce(e.issue_date,d.issue_date) issue_date,
      case when e.issue_date is not null then coalesce(e.expected_count,0)
        when exists(select 1 from daily_source ds where ds.source=d.source and ds.country_code=d.country_code
          and ds.platform_key=d.platform_key and ds.stat_date=d.issue_date) then 0 end as expected_count,
      coalesce(d.detail_count,0) detail_count,
      e.expected_amount,case when d.issue_date is null then 0::numeric else d.detail_amount end as detail_amount,
      u.record_amount as excluded_type_amount,u.currency as excluded_type_currency,
      case when coalesce(u.record_count,0)=0 then (select case when count(*)>0 and bool_and(c.resolved_currency is not null)
        and count(distinct c.resolved_currency)=1 then min(c.resolved_currency) end from coverage_catalog c
        where c.country_code=coalesce(e.country_code,d.country_code) and c.platform_key=coalesce(e.platform_key,d.platform_key)) end as raw_amount_currency,
      e.pending_count as expected_pending_count,coalesce(d.pending_detail_count,0) as pending_detail_count,
      coalesce(u.record_count,0) as excluded_type_detail_count,
      case when e.expected_count>coalesce(d.detail_count,0) and e.expected_count-coalesce(d.detail_count,0)=u.record_count
        then u.record_count else 0 end as excluded_type_explained_mismatch_count,
      -- Explain only an exact same-day/provider/direction reconciliation. A larger,
      -- smaller or unknown gap remains unexplained; source absence is never zero.
      case when e.source='ar' and e.direction='charge' and e.pending_count is not null
        and e.expected_count>coalesce(d.detail_count,0)
        and e.expected_count-coalesce(d.detail_count,0)=greatest(e.pending_count-coalesce(d.pending_detail_count,0),0)
        then e.expected_count-coalesce(d.detail_count,0) else 0 end as pending_excluded_detail_count,
      coalesce(d.missing_order_number_count,0) missing_order_number_count,
      coalesce(d.source_order_only_count,0) source_order_only_count,
      coalesce(d.ar_reference_missing_count,0) ar_reference_missing_count,
      coalesce(d.newar_reference_missing_count,0) newar_reference_missing_count,
      coalesce(d.unsupported_reference_count,0) unsupported_reference_count,
      coalesce(o.provider_conflict_count,0) provider_conflict_count,
      coalesce(o.unresolved_provider_order_count,0) unresolved_provider_order_count,
      coalesce(o.resolved_provider_order_count,0) resolved_provider_order_count,
      coalesce(o.unknown_provider_record_count,0) unknown_provider_record_count,
      coalesce(o.amount_conflict_count,0) amount_conflict_count,coalesce(o.missing_amount_count,0) missing_amount_count
    from daily_expected e full join daily_details d using(source,country_code,platform_key,provider,direction,issue_date)
    left join excluded_type_details u on u.source=coalesce(e.source,d.source) and u.country_code=coalesce(e.country_code,d.country_code)
      and u.platform_key=coalesce(e.platform_key,d.platform_key) and u.provider=coalesce(e.provider,d.provider)
      and u.direction=coalesce(e.direction,d.direction) and u.issue_date=coalesce(e.issue_date,d.issue_date)
    left join daily_original_issues o on o.source=coalesce(e.source,d.source) and o.country_code=coalesce(e.country_code,d.country_code)
      and o.platform_key=coalesce(e.platform_key,d.platform_key) and o.provider=coalesce(e.provider,d.provider)
      and o.direction=coalesce(e.direction,d.direction) and o.issue_date=coalesce(e.issue_date,d.issue_date)
  ), diagnostics as materialized (
    select k.key,jsonb_agg(jsonb_build_object('platform',c.platform,'sourcePlatform',c.source_platform,
      'source',d.source,'countryCode',d.country_code,'provider',d.provider,'direction',d.direction,'date',d.issue_date,
      'expectedAvailable',d.expected_count is not null,'expectedCount',d.expected_count,'detailCount',d.detail_count,
      'missingDetailCount',case when d.expected_count is not null then greatest(d.expected_count-d.detail_count,0) end,'detailMismatchCount',abs(d.expected_count-d.detail_count),
      'expectedPendingCount',d.expected_pending_count,'pendingDetailCount',d.pending_detail_count,
      'pendingExcludedDetailCount',d.pending_excluded_detail_count,
      'excludedWorkorderTypeCount',d.excluded_type_detail_count,'excludedTypeExplainedMismatchCount',d.excluded_type_explained_mismatch_count,
      'unexplainedDetailMismatchCount',case when d.expected_count is not null then greatest(abs(d.expected_count-d.detail_count)-d.pending_excluded_detail_count-d.excluded_type_explained_mismatch_count,0) end,
      'missingOrderNumberCount',d.missing_order_number_count,'sourceOrderOnlyCount',d.source_order_only_count,
      'arPaymentOrderMissingCount',d.ar_reference_missing_count,'newarExplicitReferenceMissingCount',d.newar_reference_missing_count,
      'unsupportedReferenceTypeCount',d.unsupported_reference_count,'providerConflictCount',d.provider_conflict_count,
      'unresolvedProviderOrderCount',d.unresolved_provider_order_count,'resolvedProviderOrderCount',d.resolved_provider_order_count,
      'unknownProviderRecordCount',d.unknown_provider_record_count,
      'amountConflictCount',d.amount_conflict_count,'missingAmountCount',d.missing_amount_count,
      -- Raw work-order amounts are not distinct original-order amounts. Unknown
      -- USDT currency stays null and can never be summed into a fiat currency.
      'rawAmountComparison',jsonb_build_object('basis','source_workorder_records',
        'expectedAmount',d.expected_amount,'detailAmount',d.detail_amount,
        'differenceAmount',d.expected_amount-d.detail_amount,'currency',d.raw_amount_currency,
        'pendingExcludedDifferenceAmount',null::numeric,
        'pendingRangeNetDifferenceAmount',case when d.pending_excluded_detail_count>0 then d.expected_amount-d.detail_amount end,
        'amountComparisonStatus',case when d.expected_amount is null or d.detail_amount is null then 'unavailable'
          when d.pending_excluded_detail_count>0 then 'scope_difference_not_reconciled'
          when d.excluded_type_explained_mismatch_count>0 and d.expected_amount-d.detail_amount=d.excluded_type_amount then 'raw_difference_explained'
          when d.expected_amount=d.detail_amount then 'same_raw_amount' else 'unexplained' end,
        'excludedTypeDifferenceAmount',case when d.excluded_type_explained_mismatch_count>0 and d.expected_amount-d.detail_amount=d.excluded_type_amount then d.expected_amount-d.detail_amount end,
        'excludedTypeAmount',d.excluded_type_amount,'excludedTypeCurrency',d.excluded_type_currency,
        'unexplainedDifferenceAmount',case when d.expected_amount is not null and d.detail_amount is not null then
          case when d.pending_excluded_detail_count>0 then null::numeric
          when d.excluded_type_explained_mismatch_count>0 then d.expected_amount-d.detail_amount-d.excluded_type_amount
          else d.expected_amount-d.detail_amount end end))
      order by d.issue_date desc,c.platform,d.provider,d.direction) as days
    from diagnostic_days d join (select country_code,platform_key,provider,direction,coalesce(source,'ar') source,
      min(platform) platform,min(source_platform) source_platform from cohorts group by country_code,platform_key,provider,direction,coalesce(source,'ar')) c
      using(source,country_code,platform_key,provider,direction)
    cross join lateral (values ('summary'::text),(jsonb_build_array('direction',d.direction)::text),
      (jsonb_build_array('provider',d.provider,d.direction)::text),
      (jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text),
      (jsonb_build_array('platformDirection',d.source,d.country_code,d.platform_key,d.direction)::text)) k(key)
    where d.expected_count is null or d.expected_count<>d.detail_count or d.missing_order_number_count>0 or d.provider_conflict_count>0 or d.unresolved_provider_order_count>0 or d.resolved_provider_order_count>0
      or d.amount_conflict_count>0 or d.missing_amount_count>0 or d.expected_amount is distinct from d.detail_amount
    group by k.key
  ), detail_metrics as (
    select k.key,count(*) as detail_count,
      count(*) filter(where d.original_order_no is null) as missing_order_number_count,
      count(*) filter(where d.original_order_no is null and d.source_order_no is not null) as source_order_only_count
    from details d cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',d.direction)::text),
      (jsonb_build_array('provider',d.provider,d.direction)::text),
      (jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text),
      (jsonb_build_array('platformDirection',d.source,d.country_code,d.platform_key,d.direction)::text)) k(key)
    group by k.key
  ), attributed_details as materialized (
    -- A source-label-only cohort is accounted elsewhere ONLY when every record
    -- has the exact same original identity as one selected known provider and
    -- all shared amount evidence agrees. This never changes financial totals.
    select k.key,count(*) as attributed_detail_count
    from details d join originals o on o.source=d.source and o.country_code=d.country_code
      and o.platform_key=d.platform_key and o.direction=d.direction and o.original_order_no=d.original_order_no
    cross join lateral (values (jsonb_build_array('provider',d.provider,d.direction)::text),
      (jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text)) k(key)
    where d.unknown_provider and o.provider_resolved and not o.provider_conflict and not o.provider_unresolved
      and o.amount_variants=1 and cardinality(o.providers)=1
      and exists(select 1 from cohorts c where coalesce(c.source,'ar')=o.source and c.country_code=o.country_code
        and c.platform_key=o.platform_key and c.direction=o.direction and c.provider=o.providers[1])
    group by k.key
  ), original_scope_rows as (
    select o.*,k.key,true as eligible from originals o cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',o.direction)::text),
      (jsonb_build_array('platformDirection',o.source,o.country_code,o.platform_key,o.direction)::text)) k(key)
    union all
    select o.*,k.key,not o.provider_conflict and not o.provider_unresolved as eligible
    from originals o cross join lateral unnest(o.providers) p(provider)
    cross join lateral (values (jsonb_build_array('provider',p.provider,o.direction)::text),
      (jsonb_build_array('platform',o.country_code,o.platform_key,p.provider,o.direction)::text)) k(key)
  ), original_metrics as (
    select key,count(*) filter(where eligible) as order_count,
      count(*) filter(where eligible and successful) as success_count,
      case when count(*) filter(where eligible and amount is null)=0 then coalesce(sum(amount) filter(where eligible),0) end as order_amount,
      case when count(*) filter(where eligible and successful and amount is null)=0 then coalesce(sum(amount) filter(where eligible and successful),0) end as success_amount,
      count(*) filter(where eligible and coalesce(successful,false)=false) as not_received_count,
      case when count(*) filter(where eligible and coalesce(successful,false)=false and amount is null)=0 then coalesce(sum(amount) filter(where eligible and coalesce(successful,false)=false),0) end as not_received_amount,
      count(*) filter(where eligible and direction='charge' and coalesce(successful,false)=false and kyc_matched is true) as not_received_kyc_count,
      case when count(*) filter(where eligible and direction='charge' and coalesce(successful,false)=false and kyc_matched is true and amount is null)=0
        then coalesce(sum(amount) filter(where eligible and direction='charge' and coalesce(successful,false)=false and kyc_matched is true),0) end as not_received_kyc_amount,
      count(*) filter(where eligible and direction='charge' and coalesce(successful,false)=false and kyc_matched is null) as kyc_unknown_order_count,
      count(*) filter(where eligible and amount_variants>1) as amount_conflict_count,
      count(*) filter(where eligible and amount_variants=0) as missing_amount_count,
      count(*) filter(where provider_conflict) as provider_conflict_count,
      count(*) filter(where provider_unresolved) as unresolved_provider_order_count,
      count(*) filter(where provider_resolved) as resolved_provider_order_count,
      coalesce(sum(unknown_provider_records),0) as unknown_provider_record_count
    from original_scope_rows group by key
  ), combined as (
    select s.key,s.expected_count,s.kyc_enabled,coalesce(d.detail_count,0) as detail_count,
      coalesce(d.missing_order_number_count,0) as missing_order_number_count,
      coalesce(d.source_order_only_count,0) as source_order_only_count,
      greatest(s.expected_count-coalesce(d.detail_count,0),0) as missing_detail_count,
      abs(s.expected_count-coalesce(d.detail_count,0)) as detail_mismatch_count,
      coalesce(o.order_count,0) as order_count,coalesce(o.success_count,0) as success_count,
      case when o.key is null then 0::numeric else o.order_amount end as order_amount,
      case when o.key is null then 0::numeric else o.success_amount end as success_amount,
      coalesce(o.not_received_count,0) as not_received_count,
      coalesce(o.not_received_kyc_count,0) as not_received_kyc_count,
      case when o.key is null then 0::numeric else o.not_received_kyc_amount end as not_received_kyc_amount,
      coalesce(o.kyc_unknown_order_count,0) as kyc_unknown_order_count,
      case when o.key is null then 0::numeric else o.not_received_amount end as not_received_amount,
      coalesce(o.amount_conflict_count,0) as amount_conflict_count,coalesce(o.missing_amount_count,0) as missing_amount_count,
      coalesce(o.provider_conflict_count,0) as provider_conflict_count,
      coalesce(o.unresolved_provider_order_count,0) as unresolved_provider_order_count,
      coalesce(o.resolved_provider_order_count,0) as resolved_provider_order_count,
      coalesce(o.unknown_provider_record_count,0) as unknown_provider_record_count
    from scope_definitions s left join detail_metrics d on d.key=s.key left join original_metrics o on o.key=s.key
  ), flags as (
    select x.*,s.info as source_coverage,coalesce(g.days,'[]'::jsonb) as diagnostic_days,
      coalesce(a.attributed_detail_count,0) as attributed_elsewhere_detail_count,
      order_count=0 and detail_count>0 and detail_count=expected_count and detail_count=coalesce(a.attributed_detail_count,0)
        and coalesce(s.complete,false) and missing_order_number_count=0 and amount_conflict_count=0
        and missing_amount_count=0 and provider_conflict_count=0 and unresolved_provider_order_count=0
        and not exists(select 1 from jsonb_array_elements(coalesce(g.days,'[]'::jsonb)) z
          where (z->>'detailMismatchCount')::bigint>0 or z->>'expectedAvailable'='false' or coalesce((z#>>'{rawAmountComparison,unexplainedDifferenceAmount}')::numeric,0)<>0) as attributed_elsewhere,
      order_count=0 and (expected_count>0 or detail_count>0 or not coalesce(s.complete,false)) as unavailable,
      detail_mismatch_count=0 and not exists(select 1 from jsonb_array_elements(coalesce(g.days,'[]'::jsonb)) z where (z->>'detailMismatchCount')::bigint>0)
        and missing_order_number_count=0 and amount_conflict_count=0
        and missing_amount_count=0 and provider_conflict_count=0 and unresolved_provider_order_count=0
        and coalesce(s.complete,false) as complete
    from combined x left join scope_source_coverage s on s.key=x.key left join diagnostics g on g.key=x.key
      left join attributed_details a on a.key=x.key
  ), classified as (
    select f.*,case
      when attributed_elsewhere then 'attributed_elsewhere'
      when exists(select 1 from jsonb_array_elements(diagnostic_days) z
        where coalesce((z#>>'{rawAmountComparison,unexplainedDifferenceAmount}')::numeric,0)<>0) then 'review_required'
      when complete and not unavailable then 'complete'
      when source_coverage->>'complete'='true' and missing_order_number_count=0 and amount_conflict_count=0
        and missing_amount_count=0 and provider_conflict_count=0 and unresolved_provider_order_count=0
        and detail_mismatch_count>0
        and detail_mismatch_count=(select coalesce(sum((z->>'pendingExcludedDetailCount')::bigint+(z->>'excludedTypeExplainedMismatchCount')::bigint),0) from jsonb_array_elements(diagnostic_days)z)
        and not exists(select 1 from jsonb_array_elements(diagnostic_days)z where z->>'expectedAvailable'='false'
          or (z->>'unexplainedDetailMismatchCount')::bigint>0) then 'explained_range_difference'
      else 'review_required' end as diagnosis_status
    from flags f
  )
  select coalesce(jsonb_object_agg(key,jsonb_build_object(
    'uniqueOrderCount',case when not unavailable then order_count end,
    'uniqueOrderAmount',case when not unavailable then order_amount end,
    'uniqueSuccessCount',case when not unavailable then success_count end,
    'uniqueSuccessAmount',case when not unavailable then success_amount end,
    'uniqueNotReceivedCount',case when not unavailable then not_received_count end,
    'uniqueNotReceivedAmount',case when not unavailable then not_received_amount end,
    -- A positive result is the confirmed subset. An exact zero additionally needs
    -- complete original coverage and no unknown KYC; incomplete data stays null.
    'uniqueNotReceivedKycCount',case when kyc_enabled and not unavailable
      and (not_received_kyc_count>0 or (kyc_unknown_order_count=0 and complete)) then not_received_kyc_count end,
    'uniqueNotReceivedKycAmount',case when kyc_enabled and not unavailable
      and (not_received_kyc_count>0 or (kyc_unknown_order_count=0 and complete)) then not_received_kyc_amount end,
    'uniqueCoverage',jsonb_build_object('status',case when attributed_elsewhere then 'attributed_elsewhere' when unavailable then 'unavailable' when complete then 'complete' else 'partial' end,
      'complete',complete and (not unavailable or attributed_elsewhere),'basis','platform_direction_original_order_full_range',
      'diagnosticVersion',5,'diagnosisStatus',diagnosis_status,'needsReview',diagnosis_status='review_required','attributedElsewhere',attributed_elsewhere,'attributedElsewhereDetailCount',attributed_elsewhere_detail_count,'sourceCoverage',source_coverage,'diagnosticDays',diagnostic_days,
      'excludedWorkorderTypeCount',(select coalesce(sum((z->>'excludedWorkorderTypeCount')::bigint),0) from jsonb_array_elements(diagnostic_days) z),
      'excludedTypeExplainedMismatchCount',(select coalesce(sum((z->>'excludedTypeExplainedMismatchCount')::bigint),0) from jsonb_array_elements(diagnostic_days) z),
      'pendingExcludedDetailCount',(select coalesce(sum((z->>'pendingExcludedDetailCount')::bigint),0) from jsonb_array_elements(diagnostic_days) z),
      'unexplainedDetailMismatchCount',(select coalesce(sum((z->>'unexplainedDetailMismatchCount')::bigint),0) from jsonb_array_elements(diagnostic_days) z),
      'kycUnknownOrderCount',case when kyc_enabled then kyc_unknown_order_count end,
      'detailCount',detail_count,'missingOrderNumberCount',missing_order_number_count,'missingDetailCount',missing_detail_count,
      'detailMismatchCount',detail_mismatch_count,'sourceOrderOnlyCount',source_order_only_count,
      'amountConflictCount',amount_conflict_count,'missingAmountCount',missing_amount_count,'providerConflictCount',provider_conflict_count,
      'unresolvedProviderOrderCount',unresolved_provider_order_count,'resolvedProviderOrderCount',resolved_provider_order_count,
      'unknownProviderRecordCount',unknown_provider_record_count)
    )||coalesce((select jsonb_build_object('platformId',p.platform_id,'platform',p.platform,
      'country',p.country,'countryCode',p.country_code,'source',p.source,'direction',p.direction)
      from platform_direction_scopes p where p.key=classified.key),'{}'::jsonb)
  ),'{}'::jsonb) into v_metrics from classified;

  v_result:=jsonb_set(v_result,'{summary}',coalesce(v_result->'summary','{}'::jsonb)||coalesce(v_metrics->'summary','{}'::jsonb));
  v_result:=jsonb_set(v_result,'{byDirection}',coalesce((select jsonb_object_agg(key,value||
    coalesce(v_metrics->jsonb_build_array('direction',key)::text,'{}'::jsonb)) from jsonb_each(coalesce(v_result->'byDirection','{}'::jsonb))),'{}'::jsonb));
  v_result:=jsonb_set(v_result,'{byProvider}',coalesce((select jsonb_agg(r||coalesce(v_metrics->jsonb_build_array('provider',r->>'provider',r->>'direction')::text,'{}'::jsonb) order by ordinality)
    from jsonb_array_elements(coalesce(v_result->'byProvider','[]'::jsonb)) with ordinality rows(r,ordinality)),'[]'::jsonb));
  v_result:=jsonb_set(v_result,'{byPlatformProvider}',coalesce((select jsonb_agg(r||coalesce(v_metrics->jsonb_build_array('platform',r->>'countryCode',
      private.dashboard_admin_live_workorder_platform_key(r->>'countryCode',r->>'sourcePlatform'),r->>'provider',r->>'direction')::text,'{}'::jsonb) order by ordinality)
    from jsonb_array_elements(coalesce(v_result->'byPlatformProvider','[]'::jsonb)) with ordinality rows(r,ordinality)),'[]'::jsonb));
  -- New platform totals are independent of provider attribution and pagination.
  -- Preserve the four existing result domains byte-for-byte in JSON semantics.
  v_result:=jsonb_set(v_result,'{byPlatformDirection}',coalesce((select jsonb_agg(jsonb_build_object(
    'platformId',value->'platformId','platform',value->'platform','country',value->'country',
    'countryCode',value->'countryCode','source',value->'source','direction',value->'direction',
    'uniqueOrderCount',value->'uniqueOrderCount','uniqueSuccessCount',value->'uniqueSuccessCount',
    'uniqueCoverage',value->'uniqueCoverage') order by value->>'country',value->>'platformId',value->>'direction')
    from jsonb_each(v_metrics) where key like '["platformDirection",%' and value->>'platformId' is not null),'[]'::jsonb));
  return v_result||jsonb_build_object('uniqueOrderVersion',1);
end;
$function$;
$definition$;
 if(select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target)is distinct from metadata then
  raise exception 'workorder_platform_totals_metadata_changed';end if;
 if(select md5(prosrc) from pg_proc where oid=target)<>'14b1fb584d1d86332a71f9b6451816dd'
   or md5(pg_get_functiondef(target))<>'c16c906df1ddd814be59fa1c232fb68f' then raise exception 'workorder_platform_totals_candidate_hash';end if;
end $install$;
notify pgrst,'reload schema';commit;
