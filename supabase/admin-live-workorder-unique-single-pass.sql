-- Use one grouped original-order pass; avoid a quadratic aggregate self-join.
-- Existing issue counts, amounts, paging, aliases and authorization stay intact.
-- Missing original numbers never fall back to a work-order identifier.
begin;

create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  v_scope jsonb:=private.dashboard_admin_live_scope();
  v_start date:=(p_result->>'startDate')::date; v_end date:=(p_result->>'endDate')::date;
  v_metrics jsonb; v_result jsonb:=p_result;
begin
  -- The caller has validated the request and built complete, authorized cohorts.
  -- Read only matching AR original issue rows; NEW_AR aggregate-only cohorts
  -- cannot supply an original order identity and remain explicitly uncovered.
  with cohorts as materialized (
    select r->>'countryCode' as country_code,r->>'country' as country,
      r->>'sourcePlatform' as source_platform,
      private.dashboard_admin_live_workorder_platform_key(r->>'countryCode',r->>'sourcePlatform') as platform_key,
      r->>'provider' as provider,r->>'direction' as direction,
      r->>'source' as source,coalesce((r->>'submittedCount')::bigint,0) as expected_count
    from jsonb_array_elements(coalesce(p_result->'byPlatformProvider','[]'::jsonb)) r
  ), native_targets as materialized (
    select c.country_code,c.country,c.platform_key,c.direction,
      array_agg(distinct candidate.platform) as native_platforms
    from cohorts c cross join lateral (
      select c.source_platform as platform union select c.platform_key
      union select a.platform from (values ('82BET'),('82LOTTERY'),('OK.WIN'),('OKWIN'),('VEER.GAME'),('VEERGAME'),
        ('RAJA'),('RAJALOTTERY'),('RAJAGAME'),('RAJAGAMES')) a(platform)
      where upper(c.country_code)='IN'
        and private.dashboard_admin_live_workorder_platform_key(c.country_code,a.platform)=c.platform_key
    ) candidate
    where coalesce(c.source,'ar')='ar'
    group by c.country_code,c.country,c.platform_key,c.direction
  ), authorized_native_targets as materialized (
    select distinct t.country_code,t.country,t.platform_key,t.direction,n.platform
    from native_targets t cross join lateral unnest(t.native_platforms) n(platform)
    where private.dashboard_scope_allows(v_scope,t.country_code,n.platform)
  ), raw_details as materialized (
    select d.country_code,t.country,t.platform_key,d.platform,
      case d.issue_kind when 'deposit' then 'charge' else 'withdraw' end as direction,
      coalesce(nullif(btrim(d.third_party),''),'未识别三方') as raw_provider,
      nullif(btrim(d.channel_type),'') as channel_type,
      nullif(btrim(d.payment_order_no),'') as payment_order_no,
      nullif(btrim(d.source_order_no),'') as source_order_no,
      case when d.amount::text not in ('NaN','Infinity','-Infinity') then d.amount end as amount,
      d.status_code=4 as successful
    from authorized_native_targets t join public.ar_workorder_issue_details d
      on d.country_code=t.country_code and d.platform=t.platform
      and d.issue_kind=case t.direction when 'charge' then 'deposit' else 'withdraw' end
      and d.submitted_date between v_start and v_end
    where d.system_name='AR'
  ), provider_names as materialized (
    -- Resolve each distinct source label once, not once per issue record.
    select x.*,private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type) as provider
    from (select distinct country,platform,raw_provider,channel_type from raw_details) x
  ), mapped_details as materialized (
    -- payment_order_no is the collector's explicit recharge/withdrawal order.
    -- source_order_no comes from the independent orderNo source field; its
    -- business meaning is not confirmed, so it cannot replace a missing original.
    select d.*,p.provider,d.payment_order_no as original_order_no,
      exists(select 1 from cohorts c where c.country_code=d.country_code and c.platform_key=d.platform_key
        and c.direction=d.direction and c.provider=p.provider and coalesce(c.source,'ar')='ar') as selected_cohort
    from raw_details d join provider_names p on p.country=d.country and p.platform=d.platform
      and p.raw_provider=d.raw_provider and p.channel_type is not distinct from d.channel_type
  ), details as materialized (
    select * from mapped_details where selected_cohort
  ), originals as materialized (
    -- One grouped pass across authorized source rows detects provider conflicts
    -- before selection while metrics use only the selected submitted cohort.
    -- Do not rejoin two original-order aggregates: JSON-input row estimates can
    -- turn that join into quadratic nested loops on real multi-platform ranges.
    select country_code,platform_key,direction,original_order_no,array_agg(distinct provider) as providers,
      bool_or(successful) filter(where selected_cohort) as successful,
      count(distinct amount) filter(where selected_cohort) as amount_variants,
      case when count(distinct amount) filter(where selected_cohort)=1
        then min(amount) filter(where selected_cohort) end as amount
    from mapped_details where original_order_no is not null
    group by country_code,platform_key,direction,original_order_no
    having bool_or(selected_cohort)
  ), scope_definitions as (
    select 'summary'::text as key,coalesce((p_result#>>'{summary,submittedCount}')::bigint,0) as expected_count
    union all select jsonb_build_array('direction',key)::text,coalesce((value->>'submittedCount')::bigint,0)
      from jsonb_each(coalesce(p_result->'byDirection','{}'::jsonb))
    union all select jsonb_build_array('provider',r->>'provider',r->>'direction')::text,coalesce((r->>'submittedCount')::bigint,0)
      from jsonb_array_elements(coalesce(p_result->'byProvider','[]'::jsonb)) r
    union all select jsonb_build_array('platform',country_code,platform_key,provider,direction)::text,sum(expected_count)
      from cohorts group by country_code,platform_key,provider,direction
  ), detail_metrics as (
    select k.key,count(*) as detail_count,
      count(*) filter(where d.original_order_no is null) as missing_order_number_count,
      count(*) filter(where d.original_order_no is null and d.source_order_no is not null) as source_order_only_count
    from details d cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',d.direction)::text),
      (jsonb_build_array('provider',d.provider,d.direction)::text),
      (jsonb_build_array('platform',d.country_code,d.platform_key,d.provider,d.direction)::text)) k(key)
    group by k.key
  ), original_scope_rows as (
    select o.*,k.key,true as eligible from originals o cross join lateral (values ('summary'::text),
      (jsonb_build_array('direction',o.direction)::text)) k(key)
    union all
    select o.*,k.key,cardinality(o.providers)=1 as eligible
    from originals o cross join lateral unnest(o.providers) p(provider)
    cross join lateral (values (jsonb_build_array('provider',p.provider,o.direction)::text),
      (jsonb_build_array('platform',o.country_code,o.platform_key,p.provider,o.direction)::text)) k(key)
  ), original_metrics as (
    select key,count(*) filter(where eligible) as order_count,
      count(*) filter(where eligible and successful) as success_count,
      case when count(*) filter(where eligible and amount is null)=0 then coalesce(sum(amount) filter(where eligible),0) end as order_amount,
      case when count(*) filter(where eligible and successful and amount is null)=0 then coalesce(sum(amount) filter(where eligible and successful),0) end as success_amount,
      count(*) filter(where eligible and amount_variants>1) as amount_conflict_count,
      count(*) filter(where eligible and amount_variants=0) as missing_amount_count,
      count(*) filter(where cardinality(providers)>1) as provider_conflict_count
    from original_scope_rows group by key
  ), combined as (
    select s.key,s.expected_count,coalesce(d.detail_count,0) as detail_count,
      coalesce(d.missing_order_number_count,0) as missing_order_number_count,
      coalesce(d.source_order_only_count,0) as source_order_only_count,
      greatest(s.expected_count-coalesce(d.detail_count,0),0) as missing_detail_count,
      abs(s.expected_count-coalesce(d.detail_count,0)) as detail_mismatch_count,
      coalesce(o.order_count,0) as order_count,coalesce(o.success_count,0) as success_count,
      case when o.key is null then 0::numeric else o.order_amount end as order_amount,
      case when o.key is null then 0::numeric else o.success_amount end as success_amount,
      coalesce(o.amount_conflict_count,0) as amount_conflict_count,coalesce(o.missing_amount_count,0) as missing_amount_count,
      coalesce(o.provider_conflict_count,0) as provider_conflict_count
    from scope_definitions s left join detail_metrics d on d.key=s.key left join original_metrics o on o.key=s.key
  ), flags as (
    select *,order_count=0 and (expected_count>0 or detail_count>0
      or not coalesce((p_result#>>'{coverage,complete}')::boolean,false)) as unavailable,
      detail_mismatch_count=0 and missing_order_number_count=0 and amount_conflict_count=0
        and missing_amount_count=0 and provider_conflict_count=0
        and coalesce((p_result#>>'{coverage,complete}')::boolean,false) as complete
    from combined
  )
  select coalesce(jsonb_object_agg(key,jsonb_build_object(
    'uniqueOrderCount',case when not unavailable then order_count end,
    'uniqueOrderAmount',case when not unavailable then order_amount end,
    'uniqueSuccessCount',case when not unavailable then success_count end,
    'uniqueSuccessAmount',case when not unavailable then success_amount end,
    'uniqueCoverage',jsonb_build_object('status',case when unavailable then 'unavailable' when complete then 'complete' else 'partial' end,
      'complete',complete and not unavailable,'basis','platform_direction_original_order_full_range',
      'detailCount',detail_count,'missingOrderNumberCount',missing_order_number_count,'missingDetailCount',missing_detail_count,
      'detailMismatchCount',detail_mismatch_count,'sourceOrderOnlyCount',source_order_only_count,
      'amountConflictCount',amount_conflict_count,'missingAmountCount',missing_amount_count,'providerConflictCount',provider_conflict_count)
  )),'{}'::jsonb) into v_metrics from flags;

  v_result:=jsonb_set(v_result,'{summary}',coalesce(v_result->'summary','{}'::jsonb)||coalesce(v_metrics->'summary','{}'::jsonb));
  v_result:=jsonb_set(v_result,'{byDirection}',coalesce((select jsonb_object_agg(key,value||
    coalesce(v_metrics->jsonb_build_array('direction',key)::text,'{}'::jsonb)) from jsonb_each(coalesce(v_result->'byDirection','{}'::jsonb))),'{}'::jsonb));
  v_result:=jsonb_set(v_result,'{byProvider}',coalesce((select jsonb_agg(r||coalesce(v_metrics->jsonb_build_array('provider',r->>'provider',r->>'direction')::text,'{}'::jsonb) order by ordinality)
    from jsonb_array_elements(coalesce(v_result->'byProvider','[]'::jsonb)) with ordinality rows(r,ordinality)),'[]'::jsonb));
  v_result:=jsonb_set(v_result,'{byPlatformProvider}',coalesce((select jsonb_agg(r||coalesce(v_metrics->jsonb_build_array('platform',r->>'countryCode',
      private.dashboard_admin_live_workorder_platform_key(r->>'countryCode',r->>'sourcePlatform'),r->>'provider',r->>'direction')::text,'{}'::jsonb) order by ordinality)
    from jsonb_array_elements(coalesce(v_result->'byPlatformProvider','[]'::jsonb)) with ordinality rows(r,ordinality)),'[]'::jsonb));
  return v_result||jsonb_build_object('uniqueOrderVersion',1);
end;
$$;
revoke all on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) from public,anon,authenticated;

-- Keep the currently deployed summary engine rather than copying an older
-- version over its alias, coverage or platform-identity fixes.
do $patch$
declare definition text; anchor text:='  return v_result;';
begin
  select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) into definition;
  if position('private.dashboard_admin_live_workorder_unique_totals(p_request,v_result)' in definition)>0 then return; end if;
  if position('''byPlatformProvider''' in definition)=0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Original-order summary baseline changed; review before applying';
  end if;
  execute replace(definition,anchor,'  return private.dashboard_admin_live_workorder_unique_totals(p_request,v_result);');
end;
$patch$;
notify pgrst,'reload schema';
commit;
