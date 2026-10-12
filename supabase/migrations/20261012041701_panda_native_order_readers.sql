-- Panda native details; old snapshots and Google imports remain unchanged.
-- Generated from captured production pg_get_functiondef; never apply against drift.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Prerequisite: operations/panda_provider_names_index.sql must have completed
-- outside a transaction. Never create/rebuild an ordinary blocking index here.
do $index_guard$
begin
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.panda_orders_provider_names_idx')
  and i.indrelid='public.panda_order_details'::regclass and i.indisvalid and i.indisready
  and not i.indisunique and i.indnkeyatts=3 and i.indnatts=3 and i.indpred is null and i.indexprs is null
  and pg_get_indexdef(i.indexrelid)='CREATE INDEX panda_orders_provider_names_idx ON public.panda_order_details USING btree (platform, direction, provider_name)') then
  raise exception 'panda_provider_names_index_missing_or_invalid';end if;
end;$index_guard$;

-- Only private adapters; browser access stays behind the existing authorized RPCs.
create function private.dashboard_admin_panda_capabilities(p_direction text default 'all')
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('sourceDetailSystem','PANDA','sourceNativeDetail',true,'sourcePriority','native_details_only',
 'systemOrderId',false,'thirdPartyOrderNumber',false,'utr',false,'actualAmount',true,'recordedFee',true,
 'historicalFees',false,'amountBasis','source_amount_minor_div_100',
 'successTimeAvailable',false,'chargeSuccessTimeAvailable',false,'withdrawSuccessTimeAvailable',false,
 'sourceCompletedTimeAvailable',true,'chargeSourceCompletedTimeAvailable',true,'withdrawSourceCompletedTimeAvailable',false,
 'sourceCompletionTimeBasis','source_completed_at','successCoverageAvailable',false,
 'successTimeBasis','source_completed_at','successCohort','unavailable_without_complete_success_window_receipts',
 'paymentSuccessTimeAvailable',false,'customerPaymentTime',false,
 'latencyAvailable',false,'chargeLatencyAvailable',false,'withdrawLatencyAvailable',false,
 'latencyBasis','order_processing_duration','reviewedWithdrawalsOnly',true,
 'pendingBasis','selected_created_cohort_current_stored_status','sourceCompletenessVerified',false,
 'coverageBasis','strict_created_scan_receipts','memberDailyAvailable',false,'memberIdentity',false,
 'analysisOrdersAvailable',true,'autoWithdrawAvailable',false,'operatorAvailable',false,
 'workordersAvailable',false,'pendingSnapshotAvailable',false);
$$;
create function private.dashboard_admin_panda_provider(p_name text)
returns text language sql immutable set search_path='' as $$select coalesce(nullif(btrim(p_name),''),'未识别通道')$$;
-- Loose index walk: one seek per distinct raw provider and direction. Never
-- canonicalize or DISTINCT every historical order just to populate a filter.
create function private.dashboard_admin_panda_provider_names(p_label text,p_direction text)
returns table(provider text) language sql stable set search_path='' set jit='off' as $$
 with recursive scopes as (
  select s.platform,d.direction from panda_private.order_scopes s
  cross join unnest(case p_direction when 'all' then array['deposit','reviewed_withdrawal']
   when 'charge' then array['deposit'] when 'withdraw' then array['reviewed_withdrawal'] else array[]::text[] end)d(direction)
  where s.platform_label=p_label and s.country_code='BR' and s.region_id=1
 ), names(platform,direction,name) as (
  select s.platform,s.direction,(select o.provider_name from public.panda_order_details o
   where o.platform=s.platform and o.direction=s.direction and o.provider_name is not null order by o.provider_name limit 1)
  from scopes s
  union all
  select n.platform,n.direction,(select o.provider_name from public.panda_order_details o
   where o.platform=n.platform and o.direction=n.direction and o.provider_name>n.name order by o.provider_name limit 1)
  from names n where n.name is not null
 ) select distinct private.dashboard_admin_panda_provider(name) from names where name is not null
 union
 select '未识别通道' from scopes s where exists(select 1 from public.panda_order_details o
  where o.platform=s.platform and o.direction=s.direction and o.provider_name is null);
$$;
create function private.dashboard_admin_panda_order_source()
returns text language sql immutable set search_path='' as $function$
select $source$
 select md5(jsonb_build_array('PANDA',s.platform,o.direction,o.order_id)::text)::uuid id,
 null::text system_order_id,o.order_id order_number,null::text third_party_order_number,null::text member_id,
 private.dashboard_admin_panda_provider(o.provider_name) provider,
 coalesce(nullif(btrim(o.channel_name),''),'其他类型') channel_type,
 case o.direction when 'deposit' then 'charge' else 'withdraw' end direction,
 o.raw_status status,o.status status_group,o.created_at,
 case when o.direction='deposit' and o.status='success' and isfinite(o.completed_at)
  and o.completed_at>=o.created_at and o.completed_at<=least(o.observed_at,$20) then o.completed_at end success_at,
 o.amount_minor::numeric/100 amount,o.pay_amount_minor::numeric/100 actual_amount,
 o.fee_minor::numeric/100 withdraw_fee,o.currency,o.received_at synced_at,null::text utr,
 private.dashboard_admin_panda_provider(o.provider_name) raw_provider
 from panda_private.order_scopes s join public.panda_order_details o on o.platform=s.platform
 where s.platform_label=$22 and s.country_code='BR' and s.region_id=1 and s.currency='BRL'
 and $3 in('BR','BR_PANGHU') and o.currency='BRL'
 and o.direction=any(case $7 when 'all' then array['deposit','reviewed_withdrawal'] when 'charge' then array['deposit'] else array['reviewed_withdrawal'] end)
 and o.created_at >= $5 and o.created_at < $6
 and ($10 is null or o.order_id=$10)
$source$;
$function$;

-- Receipts certify scan membership, not a historic status or money snapshot.
-- Reconcile current creation membership so late rows cannot leave an old receipt
-- falsely complete. Mutable status/amount/row_hash intentionally do not invalidate it.
create function private.dashboard_admin_panda_range_evidence(p_label text,p_direction text,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable set search_path='' set jit='off' as $$
declare v_platform text;v_type text;v_count bigint;v_seen timestamptz;v_covered boolean;v_receipts bigint;v_observed timestamptz;v_budget boolean;
begin
 if p_direction not in('charge','withdraw') or p_start is null or p_end is null
  or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end then
  raise exception using errcode='22023',message='invalid_panda_coverage_scope';end if;
 select platform into strict v_platform from panda_private.order_scopes
  where platform_label=p_label and country_code='BR' and region_id=1 and currency='BRL';
 v_type:=case p_direction when 'charge' then 'deposit' else 'reviewed_withdrawal' end;
 select count(*),max(received_at) into v_count,v_seen from (select received_at from public.panda_order_details
  where platform=v_platform and direction=v_type and created_at>=p_start and created_at<p_end limit 250001) bounded;
 if v_count>250000 then return jsonb_build_object('direction',p_direction,'startAt',p_start,'endAt',p_end,
  'timeBasis','created_at','statisticBasis','current_stored_status','count',null,'rowCountLowerBound',250001,
  'received',true,'complete',false,'zeroConfirmed',false,'latestCollectedAt',null,'seen',null,
  'createdCoverageAvailable',true,'verificationBudgetExceeded',true,'status','received',
  'coverageScope',case when p_direction='withdraw' then 'reviewed_withdrawal_list_only' else 'deposit_orders' end,
  'evidence','panda_coverage_verification_budget_exceeded');end if;
 with received as materialized (
  select r.* from public.panda_order_coverage_receipts r join panda_private.order_scans s on s.scan_id=r.scan_id
   and s.platform=r.platform and s.direction=r.direction and s.window_axis=r.window_axis
   and s.window_start=r.window_start and s.window_end=r.window_end and s.observed_at=r.observed_at
  where r.platform=v_platform and r.direction=v_type and r.window_axis='created_at'
   and r.row_axis_bounds_verified and r.coverage_kind='row_axis_verified' and s.finalized_at is not null
   and r.expected_count>=0 and r.window_start<r.window_end and r.window_start<p_end and r.window_end>p_start
   and isfinite(r.window_start) and isfinite(r.window_end) and r.window_end<=r.observed_at
   and r.observed_at<=statement_timestamp() and r.received_at<=statement_timestamp()
 ), candidates as materialized (
  -- Cumulative half-hour receipts overlap. Prefer a containing, newer/equal
  -- scan and reconcile it once. If it fails, return partial rather than retry
  -- hundreds of redundant historical scans during the same page read.
  select c.* from received c where not exists(select 1 from received n
   where n.scan_id<>c.scan_id and n.window_start<=c.window_start and n.window_end>=c.window_end
    and n.observed_at>=c.observed_at
    and (n.window_start<c.window_start or n.window_end>c.window_end or n.observed_at>c.observed_at or n.scan_id>c.scan_id))
 ), budget as (select count(*)<=64 and coalesce(sum(expected_count),0)<=250000 as allowed from candidates), valid as (
  select c.* from candidates c where case when (select allowed from budget) then
   c.expected_count=(select count(*) from (select 1 from panda_private.order_scan_members m where m.scan_id=c.scan_id limit c.expected_count+1) bounded)
   and c.expected_count=(select count(*) from (select 1 from public.panda_order_details d where d.platform=v_platform and d.direction=v_type and d.created_at>=c.window_start and d.created_at<c.window_end limit c.expected_count+1) bounded)
   and c.expected_count=(select count(*) from (select 1 from panda_private.order_scan_members m join public.panda_order_details d
    on d.platform=v_platform and d.direction=v_type and d.order_id=m.order_id and d.created_at=m.axis_value
    where m.scan_id=c.scan_id and m.axis_value>=c.window_start and m.axis_value<c.window_end limit c.expected_count+1) bounded)
   else false end
 ) select coalesce(range_agg(tstzrange(window_start,window_end,'[)')) @> tstzrange(p_start,p_end,'[)'),false),
 count(*),max(observed_at),greatest(v_seen,max(received_at)),(select allowed from budget) into v_covered,v_receipts,v_observed,v_seen,v_budget from valid;
 return jsonb_build_object('direction',p_direction,'startAt',p_start,'endAt',p_end,
 'timeBasis','created_at','statisticBasis','current_stored_status','count',v_count,'received',v_count>0 or v_covered,
 'complete',v_covered,'zeroConfirmed',v_covered and v_count=0,'latestCollectedAt',v_seen,'seen',v_seen,
 'lastVerifiedObservationAt',v_observed,'verifiedReceipts',v_receipts,'verificationBudgetExceeded',not v_budget,
 'createdCoverageAvailable',true,'coverageScope',case when p_direction='withdraw' then 'reviewed_withdrawal_list_only' else 'deposit_orders' end,
 'status',case when v_covered then 'complete' when v_count>0 then 'received' else 'unverified' end,
 'evidence',case when v_covered and v_count=0 then 'panda_created_receipts_zero_confirmed'
  when v_covered then 'panda_created_receipts_complete' when not v_budget then 'panda_coverage_verification_budget_exceeded' else 'panda_created_receipts_incomplete' end);
end;$$;
create function private.dashboard_admin_panda_day_evidence(p_label text,p_direction text,p_day date)
returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb;s timestamptz;e timestamptz;
begin
 s:=p_day::timestamp at time zone 'America/Sao_Paulo';e:=(p_day+1)::timestamp at time zone 'America/Sao_Paulo';
 r:=private.dashboard_admin_panda_range_evidence(p_label,p_direction,s,e);
 return r||jsonb_build_object('date',p_day,'progress',jsonb_build_array(r));
end;$$;
create function private.dashboard_admin_panda_query_coverage(p_label text,p_direction text,p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('timeBasis','created_at','statisticBasis','current_stored_status',
  'complete',bool_and((r->>'complete')::boolean),'directions',jsonb_agg(r order by r->>'direction'),
  'latestCollectedAt',max((r->>'latestCollectedAt')::timestamptz))
 from (select private.dashboard_admin_panda_range_evidence(p_label,d,p_start,p_end) r
  from unnest(case p_direction when 'all' then array['charge','withdraw'] else array[p_direction] end)d)s;
$$;
create function private.dashboard_admin_panda_order_result(p_result jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb:=p_result;k text;a jsonb;
begin
 for k in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r||case when r?'created_success_count' then jsonb_build_object(
   'created_success_amount',case when (r->>'created_success_count')::bigint=0 then '0' else
    ((r->>'all_amount')::numeric-coalesce(r->>'reviewed_pending_amount',r->>'pending_amount')::numeric-
    (r->>'failed_amount')::numeric-(r->>'rejected_amount')::numeric-(r->>'unknown_amount')::numeric)::text end) else '{}'::jsonb end
   ||case when r?'success_count' then jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false) else '{}'::jsonb end
   ||case when r->>'direction'='withdraw' and r?'success_count' then jsonb_build_object(
    'reviewed_pending_count',coalesce(r->'reviewed_pending_count',r->'pending_count'),
    'reviewed_pending_amount',coalesce(r->'reviewed_pending_amount',r->'pending_amount'),
    'pending_count',null,'pending_amount',null,'pending_count_available',false) else '{}'::jsonb end
   ||case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   ||case when r?'fee_version_state' then jsonb_build_object('fee_version_state','unknown','fee_version_matched_count',null,
    'fee_version_unmatched_count',null,'fee_version_estimated_amount',null) else '{}'::jsonb end order by n),'[]') into a
  from jsonb_array_elements(case when k='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',k],'[]') end) with ordinality x(r,n);
  if k='summary' and v_result?'summary' or k<>'summary' then
   v_result:=jsonb_set(v_result,case when k='summary' then array['summary'] else array['groups',k] end,a,true);end if;
 end loop;
 -- No complete success-time cohort is certified; no duration bucket is exposed.
 for k in select unnest(array['latency','latency_thresholds','latency_custom','pending_age','pending_age_thresholds','pending_age_custom']) loop
  if v_result->'groups'?k then
   select coalesce(jsonb_agg(r order by n),'[]') into a from jsonb_array_elements(v_result#>array['groups',k]) with ordinality x(r,n) where false;
   v_result:=jsonb_set(v_result,array['groups',k],a);end if;
 end loop;
 if v_result?'latencySummary' then
  select coalesce(jsonb_agg(r order by n),'[]') into a from jsonb_array_elements(v_result->'latencySummary') with ordinality x(r,n) where false;
  v_result:=jsonb_set(v_result,'{latencySummary}',a);end if;
 return v_result||jsonb_build_object('nativeSource','PANDA','sourcePolicy','details_only','sourceNativeDetail',true,
  'reviewedWithdrawalsOnly',true,'successTimeBasis','source_completed_at','paymentSuccessTimeAvailable',false);
end;$$;
-- Restore only the reviewed cohort's pending partition before the established
-- alias reducer sums it. The public result is sanitized again immediately after.
create function private.dashboard_admin_panda_alias_input(p_result jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb:=p_result;k text;a jsonb;
begin
 for k in select unnest(array['provider','daily']) loop
  if r->'groups'?k then
   select coalesce(jsonb_agg((x-array['reviewed_pending_count','reviewed_pending_amount'])||
    case when x->>'direction'='withdraw' then jsonb_build_object('pending_count',x->'reviewed_pending_count','pending_amount',x->'reviewed_pending_amount') else '{}'::jsonb end order by n),'[]')
   into a from jsonb_array_elements(r#>array['groups',k]) with ordinality e(x,n);
   r:=jsonb_set(r,array['groups',k],a);end if;
 end loop;
 return r;
end;$$;
revoke all on function private.dashboard_admin_panda_capabilities(text),private.dashboard_admin_panda_provider(text),
 private.dashboard_admin_panda_provider_names(text,text),
 private.dashboard_admin_panda_order_source(),private.dashboard_admin_panda_range_evidence(text,text,timestamptz,timestamptz),
 private.dashboard_admin_panda_day_evidence(text,text,date),private.dashboard_admin_panda_query_coverage(text,text,timestamptz,timestamptz),
 private.dashboard_admin_panda_order_result(jsonb),private.dashboard_admin_panda_alias_input(jsonb) from public,anon,authenticated,service_role;


do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'4bf732e393208d69b6f61b1cb2dbe8d4' or md5(pg_get_functiondef(p.oid))<>'67f99ed335510cb34b86f208d3f2442d' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_query_raw';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_query_raw(p_request jsonb DEFAULT '{"action": "catalog"}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_fee_country text; v_fee_currency_proven boolean := false;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if p_request ? 'view' and (jsonb_typeof(p_request->'view')<>'string' or p_request->>'view' not in ('full','providers') or v_action<>'aggregate') then
    raise exception using errcode='22023',message='invalid_view';
  end if;
  if v_action not in ('catalog','query','aggregate','details') then raise exception using errcode='22023',message='invalid_action'; end if;
  if v_action='catalog' then
    if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_catalog_request'; end if;
    return jsonb_build_object('version',1,'asOf',v_asof,'platforms',(
      select coalesce(jsonb_agg((p-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',p->'scope_group','sourceName',p->'source_name',
        'capabilities',jsonb_build_object('systemOrderId',p->>'source'='newar','thirdPartyOrderNumber',p->>'source' in ('newar','game66'),'utr',false,
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='panda' then private.dashboard_admin_panda_capabilities()
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
      from jsonb_array_elements(v_options) p));
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  -- Fee evidence is stricter than the legacy display projection. In particular
  -- a country-default AR currency is not source currency proof.
  v_fee_country:=v_platform.scope_group;
  if v_platform.source='ar' then
    v_fee_currency_proven:=exists(select 1 from public.ar_config_targets t
      where t.source_system='AR' and t.country_code=v_platform.scope_group and t.platform=v_platform.source_name
        and nullif(btrim(t.currency),'') is not null and t.currency=v_platform.currency);
  elsif v_platform.source in ('newar','wg') then
    -- These adapters project each order's explicit native currency.
    v_fee_currency_proven:=true;
  elsif v_platform.source='lg' then
    -- Existing confirmed LG adapters have an explicit currency contract; no
    -- generic country fallback or unknown-country adapter may price orders.
    v_fee_currency_proven:=case v_platform.scope_group when 'PH' then v_platform.currency='PHP'
      when 'ID' then v_platform.currency='IDR' when 'PK' then v_platform.currency='PKR' else false end;
  elsif v_platform.source='game66' then
    -- GAME66's source scope identifies the owning team, while its native
    -- monetary unit is explicitly INR. Authorization still uses that scope.
    v_fee_country:='IN';
    v_fee_currency_proven:=v_platform.scope_group in ('HK_TEAM','RED_CRAB') and v_platform.currency='INR';
  end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',true,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    if position($ar_guard$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,false);
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with orders as ('||v_source||'), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      -- Disjoint amount ranges with the labels used by the admin UI. Integer
      -- boundaries are explicit: 100–200, 201–300, and so on. Every order
      -- remains in exactly one range; low/missing values stay visible.
      case when (case when direction='charge' then $25::numeric[] else $26::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $25::numeric[] else $26::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms,
      case when direction='withdraw' and status_group='pending' and created_at<=$20 then extract(epoch from $20-created_at)*1000 end as pending_wait_ms
    from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
  ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,
      case when grouping(local_date)=0 then 'daily' when grouping(local_hour,amount_bucket)=0 then 'matrix'
        when grouping(local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      count(*) as all_count,case when count(amount)=count(*) then sum(amount) end as all_amount,
      count(*) filter(where amount is null) as missing_amount_count,
      count(*) filter(where amount<0) as negative_amount_count,
      count(*) filter(where status_group='success') as created_success_count,
      0::bigint as success_count,0::numeric as success_amount,
      count(*) filter(where status_group='pending') as pending_count,
      case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending') then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
      count(*) filter(where status_group='failed') as failed_count,
      case when count(amount) filter(where status_group='failed')=count(*) filter(where status_group='failed') then coalesce(sum(amount) filter(where status_group='failed'),0) end as failed_amount,
      count(*) filter(where status_group='rejected') as rejected_count,
      case when count(amount) filter(where status_group='rejected')=count(*) filter(where status_group='rejected') then coalesce(sum(amount) filter(where status_group='rejected'),0) end as rejected_amount,
      count(*) filter(where status_group='unknown') as unknown_count,
      case when count(amount) filter(where status_group='unknown')=count(*) filter(where status_group='unknown') then coalesce(sum(amount) filter(where status_group='unknown'),0) end as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and created_in_range and $8<>'success'
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,local_date),(direction,currency,local_hour),
      (direction,currency,amount_bucket),(direction,currency,local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,local_hour,amount_range_bucket))
  ), success_metrics as (
    select direction,currency,provider,success_local_date as local_date,success_local_hour as local_hour,amount_bucket,amount_range_bucket,
      case when grouping(success_local_date)=0 then 'daily' when grouping(success_local_hour,amount_bucket)=0 then 'matrix'
        when grouping(success_local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(success_local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      case when $8='success' then count(*) else 0 end as all_count,
      case when $8='success' then case when count(amount)=count(*) then sum(amount) end else 0 end as all_amount,
      case when $8='success' then count(*) filter(where amount is null) else 0 end as missing_amount_count,
      case when $8='success' then count(*) filter(where amount<0) else 0 end as negative_amount_count,
      0::bigint as created_success_count,
      count(*) as success_count,
      case when count(amount)=count(*) then coalesce(sum(amount),0) end as success_amount,
      0::bigint as pending_count,0::numeric as pending_amount,
      0::bigint as failed_count,0::numeric as failed_amount,
      0::bigint as rejected_count,0::numeric as rejected_amount,
      0::bigint as unknown_count,0::numeric as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and status_group='success' and success_in_range and $8 in ('all','success')
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,success_local_date),(direction,currency,success_local_hour),
      (direction,currency,amount_bucket),(direction,currency,success_local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,success_local_hour,amount_range_bucket))
  ), metrics_raw as (
    select * from created_metrics union all select * from success_metrics
  ), metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind,
      sum(all_count)::bigint as all_count,
      case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
      sum(missing_amount_count)::bigint as missing_amount_count,
      sum(negative_amount_count)::bigint as negative_amount_count,
      sum(created_success_count)::bigint as created_success_count,
      sum(success_count)::bigint as success_count,
      case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
      sum(pending_count)::bigint as pending_count,
      case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
      sum(failed_count)::bigint as failed_count,
      case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
      sum(rejected_count)::bigint as rejected_count,
      case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
      sum(unknown_count)::bigint as unknown_count,
      case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
      max(latest_synced_at) as latest_synced_at
    from metrics_raw
    group by direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind
  ), metric_json as (
    select kind,(to_jsonb(m)-array['kind','local_date','local_hour','amount_bucket','amount_range_bucket','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])
      || jsonb_build_object('date',local_date,'hour',local_hour,'bucket',coalesce(amount_range_bucket,amount_bucket),'all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,'failed_amount',failed_amount::text,
        'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
  ), time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2),
  duration_rows as materialized (
    select direction,currency,amount,
      case when status_group='success' then 'latency'::text else 'pending_age'::text end as kind,
      case when status_group='success' then latency_ms else pending_wait_ms end as duration_ms,
      case when status_group='success' then
        case when success_at is null then 'missing_success_at' when not isfinite(success_at) then 'invalid_success_at'
          when success_at<created_at then 'reversed_time' when success_at>$20 then 'future_success_at' end
        else case when created_at>$20 then 'future_created_at' end end as excluded_reason
    from filtered where $19<>'details' and ((status_group='success' and success_in_range)
      or (direction='withdraw' and status_group='pending' and created_in_range))
  ), duration_summary as (
    select kind,direction,currency,count(*) as candidate_count,
      count(duration_ms) as valid_count,count(*) filter(where duration_ms is null) as excluded_count,
      case when count(amount) filter(where duration_ms is not null)=count(duration_ms)
        then coalesce(sum(amount) filter(where duration_ms is not null),0) end as valid_amount,
      count(*) filter(where duration_ms is not null and amount is null) as missing_amount_count,
      jsonb_build_object('missing_success_at',count(*) filter(where excluded_reason='missing_success_at'),
        'invalid_success_at',count(*) filter(where excluded_reason='invalid_success_at'),
        'reversed_time',count(*) filter(where excluded_reason='reversed_time'),
        'future_success_at',count(*) filter(where excluded_reason='future_success_at'),
        'future_created_at',count(*) filter(where excluded_reason='future_created_at')) as excluded_reasons,
      avg(duration_ms) as mean_ms,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,
      percentile_cont(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms
    from duration_rows group by kind,direction,currency
  ), duration_bucket_totals as materialized (
    -- Classify each valid order once. Maxima are inclusive; subsequent bins
    -- have strict lower bounds. No join of every order to every threshold.
    select kind,direction,currency,
      case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket,
      count(*) as count,count(*) filter(where amount is null) as missing_amount_count,
      coalesce(sum(amount),0) as known_amount
    from duration_rows where duration_ms is not null group by 1,2,3,4
  ), duration_bins as materialized (
    select s.kind,s.direction,s.currency,b.bucket,b.min_ms,b.max_ms,coalesce(r.count,0) as count,
      case when coalesce(r.missing_amount_count,0)=0 then coalesce(r.known_amount,0) end as amount,
      s.valid_count,s.valid_amount
    from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r
      on r.kind=s.kind and r.direction=s.direction and r.currency is not distinct from s.currency and r.bucket=b.bucket
  ), duration_thresholds as (
    -- Only ten tiny aggregate bins are scanned here. Excluding the current
    -- inclusive bin makes these cumulative values strictly > threshold.
    select kind,direction,currency,bucket,max_ms as threshold_ms,
      coalesce(sum(count) over tail,0) as count,
      case when count(*) filter(where amount is null) over tail=0 then coalesce(sum(amount) over tail,0) end as amount,
      valid_count,valid_amount
    from duration_bins
    window tail as (partition by kind,direction,currency order by bucket rows between 1 following and unbounded following)
  ), duration_json as (
    select kind,false as cumulative,bucket,(to_jsonb(b)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_bins b
    union all
    select kind,true,bucket,(to_jsonb(t)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end)
    from duration_thresholds t where threshold_ms is not null
  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,provider,raw_provider,channel_type,direction,status,status_group,
      created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,currency,synced_at,utr,latency_ms,pending_wait_ms
    from filtered where $19<>'aggregate'
      and ($8<>'success' or (status_group='success' and success_in_range))
      order by case when $8='success' then success_at else created_at end desc,direction desc,id desc limit $18 offset $17
  ) select jsonb_build_object('total',(select case when $8='success'
      then count(*) filter(where status_group='success' and success_in_range)
      else count(*) filter(where created_in_range) end from filtered),
    'summary',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from metric_json where kind='summary'),'[]'::jsonb),
    'groups',jsonb_build_object(
      'provider',coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='provider'),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(value order by value->>'date',value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='daily'),'[]'::jsonb),
      'hourly',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'direction',value->>'currency') from metric_json where kind='hourly'),'[]'::jsonb),
      'amount',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount'),'[]'::jsonb),
      'matrix',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix'),'[]'::jsonb),
      'amount_range',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount_range'),'[]'::jsonb),
      'matrix_range',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix_range'),'[]'::jsonb),
      'latency',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and not cumulative),'[]'::jsonb),
      'latency_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and cumulative),'[]'::jsonb),
      'pending_age',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and not cumulative),'[]'::jsonb),
      'pending_age_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,
    'latencySummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='latency'),'[]'::jsonb),
    'pendingSummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='pending_age'),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when $8='success' then success_at else created_at end desc,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;

  -- Provider pages do not need the eight chart grouping sets or duration bins.
  -- Reuse exactly the same scoped source and predicates, with two grouping sets.
  if p_request->>'view'='providers' and v_action='aggregate' then
    if v_status<>'all' then raise exception using errcode='22023',message='unsupported_filter';end if;
    v_sql:='with orders as ('||v_source||$q$), filtered as materialized (
      select direction,currency,provider,channel_type,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (success_at >= $5 and success_at < $6 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as (
      select direction,currency,provider,case when grouping(provider)=0 then 'provider' else 'summary' end as kind,
        count(*) filter(where created_in_range) as all_count,
        case when count(*) filter(where created_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range),0) end as all_amount,
        count(*) filter(where created_in_range and amount is null) as missing_amount_count,
        count(*) filter(where created_in_range and amount<0) as negative_amount_count,
        count(*) filter(where created_in_range and status_group='success') as created_success_count,
        count(*) filter(where success_in_range) as success_count,
        case when count(*) filter(where success_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where success_in_range),0) end as success_amount,
        count(*) filter(where created_in_range and status_group='pending') as pending_count,
        case when count(*) filter(where created_in_range and status_group='pending' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='pending'),0) end as pending_amount,
        count(*) filter(where created_in_range and status_group='failed') as failed_count,
        case when count(*) filter(where created_in_range and status_group='failed' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='failed'),0) end as failed_amount,
        count(*) filter(where created_in_range and status_group='rejected') as rejected_count,
        case when count(*) filter(where created_in_range and status_group='rejected' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='rejected'),0) end as rejected_amount,
        count(*) filter(where created_in_range and status_group='unknown') as unknown_count,
        case when count(*) filter(where created_in_range and status_group='unknown' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='unknown'),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from filtered group by grouping sets ((direction,currency),(direction,currency,provider))
    ), output as (
      select kind,(to_jsonb(m)-'kind')||jsonb_build_object('all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,
        'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
    ) select jsonb_build_object('total',(select count(*) from filtered where created_in_range),
      'summary',coalesce((select jsonb_agg(value) from output where kind='summary'),'[]'::jsonb),
      'groups',jsonb_build_object('provider',coalesce((select jsonb_agg(value order by value->>'provider')
        from output where kind='provider'),'[]'::jsonb)),'rows','[]'::jsonb)
    $q$;
    -- ar_provider_fee_fold_v1: unchanged facts, one fewer filtered scan.
    if v_platform.source='ar' then
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,'')))/length($ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,$ar_fee_fold_0$$ar_fee_fold_0$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,'')))/length($ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,$ar_fee_fold_1$max(synced_at) as latest_synced_at,
        jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts$ar_fee_fold_1$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,'')))/length($ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,$ar_fee_fold_2$(to_jsonb(m)-array['kind','fee_facts'])$ar_fee_fold_2$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,'')))/length($ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,$ar_fee_fold_3$case when m.kind='provider' then m.fee_facts else '{}'::jsonb end$ar_fee_fold_3$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,'')))/length($ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,$ar_fee_fold_4$$ar_fee_fold_4$);
    end if;
  end if;

  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg');
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_action='details' and v_platform.source='ar' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_query_raw';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'883efa90f2544edf5c1e8813faaa3029' or md5(pg_get_functiondef(p.oid))<>'f7bcac626974c807c41a80a41d424bc7' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_drilldown_raw';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_drilldown_raw(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','hourRange','amountBands','durationVersion','durationRange','offset','limit','view','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if v_action<>'aggregate' or p_request->>'view' is distinct from 'drilldown' then
    raise exception using errcode='22023',message='invalid_drilldown_view';
  end if;
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind not in('hourly','custom') then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$'))) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    elsif p_request?'bucket' then raise exception using errcode='22023',message='unexpected_drilldown_bucket';end if;
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' or v_offset<>0 then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    if v_kind='latency' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      if position($ar_guard$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($25='latency' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,v_kind='latency');
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($25='latency' and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($25='latency' and w.status_code='3' and w.update_time>=$5 and w.update_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;

  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs. Keep all successful-window candidates,
    -- including invalid durations and other bins, for independent denominators.
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
      select provider,direction,currency,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (success_at at time zone $4)::date as success_local_date,
        case when status_group='success' and isfinite(created_at) and isfinite(success_at) and success_at>=created_at and success_at<=$20
          then extract(epoch from success_at-created_at)*1000 end as latency_ms
      from orders where ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
    )
    $q$;
  else
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select provider,direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when (case when direction='charge' then $31::numeric[] else $32::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $31::numeric[] else $32::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
  )
  $q$;
  end if;
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket
      from filtered
    ), provider_names as materialized (
      -- Use the same authoritative mapping as the ordinary provider summary,
      -- once per distinct raw name, never once per order or once per day.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from candidates) names
    ), selected as (
      select c.*,n.provider as canonical_provider,
        latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates c join provider_names n on n.raw_provider=c.provider
    ), metrics as (
      -- Group before selecting the segment: valid_* always includes every valid
      -- successful order for this provider/window, including other duration bins.
      select direction,currency,canonical_provider as provider,success_local_date as date,
        grouping(canonical_provider) as gp,grouping(success_local_date) as gd,
        count(*) filter(where segment_match) as count,
        case when count(*) filter(where segment_match and amount is null)=0
          then coalesce(sum(amount) filter(where segment_match),0) end as amount,
        count(latency_ms) as valid_count,
        case when count(*) filter(where latency_ms is not null and amount is null)=0
          then coalesce(sum(amount) filter(where latency_ms is not null),0) end as valid_amount,
        count(*) as candidate_count,count(*) filter(where latency_ms is null) as excluded_count,
        count(*) filter(where segment_match and amount is null) as missing_amount_count,max(synced_at) as latest_synced_at
      from selected group by grouping sets (
        (direction,currency),(direction,currency,success_local_date),
        (direction,currency,canonical_provider),(direction,currency,canonical_provider,success_local_date))
    ), output as (
      select date,gp,gd,(to_jsonb(m)-array['amount','valid_amount','gp','gd'])||jsonb_build_object(
        'amount',amount::text,'valid_amount',valid_amount::text,'success_count',count,'success_amount',amount::text,
        'bucket',$28,'cumulative',$29,'count_share',count::numeric/nullif(valid_count,0),
        'amount_share',case when valid_amount>0 then amount/valid_amount end)
        ||case when $36 then jsonb_build_object('min_ms',$34::numeric,'max_ms',$35::numeric) else '{}'::jsonb end as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-array['date','provider'] order by value->>'direction',value->>'currency') from output where gp=1 and gd=1),'[]'::jsonb),
      'groups',jsonb_build_object(
        'daily',coalesce((select jsonb_agg(value-'provider' order by date,value->>'direction',value->>'currency') from output where gp=1 and gd=0),'[]'::jsonb),
        'provider',coalesce((select jsonb_agg(value-'date' order by value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=1),'[]'::jsonb),
        'provider_daily',coalesce((select jsonb_agg(value order by date,value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=0),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match
      from filtered
    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), contributions as (
      -- Distinct event clocks: never copy a successful event into creation totals.
      select direction,currency,canonical_provider as provider,local_date as date,1::bigint as all_count,amount as all_amount,
        (amount is null)::integer as missing_amount_count,(amount<0)::integer as negative_amount_count,
        (status_group='success')::integer as created_success_count,0::bigint as success_count,0::numeric as success_amount,
        (status_group='pending')::integer as pending_count,case when status_group='pending' then amount else 0 end as pending_amount,
        (status_group='failed')::integer as failed_count,case when status_group='failed' then amount else 0 end as failed_amount,
        (status_group='rejected')::integer as rejected_count,case when status_group='rejected' then amount else 0 end as rejected_amount,
        (status_group='unknown')::integer as unknown_count,case when status_group='unknown' then amount else 0 end as unknown_amount,synced_at
      from selected where created_match
      union all
      select direction,currency,canonical_provider,success_local_date,0,0,0,0,0,1,amount,0,0,0,0,0,0,0,0,synced_at from selected where success_match
    ), metrics as (
      select direction,currency,provider,date,grouping(provider) as gp,grouping(date) as gd,sum(all_count)::bigint as all_count,
        case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
        sum(missing_amount_count)::bigint as missing_amount_count,coalesce(sum(negative_amount_count),0)::bigint as negative_amount_count,
        sum(created_success_count)::bigint as created_success_count,sum(success_count)::bigint as success_count,
        case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
        sum(pending_count)::bigint as pending_count,
        case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
        sum(failed_count)::bigint as failed_count,
        case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
        sum(rejected_count)::bigint as rejected_count,
        case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
        sum(unknown_count)::bigint as unknown_count,
        case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from contributions group by grouping sets ((direction,currency),(direction,currency,date),
        (direction,currency,provider),(direction,currency,provider,date))
    ), output as (
      select date,gp,gd,(to_jsonb(m)-array['gp','gd','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])||jsonb_build_object(
        'all_amount',all_amount::text,'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-array['date','provider'] order by value->>'direction',value->>'currency') from output where gp=1 and gd=1),'[]'::jsonb),
      'groups',jsonb_build_object(
        'daily',coalesce((select jsonb_agg(value-'provider' order by date,value->>'direction',value->>'currency') from output where gp=1 and gd=0),'[]'::jsonb),
        'provider',coalesce((select jsonb_agg(value-'date' order by value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=1),'[]'::jsonb),
        'provider_daily',coalesce((select jsonb_agg(value order by date,value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=0),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  end if;
  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,case when v_platform.source in('lg','wg','duoli','kb','panda') then v_platform.source_name else v_platform.name end,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis',case when v_kind='latency' then 'success_at' else 'mixed_created_success' end,
    'total',(select coalesce(sum((r->>case when v_kind='latency' then 'count' else 'all_count' end)::bigint),0) from jsonb_array_elements(v_result->'summary') r),
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'complete',true,'hasMore',false,
    'segment',jsonb_strip_nulls(jsonb_build_object('durationRange',case when v_duration_custom then v_duration->'range' end,'durationVersion',case when v_duration_version=2 then 2 end,'kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,'amountMin',case when v_kind='custom' then v_min end,'amountMax',case when v_kind='custom' then v_max end,'amountMaxExclusive',case when v_kind='custom' and v_max is not null then v_max_exclusive end,'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,'cumulative',v_cumulative)),
    'capabilities',v_capabilities);
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_drilldown_raw';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_analysis_orders_raw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'8004c90f28e5b136c79f8773d0558837' or md5(pg_get_functiondef(p.oid))<>'be5fa801d3e369f5b3d6491060950a3b' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_analysis_orders_raw';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_analysis_orders_raw(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_basis text; v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','hourRange','amountBands','durationVersion','durationRange','offset','limit','basis','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request||jsonb_build_object('action','aggregate','view','drilldown'));
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  v_basis:=p_request->>'basis';
  if v_action<>'analysisOrders' or jsonb_typeof(p_request->'basis') is distinct from 'string'
    or v_basis not in ('created','success') then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  -- Keep the independent creation/success source union. The final cohort below
  -- chooses exactly one clock, including success events created on another day.
  v_action:='aggregate';
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind not in('hourly','custom') then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$'))) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    elsif p_request?'bucket' then raise exception using errcode='22023',message='unexpected_drilldown_bucket';end if;
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit<>20
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    if v_basis='success' or v_kind='latency' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      if position($ar_guard$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($25='latency' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,v_kind='latency');
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($25='latency' and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($25='latency' and w.status_code='3' and w.update_time>=$5 and w.update_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;

  if v_kind='latency' and v_basis<>'success' then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';
  end if;
  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs. Keep all successful-window candidates,
    -- including invalid durations and other bins, for independent denominators.
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
      select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,status_group,created_at,success_at,actual_amount,withdraw_fee,utr,provider,direction,currency,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (success_at at time zone $4)::date as success_local_date,
        case when status_group='success' and isfinite(created_at) and isfinite(success_at) and success_at>=created_at and success_at<=$20
          then extract(epoch from success_at-created_at)*1000 end as latency_ms
      from orders where ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
    )
    $q$;
  else
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,actual_amount,withdraw_fee,utr,provider,direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when (case when direction='charge' then $31::numeric[] else $32::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $31::numeric[] else $32::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
  )
  $q$;
  end if;
  -- analysis_segment_orders_v1: stable source keys, numeric money, exact count.
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket
      from filtered
    ), provider_names as materialized (
      -- Use the same authoritative mapping as the ordinary provider summary,
      -- once per distinct raw name, never once per order or once per day.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from candidates) names
    ), selected as (
      select c.*,n.provider as canonical_provider,
        latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates c join provider_names n on n.raw_provider=c.provider
    ), eligible as materialized (
      select * from selected where segment_match
    )
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match
      from filtered
    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), eligible as materialized (
      select * from selected where case when $40::text='success' then success_match else created_match end
    )
    $q$;
  end if;
  v_sql:=v_sql||$q$, page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,canonical_provider as provider,raw_provider,
      channel_type,direction,status,status_group,created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,
      currency,synced_at,utr,latency_ms,case when $40::text='success' then success_at else created_at end as event_at
    from eligible
    order by case when $40::text='success' then success_at else created_at end desc nulls last,direction desc,id desc
    limit $18 offset $17
  ) select jsonb_build_object(
    'total',(select count(*) from eligible),
    'hasMore',(select count(*)>$17+$18 from eligible),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by event_at desc nulls last,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;
  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,case when v_platform.source in('lg','wg','duoli','kb','panda') then v_platform.source_name else v_platform.name end,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max,v_basis;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||jsonb_build_object('version',1,'platform',v_meta,'basis',v_basis,
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'offset',v_offset,'limit',v_limit,'complete',true,
    'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,
      'amountMin',v_min,'amountMax',v_max,'amountMaxExclusive',case when v_max is not null then v_max_exclusive end,
      'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,
      'cumulative',v_cumulative,'durationRange',case when v_duration_custom then v_duration->'range' end,
      'durationVersion',v_duration_version)),
    'capabilities',v_capabilities);
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_analysis_orders_raw';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_query(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'12cb31eb672a69a33eb2cceef8aa6c8c' or md5(pg_get_functiondef(p.oid))<>'ced9fb61ac162efa1d634ef0a09d7b54' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_query';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_query(p_request jsonb DEFAULT '{"action": "catalog"}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request jsonb:=private.dashboard_admin_live_expand_provider_filter(p_request);
  v_result jsonb; v_action text; v_country text; v_platform text;
begin
 -- duoli_existing_orders_v1
  v_result:=private.dashboard_admin_live_query_raw(v_request);
  v_action:=coalesce(v_request->>'action','catalog');
  if v_action='catalog' then
    return v_result||jsonb_build_object('withdrawPlatforms',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('scopeGroup',p.scope_group,'sourceName',p.source_name)),'[]'::jsonb) from private.dashboard_admin_live_withdraw_platforms() p));
  end if;
  v_country:=v_result#>>'{platform,country}';
  v_platform:=coalesce(v_result#>>'{platform,sourceName}',v_result#>>'{platform,name}');
  if v_country is null or v_platform is null then return v_result; end if;
  if v_result#>>'{platform,source}'='panda' then v_result:=private.dashboard_admin_panda_alias_input(v_result);end if;
  if v_result#>'{groups,provider}' is not null then
    v_result:=jsonb_set(v_result,'{groups,provider}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,provider}',v_country,v_platform,false),true);
  end if;
  if v_result#>'{groups,daily}' is not null then
    v_result:=jsonb_set(v_result,'{groups,daily}',private.dashboard_admin_live_remap_groups(v_result#>'{groups,daily}',v_country,v_platform,true),true);
  end if;
  if v_action='details' and v_result#>'{rows}' is not null then
    v_result:=jsonb_set(v_result,'{rows}',private.dashboard_admin_live_remap_rows(v_result#>'{rows}',v_country,v_platform),true);
  end if;
  if v_result#>>'{platform,source}'='duoli' then
    v_result:=private.dashboard_admin_duoli_order_result(v_result);
  end if;
  if v_result#>>'{platform,source}'='panda' then v_result:=private.dashboard_admin_panda_order_result(v_result);end if;
  return v_result;
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_query';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_platforms()'::regprocedure;
 if md5(p.prosrc)<>'2f7fb0180ee75ef9b89b1038801fae7d' or md5(pg_get_functiondef(p.oid))<>'e6b80ecdce774383092c8cf48e2dd018' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_platforms';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_platforms()
 RETURNS TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scope jsonb := private.dashboard_admin_live_scope();
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  return query
  with ar_targets as (
    select md5('ar:'||t.country_code||':'||src.platform)::uuid as id,
      coalesce(m.platform_name,t.platform)::text as name,
      case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,
      t.country_name::text as country,t.country_code::text as scope_group,
      'ar'::text as source,
      coalesce(nullif(t.timezone,''),case t.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end)::text as timezone,
      coalesce(nullif(t.currency,''),case t.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end)::text as currency,
      src.platform::text as source_name
    from public.ar_config_targets t
    cross join lateral (
      select case when t.country_code='IN' and upper(btrim(t.platform))='SHREEWIN'
        and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
          and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
        then 'Shree.Win' else t.platform end as platform
    ) src
    left join public.dashboard_platform_team_map m on m.active
      and m.source_system=case when t.source_system='NEW_AR' then 'NEW_AR' else 'AR' end
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now()) offset 0))
  ),
  ar_mapped_only as (
    select md5('ar:'||m.country_code||':'||m.source_platform)::uuid as id,
      m.platform_name::text as name,case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,m.country_name::text as country,
      m.country_code::text as scope_group,'ar'::text as source,
      case m.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end::text as timezone,
      case m.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end::text as currency,
      m.source_platform::text as source_name
    from public.dashboard_platform_team_map m
    where m.active and m.source_system='AR'
      and private.dashboard_scope_allows(v_scope,m.country_code,m.source_platform)
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform)))
  )
  select g.id,g.platform_name,case when upper(btrim(g.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else g.team_name end,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select ar_targets.id,ar_targets.name,ar_targets.team,ar_targets.country,ar_targets.scope_group,ar_targets.source,ar_targets.timezone,ar_targets.currency,ar_targets.source_name from ar_targets
  union all
  select ar_mapped_only.id,ar_mapped_only.name,ar_mapped_only.team,ar_mapped_only.country,ar_mapped_only.scope_group,ar_mapped_only.source,ar_mapped_only.timezone,ar_mapped_only.currency,ar_mapped_only.source_name from ar_mapped_only
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,
    coalesce(m.platform_name,n.platform),case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and upper(btrim(m.source_platform))=upper(btrim(n.platform))
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
  union all
  -- Only real current LG order scopes qualify. The historical raw LG/SUPERLG
  -- report mapping is not a PH order scope and cannot create a duplicate row.
  select md5('lg:'||l.country_code||':'||l.platform)::uuid,
    coalesce(m.platform_name,l.platform),m.team_name,
    case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end,
    l.country_code,'lg'::text,public.lg_country_timezone(l.country_code),
    case l.country_code when 'PH' then 'PHP' when 'ID' then 'IDR' when 'PK' then 'PKR' end,l.platform
  from private.dashboard_admin_live_lg_scopes() l
  left join lateral (
    select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='LG' and t.source_platform=l.platform
      and t.country_code=l.country_code and t.source_country in (l.country_code,
        case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end)
    order by (t.source_country=l.country_code) desc,t.source_country limit 1
  )m on true
  where l.country_code=public.lg_platform_country(l.platform)
    and public.lg_country_timezone(l.country_code) is not null
    and private.dashboard_scope_allows(v_scope,l.country_code,l.platform)

  union all
  select md5('WG:'||w.site_code)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
    'wg'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_wg_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='WG' and t.country_code=w.country_code
      and upper(btrim(t.source_platform))=w.platform
    order by (t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)

  union all
  select md5('duoli:ID:'||w.platform)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
   'duoli'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_duoli_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
   where t.active and t.source_system in('DOLI','REPORT') and t.country_code=w.country_code
    and upper(btrim(t.source_platform))=w.platform
   order by (t.source_system='DOLI') desc,(t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)

 union all
 select md5('kb:IN:YASH.BET')::uuid,coalesce(m.platform_name,'YASH.BET'),m.team_name,'印度'::text,'IN'::text,
  'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text
 from (values(1))s(n)
 left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='KB' and t.country_code='IN' and upper(btrim(t.source_platform))='YASH.BET'
  order by (t.source_country='IN') desc,t.source_country limit 1)m on true
 where private.dashboard_scope_allows(v_scope,'IN','YASH.BET')

 union all
 select md5('panda:BR:'||s.platform)::uuid,s.platform_label,
  coalesce(m.team_name,case when private.dashboard_admin_live_is_panghu_platform(s.platform_label) then '胖虎' end),
  '巴西'::text,private.dashboard_data_group('BR',s.platform_label),'panda'::text,'America/Sao_Paulo'::text,'BRL'::text,s.platform_label
 from panda_private.order_scopes s
 left join lateral (select t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='PANDA' and t.source_platform=s.platform_label
   and t.country_code in('BR','BR_PANGHU') order by t.source_country limit 1)m on true
 where s.country_code='BR' and s.currency='BRL' and s.region_id=1 and s.platform in('platform_12601','platform_12609','platform_13610','platform_16615','platform_170','platform_17530','platform_1930841','platform_208','platform_222vip','platform_2231','platform_2250','platform_2269','platform_2279','platform_231','platform_234t','platform_235','platform_2382','platform_2431','platform_2461','platform_2470','platform_2537','platform_2v222','platform_345f','platform_406','platform_428','platform_447','platform_448','platform_45ff','platform_559k','platform_56l','platform_596','platform_609','platform_613','platform_620','platform_647','platform_67vip','platform_723','platform_737','platform_755','platform_756','platform_759','platform_76pp','platform_776f','platform_798','platform_800','platform_801','platform_802','platform_8566bet','platform_888hh','platform_96f','platform_985','platform_987','platform_998','platform_bet5697')
  and private.dashboard_scope_allows(v_scope,'BR',s.platform_label)
;
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_platforms';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'e75b04a0a9fabc25ac0af5f3625f7c29' or md5(pg_get_functiondef(p.oid))<>'11b90fcc4f86665bfca10c003afba74f' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_provider_options';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_options(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_result jsonb; v_scope jsonb:=private.dashboard_admin_live_scope();
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request-array['platformIds','direction']<>'{}'::jsonb
    or jsonb_typeof(p_request->'platformIds') is distinct from 'array' or jsonb_array_length(p_request->'platformIds')>200
    or coalesce(p_request->>'direction','all') not in('all','charge','withdraw') then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_array_elements(p_request->'platformIds') a where jsonb_typeof(a)<>'string'
    or a#>>'{}' !~ '^[0-9a-fA-F-]{36}$') then raise exception using errcode='22023',message='invalid_filter';end if;
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_request->'platformIds');
  with platforms as materialized (select * from private.dashboard_admin_live_platforms() where id=any(v_ids)),
  scoped as materialized (
    select distinct r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r join platforms p on r.country=p.country and (r.platform=p.name or r.platform=p.source_name)
    where p.source not in('lg','wg','duoli','kb','panda') and private.dashboard_scope_allows(v_scope,r.country,r.platform)
      and (coalesce(p_request->>'direction','all')='all' or case p_request->>'direction' when 'charge' then '代收' else '代付' end=any(r.directions))
  ), name_sets as materialized (
    select distinct country,canonical_values from scoped
  ), names as materialized (
    select country,canonical_values,private.dashboard_admin_live_provider_alias_values(country,canonical_values) as names from name_sets
  ), matches as (
    select distinct coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),
      case when cardinality(n.names)=1 then n.names[1] end,
      nullif(private.dashboard_admin_live_provider_alias(r.country,r.raw_provider),''),'未识别通道') as provider
    from scoped r join names n on n.country=r.country and n.canonical_values=r.canonical_values
    left join private.dashboard_admin_provider_overrides o on o.country=r.country and o.platform=r.platform and o.raw_provider=r.raw_provider
  ), lg_names as materialized (
    -- Provider names come from the collector's small classifications, never a
    -- whole-order scan. Values match the native LG provider projection.
    select distinct p.country,p.source_name,
      coalesce(nullif(btrim(d.third_party),''),nullif(btrim(d.raw_channel),''),'未识别通道') as raw_provider
    from platforms p join public.lg_success_daily d
      on p.source='lg' and d.country_code=p.scope_group and d.platform=p.source_name
    where d.scope_type in ('third_party','channel')
      and d.order_kind=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
  ), yash_names as materialized (
    select p.country,p.source_name,n.supplier
    from platforms p cross join lateral (
      select distinct y.supplier
      from private.yash_orders y
      where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    )n
  ), panda_names as materialized (
    select p.country,p.source_name,n.provider from platforms p
    cross join lateral private.dashboard_admin_panda_provider_names(p.source_name,coalesce(p_request->>'direction','all'))n
    where p.source='panda'
  ), all_matches as (
    -- User-confirmed WG business category; offering a filter does not invent a count.
    select '提现转充值'::text as provider from platforms p
    where p.source='wg' and coalesce(p_request->>'direction','all') in ('all','charge')
    union
    select provider from matches union
    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) from lg_names
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p join private.dashboard_admin_wg_sites()s on p.source='wg' and p.scope_group=s.country_code and p.source_name=s.platform
    cross join lateral (
      select provider from private.dashboard_admin_wg_provider_names(
        s.country_code,s.platform,coalesce(p_request->>'direction','all'))
    )n
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p cross join lateral (
     select distinct private.dashboard_admin_duoli_provider(d.provider_code) provider
     from private.duoli_order_details d where p.source='duoli' and p.scope_group='ID' and d.country='ID' and d.system_name='DOLI' and d.platform=p.source_name
      and d.business=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    )n

    union
    select private.dashboard_admin_live_provider_canonical(country,source_name,private.dashboard_admin_yash_provider(supplier))
    from yash_names
    union
    select private.dashboard_admin_live_provider_canonical(country,source_name,provider) from panda_names
  )
  select jsonb_build_object('providers',coalesce((select jsonb_agg(provider order by provider) from all_matches),'[]'::jsonb),
    'platformCount',(select count(*) from platforms),'basis','existing_classification') into v_result;
  return v_result;
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_provider_options';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'07f145f742067c3a3414ffb1c297f553' or md5(pg_get_functiondef(p.oid))<>'52ce67d656d62a3727e1bf2600ff539a' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_expand_provider_filter';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_expand_provider_filter(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_platform record;
  v_scope jsonb;
  v_selected text[];
  v_raw text[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- A missing key has SQL NULL type, so `type <> 'array'` alone does not return.
  -- All-provider queries must not normalize the entire provider directory.
  if p_request is null or coalesce(jsonb_typeof(p_request->'providers'),'null')<>'array' then
    return p_request;
  end if;
  if jsonb_array_length(p_request->'providers')=0 then return p_request; end if;
  if jsonb_array_length(p_request->'providers')>200 or exists(
    select 1 from jsonb_array_elements(p_request->'providers') a
    where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 200
      or (a#>>'{}') ~ '[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='invalid_filter'; end if;
  begin
    v_id:=(p_request->>'platformId')::uuid;
  exception when others then
    return p_request;
  end;
  if v_id is null then return p_request; end if;
  -- Keep the existing authenticated, active-profile, grant and platform checks.
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then return p_request; end if;
  v_scope:=private.dashboard_admin_live_scope();
  select array_agg(value order by value) into v_selected
    from jsonb_array_elements_text(p_request->'providers') value;
  if v_platform.source='panda' then
    with names as materialized (
     select provider from private.dashboard_admin_panda_provider_names(v_platform.source_name,coalesce(p_request->>'direction','all'))
    ), matches as (
     select unnest(v_selected) provider union select provider from names
     where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,provider)=any(v_selected)
    ) select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='kb' then
    with names as materialized (
     select distinct private.dashboard_admin_yash_provider(y.supplier) provider
     from private.yash_orders y where v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and y.source_site='yash'
      and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    ), matches as (
     select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='duoli' then
    with names as materialized (
     select distinct private.dashboard_admin_duoli_provider(d.provider_code) provider
     from private.duoli_order_details d where d.platform=v_platform.source_name and v_platform.scope_group='ID' and d.country='ID' and d.system_name='DOLI'
      and d.business=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    ), matches as (
     select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='wg' then
    with names as materialized (
      -- Canonicalize once per distinct native name, never once per historical order.
      -- The shared helper enumerates every raw name by the existing site/provider index.
      select provider from private.dashboard_admin_wg_provider_names(
        v_platform.scope_group,v_platform.source_name,coalesce(p_request->>'direction','all'))
    ), matches as (
      select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='newar' then
    declare
      native_start timestamptz; native_end timestamptz;
      native_direction text:=coalesce(p_request->>'direction','all');
      native_success boolean:=coalesce(p_request->>'action','catalog')='aggregate' or coalesce(p_request->>'status','all')='success';
    begin
      -- The original reader still validates the request. Never enumerate native
      -- orders for malformed/unbounded input before it reaches that validator.
      if native_direction not in ('all','charge','withdraw')
        or coalesce(jsonb_typeof(p_request->'startAt'),'null')<>'string'
        or coalesce(jsonb_typeof(p_request->'endAt'),'null')<>'string' then return p_request; end if;
      begin
        native_start:=(p_request->>'startAt')::timestamptz;
        native_end:=(p_request->>'endAt')::timestamptz;
      exception when others then return p_request; end;
      if native_start is null or native_end is null or not isfinite(native_start) or not isfinite(native_end)
        or native_end<=native_start or native_end-native_start>interval '32 days' then return p_request; end if;
      with native_rows as materialized (
        -- Separate creation/success branches use the existing time indexes.
        -- Both are required for historical orders that succeeded on this day.
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=v_platform.source_name and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.created_at>=native_start and n.created_at<native_end
          and (t.launch_at is null or n.created_at>=t.launch_at)
        union all
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where native_success and n.platform=v_platform.source_name
          and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.status_group='success' and n.success_at is not null and n.success_at>=native_start and n.success_at<native_end
          and (t.launch_at is null or n.created_at>=t.launch_at)
      ), native_names as materialized (
        -- Exactly the same native labels as the existing order engine.
        select distinct case when dataset='charge' and coalesce(btrim(provider),'')='' and channel_type='ManualRecharge' then '人工充值'
          when dataset='withdraw' and status_group in ('failed','rejected') and coalesce(btrim(provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(provider),''),'未识别通道') end provider from native_rows
      ), matches as (
        select unnest(v_selected) provider
        union select n.provider from native_names n
          where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
      ) select array_agg(distinct provider order by provider) into v_raw from matches;
      return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
    end;
  end if;
  if v_platform.source='lg' then
    with names as materialized (
      select distinct coalesce(nullif(btrim(d.third_party),''),nullif(btrim(d.raw_channel),''),'未识别通道') as provider
      from public.lg_success_daily d
      where d.country_code=v_platform.scope_group and d.platform=v_platform.source_name
        and d.scope_type in ('third_party','channel')
        and d.order_kind=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    ), matches as (
      select unnest(v_selected) as provider union
      select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    ) select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  with scoped as materialized (
    -- Restrict by the registry's indexed country/platform before evaluating
    -- aliases; provider_rows() materializes all authorized platforms first.
    select r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r
    where r.country=v_platform.country
      and r.platform=any(array[v_platform.name,v_platform.source_name]::text[])
      and private.dashboard_scope_allows(v_scope,r.country,r.platform)
  ), normalized as materialized (
    select r.country,r.platform,r.raw_provider,
      case when private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider) is not null
        then array[private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)]
        else private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) end canonical_values
    from scoped r
  ), mapped as (
    select value as raw_provider from unnest(v_selected) value
    union
    select coalesce(nullif(r.raw_provider,''),'未识别通道')
    from normalized r
    left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    where coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      case when cardinality(r.canonical_values)=1 then r.canonical_values[1] end)=any(v_selected)
  )
  select array_agg(distinct raw_provider order by raw_provider) into v_raw from mapped;
  return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
end;
$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_expand_provider_filter';end if;
end;$guard$;

do $guard$
declare p record;old_acl aclitem[];old_owner oid;v_oid oid;
begin
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'a6146e3dfa27ea0102fb77a5b929a09e' or md5(pg_get_functiondef(p.oid))<>'d9b18e57254eeef33810143acd288f76' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proowner::regrole::text<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""','jit=off']::text[] or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
  raise exception 'panda_native_reader_contract_drift: dashboard_admin_live_intake_coverage';end if;
 old_acl:=p.proacl;old_owner:=p.proowner;v_oid:=p.oid;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_intake_coverage(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_asof timestamptz:=statement_timestamp();v_operation text:=coalesce(p_request->>'operation','catalog');v_feeds jsonb;v_feed jsonb;v_ids text[];v_rows jsonb:='[]';v_result jsonb;
 -- LG_WINDOW_COVERAGE_V1: additive created-window evidence, never a full-day snapshot.
 v_lg_window_cursor jsonb;v_lg_window_coverage jsonb;v_lg_window_seconds bigint;v_lg_day_seconds bigint;
 v_from date;v_to date;v_day date;v_start timestamptz;v_end timestamptz;v_zone text;v_today date;v_launch timestamptz;v_run record;v_source_evidence jsonb;v_lg_runs jsonb;v_seen timestamptz;v_has boolean;
 v_raw_country text;v_raw_platform text;v_platform_id uuid;v_source text;v_direction text;v_kind text;dataset text;source_system text;source_kind text;
 status text;evidence text;received boolean;complete boolean;zero_confirmed boolean;expected boolean;collector_status text;expected_count bigint;fetched_count bigint;
 -- AR_CREATION_COVERAGE_DECL_BEGIN
 v_ar_snapshot record;v_ar_valid boolean;v_ar_counts numeric[];v_ar_value jsonb;v_ar_group jsonb;
 v_ar_expected_groups jsonb;v_ar_observed_groups jsonb;v_ar_group_key text;v_ar_group_total numeric;
 -- AR_CREATION_COVERAGE_DECL_END
begin
 -- duoli_existing_orders_v1
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>4096 or p_request-array['operation','feedIds','startAt','endAt']<>'{}' or v_operation not in('catalog','orderCatalog','rows') then raise exception using errcode='22023',message='invalid_coverage_request';end if;
 if v_operation in('catalog','orderCatalog') then
  if p_request-array['operation']<>'{}' then raise exception using errcode='22023',message='invalid_coverage_request';end if;
  return jsonb_build_object('version',1,'complete',true,'checkedAt',v_asof,'defaultStart','2026-09-01','maxDays',93,'maxFeeds',8,'feeds',private.dashboard_admin_wg_current_feeds(case when v_operation='orderCatalog' then private.dashboard_admin_live_intake_order_feeds(v_asof) else private.dashboard_admin_live_intake_feeds(v_asof) end));
 end if;
 if jsonb_typeof(p_request->'feedIds') is distinct from 'array' or jsonb_array_length(p_request->'feedIds') not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_request->'feedIds')x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{32}$') then raise exception using errcode='22023',message='invalid_coverage_feeds';end if;
 if jsonb_typeof(p_request->'startAt') is distinct from 'string' or jsonb_typeof(p_request->'endAt') is distinct from 'string' or p_request->>'startAt' !~ '^\d{4}-\d{2}-\d{2}$' or p_request->>'endAt' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='invalid_coverage_range';end if;
 v_from:=(p_request->>'startAt')::date;v_to:=(p_request->>'endAt')::date;
 if v_from<date '2000-01-01' or v_to-v_from not between 0 and 92 then raise exception using errcode='22023',message='invalid_coverage_range';end if;
 select array_agg(distinct value) into v_ids from jsonb_array_elements_text(p_request->'feedIds');
 if cardinality(v_ids)<>jsonb_array_length(p_request->'feedIds') then raise exception using errcode='22023',message='duplicate_coverage_feed';end if;
 -- Native order checks do not rebuild unrelated report/configuration catalogs.
 v_feeds:=private.dashboard_admin_live_intake_order_feeds(v_asof);
 if (select count(*) from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids))<>cardinality(v_ids) then
  v_feeds:=private.dashboard_admin_live_intake_feeds(v_asof);
 end if;
 if (select count(*) from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids))<>cardinality(v_ids) then raise exception using errcode='42501',message='coverage_feed_denied';end if;
 for v_feed in select f from jsonb_array_elements(v_feeds)f where f->>'id'=any(v_ids) loop
  dataset:=v_feed->>'dataset';source_system:=v_feed->>'system';source_kind:=v_feed->>'sourceKind';v_source:=source_system;v_raw_country:=v_feed->>'rawCountry';v_raw_platform:=v_feed->>'rawPlatform';v_platform_id:=nullif(v_feed->>'platformId','')::uuid;v_direction:=v_feed->>'direction';v_kind:=case v_direction when 'charge' then 'recharge' else 'withdraw' end;v_zone:=v_feed->>'timezone';
  if v_zone is null or v_direction='unknown' or dataset='game66_config' then
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',null,'status','unverified','received',false,'complete',false,'zeroConfirmed',false,'expected',false,'evidence',case when dataset='game66_config' then 'configuration_history_unavailable' when v_zone is null then 'source_timezone_unknown' else 'source_direction_unknown' end,'recordReceivedAt',null));continue;
  end if;
  v_today:=(v_asof at time zone v_zone)::date;v_launch:=null;
  if dataset='orders' and source_system in('newar','ar') then
   select n.launch_at into v_launch from public.newar_detail_platforms n
    where n.platform=v_raw_platform and n.country_code=v_raw_country and n.enabled
     and (source_system='newar' or exists(
      select 1 from public.ar_config_targets t where t.country_code=v_raw_country
       and t.platform=v_raw_platform and t.source_system='NEW_AR'));
  end if;
  -- All-status run history lacks a general scope index. Read it once per bounded feed, not once per day.
  v_lg_runs:='[]';v_lg_window_cursor:=null;
  if dataset='lg_orders' or(dataset='orders' and source_system='lg') then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_lg_runs from(
    select distinct on(t.stat_date) t.stat_date,t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at
    from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.sync_mode is distinct from 'window' and t.status is distinct from 'window' and t.stat_date between v_from and least(v_to,v_today-1)
    order by t.stat_date,t.observed_at desc,t.published_at desc nulls last)r;
   select jsonb_build_object('originAt',c.origin_at,'cursorAt',c.cursor_at) into v_lg_window_cursor
    from private.lg_window_cursors c
    where c.platform=v_raw_platform and c.country_code=v_raw_country and c.order_kind=v_kind and c.stream='created';
  end if;
  for v_day in select d::date from generate_series(v_from::timestamp,least(v_to,v_today-1)::timestamp,interval '1 day')d loop
    v_start:=v_day::timestamp at time zone v_zone;v_end:=(v_day+1)::timestamp at time zone v_zone;
    v_lg_window_coverage:=null;v_source_evidence:=null;
    if dataset='lg_orders' or(dataset='orders' and source_system='lg') then
     v_lg_day_seconds:=extract(epoch from v_end-v_start)::bigint;
     v_lg_window_seconds:=case when v_lg_window_cursor is null then 0 else greatest(0,
      extract(epoch from least(v_end,(v_lg_window_cursor->>'cursorAt')::timestamptz)
       -greatest(v_start,(v_lg_window_cursor->>'originAt')::timestamptz))::bigint) end;
     v_lg_window_coverage:=jsonb_build_object(
      'basis','created_stream_contiguous_windows','status',case
       when v_lg_window_cursor is null then 'not_initialized'
       when (v_lg_window_cursor->>'originAt')::timestamptz<=v_start
        and (v_lg_window_cursor->>'cursorAt')::timestamptz>=v_end then 'covered'
       when v_lg_window_seconds>0 then 'partial' else 'uncovered' end,
      'coveredSeconds',v_lg_window_seconds,'daySeconds',v_lg_day_seconds,
      'creationDayWindowCovered',coalesce((v_lg_window_cursor->>'originAt')::timestamptz<=v_start
       and (v_lg_window_cursor->>'cursorAt')::timestamptz>=v_end,false),
      'originAt',v_lg_window_cursor->'originAt','cursorAt',v_lg_window_cursor->'cursorAt',
      'fullDaySnapshotComplete',false,'reportComplete',false,'zeroConfirmed',false);
    end if;
   v_has:=false;v_seen:=null;status:='not_received';evidence:=case when v_direction='config' then 'no_daily_configuration_snapshot' when dataset in('orders','lg_orders') then 'no_created_orders_received' else 'no_daily_report_received' end;
   complete:=false;zero_confirmed:=false;expected:=true;collector_status:=null;expected_count:=null;fetched_count:=null;
   if v_launch is not null and v_end<=v_launch then status:='not_expected';expected:=false;evidence:='before_verified_launch';
   else
    -- WG_EXISTING_FEEDS_V1
    if dataset='orders' and source_system='panda' then
     select private.dashboard_admin_panda_day_evidence(v_raw_platform,v_direction,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     complete:=(v_run.value->>'complete')::boolean;zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='kb' then
     select private.dashboard_admin_yash_day_evidence(v_raw_country,v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     complete:=(v_run.value->>'complete')::boolean;zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='duoli' then
     select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;
     v_source_evidence:=v_run.value;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:='source_windows';
    elsif dataset='orders' and source_system='wg' then
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';complete:=(v_run.value->>'complete')::boolean;
     zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='ar' then
     select true,a.updated_at into v_has,v_seen from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR'
      and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;
     -- AR_CREATION_COVERAGE_BEGIN
     -- A successful API response or one created order is not a full-day receipt.
     -- Only charge is reconciled; payout and the independently timed success cohort stay unchanged.
     if v_direction='charge' then
      select t.snapshot,t.snapshot_id,t.snapshot_at,t.updated_at into v_ar_snapshot
       from public.collection_success_daily t where t.source_system='RECHARGE_REVIEW'
        and t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day;
      if found then
       v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot)='object'
        and v_ar_snapshot.snapshot->'schema_version'='1'::jsonb
        and v_ar_snapshot.snapshot->>'source_system'='RECHARGE_REVIEW'
        and v_ar_snapshot.snapshot->>'country_code'=v_raw_country
        and v_ar_snapshot.snapshot->>'platform'=v_raw_platform
        and v_ar_snapshot.snapshot->>'stat_date'=v_day::text
        and v_ar_snapshot.snapshot->>'timezone'=v_zone
        and v_ar_snapshot.snapshot->>'snapshot_id'=v_ar_snapshot.snapshot_id::text
        and v_ar_snapshot.snapshot#>'{coverage,complete}'='true'::jsonb
        and jsonb_typeof(v_ar_snapshot.snapshot->'coverage')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'totals')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'groups')='array'
        and isfinite(v_ar_snapshot.snapshot_at) and v_ar_snapshot.snapshot_at<=v_asof+interval '5 minutes'
        and (v_ar_snapshot.snapshot_at at time zone v_zone)::date>v_day,false);
       if v_ar_valid then
        begin
         v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot->'snapshot_at')='string'
          and v_ar_snapshot.snapshot->>'snapshot_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
          and (v_ar_snapshot.snapshot->>'snapshot_at')::timestamptz=v_ar_snapshot.snapshot_at,false);
        exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then v_ar_valid:=false;
        end;
       end if;
       v_ar_counts:=array[]::numeric[];
       if v_ar_valid then
        foreach v_ar_value in array array[v_ar_snapshot.snapshot#>'{coverage,expected_count}',
          v_ar_snapshot.snapshot#>'{coverage,fetched_count}',v_ar_snapshot.snapshot#>'{coverage,unique_count}',
          v_ar_snapshot.snapshot#>'{totals,submitted_count}'] loop
         if jsonb_typeof(v_ar_value) is distinct from 'number' then v_ar_valid:=false;exit;end if;
         if (v_ar_value::text)::numeric not between 0 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_counts:=array_append(v_ar_counts,(v_ar_value::text)::numeric);
        end loop;
       end if;
       if v_ar_valid then
        v_ar_valid:=v_ar_counts[1]=v_ar_counts[2] and v_ar_counts[1]=v_ar_counts[3]
         and v_ar_counts[1]=v_ar_counts[4] and jsonb_array_length(v_ar_snapshot.snapshot->'groups')<=2000;
       end if;
       v_ar_expected_groups:='{}';v_ar_group_total:=0;
       if v_ar_valid then
        for v_ar_group in select value from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') loop
         if jsonb_typeof(v_ar_group) is distinct from 'object'
          or jsonb_typeof(v_ar_group->'raw_channel') is distinct from 'string'
          or jsonb_typeof(v_ar_group->'channel_type') is distinct from 'string'
          or length(v_ar_group->>'raw_channel') not between 1 and 96
          or length(v_ar_group->>'channel_type') not between 1 and 48
          or jsonb_typeof(v_ar_group->'submitted_count') is distinct from 'number' then v_ar_valid:=false;exit;end if;
         v_ar_value:=v_ar_group->'submitted_count';
         if (v_ar_value::text)::numeric not between 1 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_group_key:=jsonb_build_array(v_ar_group->>'raw_channel',v_ar_group->>'channel_type')::text;
         if v_ar_expected_groups ? v_ar_group_key then v_ar_valid:=false;exit;end if;
         v_ar_expected_groups:=v_ar_expected_groups||jsonb_build_object(v_ar_group_key,v_ar_value);
         v_ar_group_total:=v_ar_group_total+(v_ar_value::text)::numeric;
        end loop;
        v_ar_valid:=v_ar_valid and v_ar_group_total=v_ar_counts[1];
       end if;
       if v_ar_valid then
        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- VN_INTAKE_CHANNEL_IDENTITY_BEGIN
        -- Validate raw snapshot duplicates and totals above BEFORE combining verified VN aliases.
        -- Retain channel type, including separate bank QR and MoMo identities; unknown values stay raw.
        if v_raw_country='VN' then
         select coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb)
          into v_ar_expected_groups from(
           select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r->>'raw_channel',r->>'channel_type') key,
            sum((r->>'submitted_count')::numeric) n
           from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') r
           group by 1)g;
        end if;
        -- Count original groups first, then SUM canonical collisions; never let object aggregation overwrite them.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select private.dashboard_admin_vn_intake_channel_identity(v_raw_country,r.raw_channel,r.channel_type) key,
           sum(r.n) n,max(r.seen) seen from(
            select a.raw_channel,a.channel_type,count(*) n,max(a.updated_at) seen
            from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
             and a.order_kind='recharge' and a.source_system='AR'
             and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
            group by a.raw_channel,a.channel_type)r
          group by 1)g;
        -- VN_INTAKE_CHANNEL_IDENTITY_END
        v_has:=fetched_count>0;
        complete:=fetched_count=expected_count and v_ar_observed_groups=v_ar_expected_groups;
        zero_confirmed:=complete and expected_count=0;
        if complete then
         v_has:=true;v_seen:=coalesce(v_seen,v_ar_snapshot.updated_at,v_ar_snapshot.snapshot_at);
         status:=case when zero_confirmed then 'zero_complete' else 'complete' end;
         evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_created_counts_reconciled' end;
        else
         status:='partial';evidence:=case when fetched_count<>expected_count
          then 'source_created_count_mismatch' else 'source_created_channel_mismatch' end;
        end if;
       else
        collector_status:='snapshot_invalid';evidence:='source_snapshot_invalid';
        status:=case when coalesce(v_has,false) then 'received' else 'not_received' end;
       end if;
      end if;
     end if;
     -- AR_CREATION_COVERAGE_END
    elsif dataset='orders' and source_system='newar' then
     select true,n.received_at into v_has,v_seen from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.created_at>=greatest(v_start,coalesce(v_launch,v_start)) and n.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.newar_detail_records n where n.platform=v_raw_platform and n.dataset=v_direction and n.status_group='success' and n.success_at>=v_start and n.success_at<v_end and n.created_at>=coalesce(v_launch,'-infinity'::timestamptz)) then evidence:='only_success_day_records_received';end if;
    elsif dataset='orders' and source_system='game66' then
     if v_direction='charge' then select true,g.last_seen_at into v_has,v_seen from public.game66_charge_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;
     else select true,g.last_seen_at into v_has,v_seen from public.game66_withdraw_orders g where g.platform_id=v_platform_id and g.create_time>=v_start and g.create_time<v_end limit 1;end if;
     select r.status,r.finished_at,r.rows_fetched,r.rows_upserted,r.rows_skipped,r.error_count into v_run from public.game66_sync_runs r where r.platform_id=v_platform_id and r.data_type=v_direction and r.window_start<v_end and r.window_end>=v_start order by r.started_at desc limit 1;
     if found then
      collector_status:=v_run.status;fetched_count:=v_run.rows_fetched;
      if v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      elsif v_run.status='running' then status:='pending';evidence:='source_task_not_finished';
      elsif v_run.status='succeeded' then
       -- Fetched/upserted agreement proves receipt, not the remote day's total.
       -- This collector has no verified expected source count in its run metadata.
       status:=case when coalesce(v_has,false) then 'received' else 'unverified' end;evidence:='source_counts_not_verified';
      else status:='unverified';evidence:='source_task_state_unknown';end if;
     elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
    elsif dataset='volume' then
     select true,t.updated_at into v_has,v_seen from public.third_party_volume t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and t.quarantined_at is null
      and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end)
      and case source_kind when 'google_sheets' then t.sheet_name like '[三方量表%]%' when 'direct' then (v_source='AR' and t.sheet_name like 'AR_DIRECT%') or (v_source='LG' and t.sheet_name like 'LG_DIRECT%') else coalesce(t.sheet_name,'') not like '[三方量表%]%' and coalesce(t.sheet_name,'') not like 'AR_DIRECT%' and coalesce(t.sheet_name,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='panda_success' then
     select true,t.updated_at into v_has,v_seen from public.panda_success_rate_daily t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and lower(btrim(t.direction))=any(case v_direction when 'charge' then array['charge','recharge','collect','deposit','代收'] else array['withdraw','payout','代付'] end) limit 1;
    elsif dataset='lg_success' then
     select true,coalesce(t.observed_at,t.updated_at) into v_has,v_seen from public.lg_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.order_kind=v_kind limit 1;
    elsif dataset='lg_orders' or (dataset='orders' and source_system='lg') then
     select true,t.updated_at into v_has,v_seen from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.created_at>=v_start and t.created_at<v_end limit 1;
     if not coalesce(v_has,false) and exists(select 1 from public.lg_orders t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.paid_at>=v_start and t.paid_at<v_end) then evidence:='only_success_day_records_received';end if;
     select t.status,t.sync_mode,t.expected_count,t.source_total,t.fetched_count,t.published_at into v_run from jsonb_to_recordset(v_lg_runs)t(stat_date date,status text,sync_mode text,expected_count bigint,source_total bigint,fetched_count bigint,published_at timestamptz) where t.stat_date=v_day;
     if found then
      collector_status:=v_run.status;expected_count:=v_run.expected_count;fetched_count:=v_run.fetched_count;
      if v_run.status='published' then
       if v_run.sync_mode='full' and v_run.expected_count>=0 and v_run.expected_count=v_run.fetched_count and v_run.source_total=v_run.expected_count and v_run.published_at is not null then
        complete:=case when v_run.expected_count=0 then not coalesce(v_has,false) else coalesce(v_has,false) end;zero_confirmed:=complete and v_run.expected_count=0;
        if complete then v_has:=true;v_seen:=v_run.published_at;status:=case when zero_confirmed then 'zero_complete' else 'complete' end;evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_day_task_completed' end;
        else status:='partial';evidence:=case when v_run.expected_count=0 then 'completed_zero_conflicts_with_records' else 'published_records_not_received' end;end if;
       else status:='partial';evidence:='source_counts_not_verified';end if;
      elsif v_run.status in('collecting','live') then status:='pending';evidence:=case when v_run.status='live' then 'source_full_day_not_published' else 'source_task_not_finished' end;
      elsif v_run.status='failed' then status:='failed';evidence:='source_collection_failed';
      else status:='unverified';evidence:='source_snapshot_not_published';end if;
      elsif v_lg_window_seconds>0 then status:='partial';collector_status:='window';evidence:='created_window_coverage_not_full_snapshot';
      elsif not coalesce(v_has,false) then status:='not_started';if evidence<>'only_success_day_records_received' then evidence:='no_collection_run_evidence';end if;end if;
     elsif dataset='collection_success' then
     select true,coalesce(t.snapshot_at,t.updated_at) into v_has,v_seen from public.collection_success_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.source_system=v_source limit 1;
    elsif dataset='newar_third_party_volume' then
     select true,coalesce(t.captured_at,t.updated_at) into v_has,v_seen from public.newar_business_snapshots t where coalesce(nullif(t.country,''),t.country_code)=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day and t.kind='third_party_volume' and t.direction=v_direction limit 1;
    elsif dataset='auto' then
     select true,coalesce(t.source_updated_at,t.updated_at) into v_has,v_seen from public.auto_withdraw_daily t where t.country=v_raw_country and t.platform=v_raw_platform and t.data_date=v_day and case source_kind when 'google_sheets' then t.source_sheet like 'raw_daily_%' when 'direct' then (v_source='AR' and t.source_sheet like 'AR_DIRECT%') or (v_source='LG' and t.source_sheet like 'LG_DIRECT%') else coalesce(t.source_sheet,'') not like 'raw_daily_%' and coalesce(t.source_sheet,'') not like 'AR_DIRECT%' and coalesce(t.source_sheet,'') not like 'LG_DIRECT%' end limit 1;
    elsif dataset='ar_config' then
     select true,t.received_at into v_has,v_seen from public.ar_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='panda_config' then
     select true,t.received_at into v_has,v_seen from public.panda_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;
    elsif dataset='wg_config' then
     
     select true,t.received_at into v_has,v_seen from (
      select c.observed_at received_at from public.wg_realtime_config_daily c
      join private.dashboard_admin_wg_sites()s on s.country_code=c.country_code
       and c.site_code=case s.country_code when 'BR' then '278' else '3257' end
      where s.country_code=v_raw_country and s.platform=v_raw_platform and c.observed_local_date=v_day
      union all
      select c.received_at from public.wg_config_daily c
      where c.country_code=v_raw_country and c.platform=v_raw_platform and c.observed_local_date=v_day
     )t order by t.received_at desc limit 1;
    else status:='unverified';evidence:='unsupported_source';end if;
   end if;
   received:=coalesce(v_has,false);if received and status='not_received' then status:='received';evidence:='records_received_completeness_unverified';end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('feedId',v_feed->>'id','date',v_day,'status',status,'received',received,'complete',complete,'zeroConfirmed',zero_confirmed,'expected',expected,'evidence',evidence,'recordReceivedAt',v_seen,'collectorStatus',collector_status,'expectedCount',expected_count,'fetchedCount',fetched_count)
     ||case when dataset='lg_orders' or(dataset='orders' and source_system='lg') then jsonb_build_object('creationWindowCoverage',v_lg_window_coverage)
      when dataset='orders' and source_system in('duoli','kb','panda') then jsonb_build_object('sourceWindowCoverage',v_source_evidence->'progress',
       'createdCoverageAvailable',v_source_evidence->'createdCoverageAvailable') else '{}'::jsonb end);
  end loop;
 end loop;
 return jsonb_build_object('version',1,'complete',true,'checkedAt',v_asof,'feedIds',to_jsonb(v_ids),'startAt',v_from,'endAt',v_to,'timestampBasis','evidence_record_or_collector_receipt','rows',v_rows);
end;$function$
 ;$definition$;
 select * into strict p from pg_proc where oid=v_oid;
 if p.proacl is distinct from old_acl or p.proowner is distinct from old_owner or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
  or p.prosecdef is distinct from true then raise exception 'panda_native_reader_metadata_drift: dashboard_admin_live_intake_coverage';end if;
end;$guard$;
commit;
