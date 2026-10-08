-- Connect the already-received DUOLI details to the existing authorized readers.
-- Original detail rows, legacy reports, upload credentials and privileges stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.dashboard_admin_duoli_sites()
returns table(platform text,country_code text,country text,timezone text,currency text)
language sql immutable set search_path='' as $$
 select p,'ID'::text,'印尼'::text,'Asia/Jakarta'::text,'IDR'::text
 from (values('UANG'::text),('HOT985'),('IND666'),('FB168'),('FB333'))s(p);
$$;
revoke all on function private.dashboard_admin_duoli_sites() from public,anon,authenticated;

-- The legacy collector explicitly converts IDR original_price by 1000 and uses
-- withdrawal gold unchanged. Do not infer a scale from an amount's magnitude.
create or replace function private.dashboard_admin_duoli_amount(p_business text,p_currency text,p_field text,p_raw text)
returns numeric language plpgsql immutable set search_path='' as $$
begin
 if p_currency is distinct from 'IDR' or p_raw is null or length(p_raw)>128
  or p_raw !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then return null;end if;
 if p_business='recharge' and p_field='original_price' then return p_raw::numeric/1000;end if;
 if p_business='withdraw' and p_field='gold' then return p_raw::numeric;end if;
 return null;
exception when numeric_value_out_of_range or invalid_text_representation then return null;
end;
$$;
revoke all on function private.dashboard_admin_duoli_amount(text,text,text,text) from public,anon,authenticated;

create or replace function private.dashboard_admin_duoli_status(p_business text,p_status text)
returns text language sql immutable set search_path='' as $$
 select case when p_business='recharge' then case p_status
  when '2' then 'success' when '0' then 'pending' when '4' then 'failed' else 'unknown' end
 when p_business='withdraw' then case
  when p_status in('6','2') then 'success' when p_status in('0','1') then 'pending'
  when p_status in('4','7') then 'rejected' else 'unknown' end else 'unknown' end;
$$;
revoke all on function private.dashboard_admin_duoli_status(text,text) from public,anon,authenticated;

-- A missing pay_chn falls back to an affiliate label in the collector; those
-- labels are not payment providers and must not become invented third parties.
create or replace function private.dashboard_admin_duoli_provider(p_code text)
returns text language sql immutable set search_path='' as $$
 select case p_code when '1' then 'SecPay' when '32' then 'Transafe' when '35' then 'StarPay'
  when '40' then 'OtgPay' when '45' then 'BayarPay' when '119' then 'JayaPay'
  when '124' then 'YerePay' when '292' then 'UanggoPay' when '322' then 'TodayPay'
  when '356' then 'Click2Pay' when '382' then 'nupaPay'
  else case when p_code ~ '^[0-9]{1,10}$' then 'PAYCHN_'||p_code else '未识别通道' end end;
$$;
revoke all on function private.dashboard_admin_duoli_provider(text) from public,anon,authenticated;

create or replace function private.dashboard_admin_duoli_capabilities()
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('sourceDetailSystem','DOLI','sourcePriority','native_details_only_no_legacy_daily_union',
  'systemOrderId',false,'thirdPartyOrderNumber',false,'utr',false,'actualAmount',false,'recordedFee',false,
  'historicalFees',false,'amountBasis','idr_original_price_div_1000_or_gold',
  'successTimeAvailable',false,'chargeSuccessTimeAvailable',false,'withdrawSuccessTimeAvailable',false,
  'successTimeBasis','not_provided','successCohort','unavailable_without_payment_success_timestamp',
  'latencyBasis','unavailable_without_payment_success_timestamp','customerPaymentTime',false,
  'createdSuccessBasis','current_status_recharge_2_withdraw_6_2','createdSuccessAmountAvailable',true,
  'pendingBasis','selected_created_cohort_current_stored_status',
  'sourceCompletenessVerified',false,'coverageBasis','separate_created_and_updated_receiver_windows',
  'withdrawCreatedCoverageAvailable',false,'memberDailyAvailable',false);
$$;
revoke all on function private.dashboard_admin_duoli_capabilities() from public,anon,authenticated;

-- Same bound parameter contract as the existing order engine. Success-time
-- and latency requests cannot substitute update or audit timestamps.
create or replace function private.dashboard_admin_duoli_order_source()
returns text language sql immutable set search_path='' as $function$
 select $source$
  select md5(jsonb_build_array('DOLI',d.platform,d.business,d.source_order_id)::text)::uuid as id,
   null::text as system_order_id,coalesce(nullif(d.order_no,''),d.source_order_id) as order_number,
   null::text as third_party_order_number,d.member_id,
   private.dashboard_admin_duoli_provider(d.provider_code) as provider,
   coalesce(nullif(btrim(d.channel),''),'其他类型') as channel_type,
   case d.business when 'recharge' then 'charge' else 'withdraw' end as direction,
   d.status_code as status,private.dashboard_admin_duoli_status(d.business,d.status_code) as status_group,
   d.created_at,null::timestamptz as success_at,
   private.dashboard_admin_duoli_amount(d.business,d.currency,d.amount_source,d.amount_raw) as amount,
   null::numeric as actual_amount,null::numeric as withdraw_fee,d.currency,d.received_at as synced_at,
   null::text as utr,private.dashboard_admin_duoli_provider(d.provider_code) as raw_provider
  from private.duoli_order_details d
  where $3='ID' and d.country='ID' and d.system_name='DOLI' and d.platform=$22
   and d.business=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and d.created_at >= $5 and d.created_at < $6
   and ($9 is null or d.member_id=$9)
   and ($10 is null or d.order_no=$10 or d.source_order_id=$10)
 $source$;
$function$;
revoke all on function private.dashboard_admin_duoli_order_source() from public,anon,authenticated;

create or replace function private.dashboard_admin_duoli_order_result(p_result jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;
begin
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r || case when r?'success_count' then jsonb_build_object(
   'success_count',null,'success_amount',null,'success_time_available',false,
   -- The five current-status groups partition the exact same creation cohort.
   -- This preserves numeric precision and propagates missing amounts.
   'created_success_amount',case when r?'created_success_count' then (
    (r->>'all_amount')::numeric-(r->>'pending_amount')::numeric-(r->>'failed_amount')::numeric
     -(r->>'rejected_amount')::numeric-(r->>'unknown_amount')::numeric)::text end
   ) else '{}'::jsonb end
   || case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,
    'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   || case when r?'fee_version_state' then jsonb_build_object('fee_version_state','unknown',
    'fee_version_matched_count',null,'fee_version_unmatched_count',null,'fee_version_estimated_amount',null) else '{}'::jsonb end
   order by n),'[]') into v_rows
  from jsonb_array_elements(case when v_key='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',v_key],'[]') end) with ordinality x(r,n);
  if v_key='summary' and v_result?'summary' or v_key<>'summary' then
   v_result:=jsonb_set(v_result,case when v_key='summary' then array['summary'] else array['groups',v_key] end,v_rows,true);
  end if;
 end loop;
 return v_result||jsonb_build_object('nativeSource','DOLI','sourcePolicy','details_only',
  'successTimeAvailable',false,'chargeSuccessTimeAvailable',false,'withdrawSuccessTimeAvailable',false);
end;
$$;
revoke all on function private.dashboard_admin_duoli_order_result(jsonb) from public,anon,authenticated;

create or replace function private.dashboard_admin_duoli_day_evidence(p_platform text,p_business text,p_day date)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_count bigint;v_seen timestamptz;v_progress jsonb;v_start timestamptz;v_end timestamptz;
begin
 v_start:=p_day::timestamp at time zone 'Asia/Jakarta';v_end:=(p_day+1)::timestamp at time zone 'Asia/Jakarta';
 select count(*),max(received_at) into v_count,v_seen from private.duoli_order_details
  where country='ID' and system_name='DOLI' and platform=p_platform and business=p_business and created_at>=v_start and created_at<v_end;
 select coalesce(jsonb_agg(jsonb_build_object('stream',q.stream,'startAt',q.start_at,'endExclusive',q.end_exclusive,
  'acknowledgedAt',q.acknowledged_at,'windowCovered',q.start_at<=v_start and q.end_exclusive>=v_end,
  'finalized',q.finalized,'sourceCount',q.source_count,'uploadedCount',q.uploaded_count) order by q.stream),'[]') into v_progress
 from private.duoli_detail_progress_v2 q where q.platform=p_platform and q.business=p_business;
 return jsonb_build_object('received',v_count>0,'seen',v_seen,'count',v_count,
  'status',case when v_count>0 then 'received' else 'unverified' end,
  'evidence',case when p_business='withdraw' then 'duoli_updated_stream_only' else 'duoli_created_windows_status_unverified' end,
  'complete',false,'zeroConfirmed',false,'progress',v_progress,'createdCoverageAvailable',p_business='recharge');
end;
$$;
revoke all on function private.dashboard_admin_duoli_day_evidence(text,text,date) from public,anon,authenticated;

create or replace function private.dashboard_admin_duoli_patch_once(d text,a text,b text)
returns text language plpgsql immutable set search_path='' as $$
begin
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then
  raise exception 'duoli_existing_orders_anchor_drift: %',left(a,100);
 end if;
 return replace(d,a,b);
end;
$$;
revoke all on function private.dashboard_admin_duoli_patch_once(text,text,text) from public,anon,authenticated;

do $patch$
declare item text;p record;d text;old_acl aclitem[];old_owner oid;new_acl aclitem[];new_owner oid;
begin
 foreach item in array array['dashboard_admin_live_platforms()','dashboard_admin_live_query_raw(jsonb)',
  'dashboard_admin_live_drilldown_raw(jsonb)','dashboard_admin_live_analysis_orders_raw(jsonb)',
  'dashboard_admin_live_provider_options(jsonb)','dashboard_admin_live_expand_provider_filter(jsonb)',
  'dashboard_admin_live_order_intake()','dashboard_admin_live_intake_coverage(jsonb)',
  'dashboard_admin_live_query(jsonb)'] loop
  select * into strict p from pg_proc where oid=to_regprocedure('private.'||item);
  if not p.prosecdef or p.provolatile<>'s' or not ('search_path=""'=any(p.proconfig))
   or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
   raise exception 'duoli_existing_orders_function_contract_drift: %',item;
  end if;
  if md5(p.prosrc) is distinct from (case item
   when 'dashboard_admin_live_platforms()' then '176a2602077e795e327560adba318810'
   when 'dashboard_admin_live_query_raw(jsonb)' then 'e179963c775181cd1b4dfe10fb948d53'
   when 'dashboard_admin_live_drilldown_raw(jsonb)' then '9bbd189f888579927d3b6bb997c545a7'
   when 'dashboard_admin_live_analysis_orders_raw(jsonb)' then '36d206175ffc38eeecf5ba7a3734d732'
   when 'dashboard_admin_live_provider_options(jsonb)' then 'c8a5766c7087df1f12876f57184a526f'
   when 'dashboard_admin_live_expand_provider_filter(jsonb)' then 'e5aa9256fab98bf6f67b62b1fa75faf6'
   when 'dashboard_admin_live_order_intake()' then 'c6122383ac83f6d789a058872fbfec09'
   when 'dashboard_admin_live_query(jsonb)' then '2d77fd7473eecfbf252e5c6ff6bc2d63'
   when 'dashboard_admin_live_intake_coverage(jsonb)' then 'd19ae8e97350488cf1bdd53c5520cf4c' end)
  then raise exception 'duoli_existing_orders_production_baseline_drift: %',item;end if;
  d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
  if item='dashboard_admin_live_platforms()' then
   d:=private.dashboard_admin_duoli_patch_once(d,E';\nend;', $new$
  union all
  select md5('duoli:ID:'||w.platform)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
   'duoli'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_duoli_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
   where t.active and t.source_system in('DOLI','REPORT') and t.country_code=w.country_code
    and upper(btrim(t.source_platform))=w.platform
   order by (t.source_system='DOLI') desc,(t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
;
end;$new$);
  elsif item in('dashboard_admin_live_query_raw(jsonb)','dashboard_admin_live_drilldown_raw(jsonb)',
    'dashboard_admin_live_analysis_orders_raw(jsonb)') then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  elsif v_platform.source='wg' then
    v_source:=$old$,$new$  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  v_meta:=jsonb_build_object('id',v_platform.id,$old$,
    $new$  if v_platform.source='duoli' then
    if v_status='success' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,$new$);
   if item='dashboard_admin_live_analysis_orders_raw(jsonb)' then
    d:=private.dashboard_admin_duoli_patch_once(d,$old$  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then$old$,
     $new$  if v_platform.source='duoli' and v_basis='success' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
  end if;
  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then$new$);
    d:=private.dashboard_admin_duoli_patch_once(d,$old$v_basis;  return v_result||$old$,
     $new$v_basis;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||$new$);
   else
    d:=private.dashboard_admin_duoli_patch_once(d,$old$  return v_result||case when v_duration_version=2 then$old$,
     $new$  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  return v_result||case when v_duration_version=2 then$new$);
   end if;
   if item='dashboard_admin_live_query_raw(jsonb)' then
    d:=private.dashboard_admin_duoli_patch_once(d,$old$case when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end$old$,
     $new$case when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end$new$);
   else
    d:=private.dashboard_admin_duoli_patch_once(d,$old$case when v_platform.source in('lg','wg') then v_platform.source_name else v_platform.name end$old$,
     $new$case when v_platform.source in('lg','wg','duoli') then v_platform.source_name else v_platform.name end$new$);
    if item='dashboard_admin_live_drilldown_raw(jsonb)' then
     d:=private.dashboard_admin_duoli_patch_once(d,$old$  if v_kind='latency' then
    -- Materialize only latency inputs.$old$,
      $new$  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_duoli';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs.$new$);
    end if;
   end if;
  elsif item='dashboard_admin_live_provider_options(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$where p.source not in('lg','wg') and$old$,
    $new$where p.source not in('lg','wg','duoli') and$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  )
  select jsonb_build_object('providers',$old$,$new$    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p cross join lateral (
     select distinct private.dashboard_admin_duoli_provider(d.provider_code) provider
     from private.duoli_order_details d where p.source='duoli' and p.scope_group='ID' and d.country='ID' and d.system_name='DOLI' and d.platform=p.source_name
      and d.business=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    )n
  )
  select jsonb_build_object('providers',$new$);
  elsif item='dashboard_admin_live_expand_provider_filter(jsonb)' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  if v_platform.source='wg' then$old$,$new$  if v_platform.source='duoli' then
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
  if v_platform.source='wg' then$new$);
  elsif item='dashboard_admin_live_order_intake()' then
   d:=private.dashboard_admin_duoli_patch_once(d,$old$   elsif p.source='wg' then$old$,$new$   elsif p.source='duoli' then
    select n.created_at,n.received_at into v_created,v_updated from private.duoli_order_details n
     where n.platform=p.source_name and p.scope_group='ID' and n.country='ID' and n.system_name='DOLI'
      and n.business=case d when 'charge' then 'recharge' else 'withdraw' end
     order by n.created_at desc limit 1;
    v_found:=found;
    select greatest(v_updated,max(q.acknowledged_at)) into v_updated from private.duoli_detail_progress_v2 q
     where q.platform=p.source_name and q.business=case d when 'charge' then 'recharge' else 'withdraw' end;
    v_found:=v_found or v_updated is not null;
   elsif p.source='wg' then$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$'system',case p.source when 'ar' then 'AR'$old$,
    $new$'system',case p.source when 'duoli' then 'DOLI' when 'ar' then 'AR'$new$);
  elsif item='dashboard_admin_live_query(jsonb)' then
   -- Canonical provider aliases can merge several raw rows. Recompute this
   -- additive creation-cohort amount after that merge rather than retain the
   -- first raw provider's new field; other source remapping stays untouched.
   d:=private.dashboard_admin_duoli_patch_once(d,$old$  return v_result;
end;$old$,$new$  if v_result#>>'{platform,source}'='duoli' then
    v_result:=private.dashboard_admin_duoli_order_result(v_result);
  end if;
  return v_result;
end;$new$);
  else
   d:=private.dashboard_admin_duoli_patch_once(d,$old$    if dataset='orders' and source_system='wg' then$old$,
    $new$    if dataset='orders' and source_system='duoli' then
     select private.dashboard_admin_duoli_day_evidence(v_raw_platform,v_kind,v_day) value into v_run;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:='source_windows';
    elsif dataset='orders' and source_system='wg' then$new$);
   d:=private.dashboard_admin_duoli_patch_once(d,$old$||case when dataset='lg_orders' or(dataset='orders' and source_system='lg') then jsonb_build_object('creationWindowCoverage',v_lg_window_coverage) else '{}'::jsonb end);$old$,
    $new$||case when dataset='lg_orders' or(dataset='orders' and source_system='lg') then jsonb_build_object('creationWindowCoverage',v_lg_window_coverage)
      when dataset='orders' and source_system='duoli' then jsonb_build_object('sourceWindowCoverage',v_run.value->'progress',
       'createdCoverageAvailable',v_run.value->'createdCoverageAvailable') else '{}'::jsonb end);$new$);
  end if;
  d:=private.dashboard_admin_duoli_patch_once(d,E'\nbegin\n',E'\nbegin\n -- duoli_existing_orders_v1\n');
  execute d;
  select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
  if new_acl is distinct from old_acl or new_owner is distinct from old_owner then
   raise exception 'duoli_existing_orders_acl_changed: %',item;
  end if;
 end loop;
end;$patch$;

-- Small provider inventories are platform/business scoped. Existing source data
-- remains private; no upload-side mutations, backfill or destructive cleanup.
create index if not exists duoli_order_details_provider_idx
 on private.duoli_order_details(platform,business,provider_code);
drop function private.dashboard_admin_duoli_patch_once(text,text,text);
notify pgrst,'reload schema';
commit;
