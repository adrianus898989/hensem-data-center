-- WG native detail adapter for the EXISTING M8 order pages and RPC gateway.
-- No alternate page, no grants to detail tables, and no changes to old reports.
-- Dynamic one-match patches preserve later amount/duration/permission fixes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.dashboard_admin_wg_sites()
returns table(site_code text,country_code text,country text,platform text,timezone text,currency text)
language sql immutable set search_path='' as $$
 values ('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),
 ('8311','BR','巴西','POPKKK','America/Sao_Paulo','BRL'),
 ('12588','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),
 ('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'),
 ('3605','VN','越南','XX98','Asia/Ho_Chi_Minh','VND');
$$;
revoke all on function private.dashboard_admin_wg_sites() from public,anon,authenticated;

-- The existing query engine binds $1..$24. UTR and latency-only are SQL-quoted
-- literals, not interpolated identifiers; no user-selectable tables or columns.
create or replace function private.dashboard_admin_wg_order_source(p_utr text,p_latency boolean default false)
returns text language sql immutable set search_path='' as $function$
 select format($source$
  select md5(jsonb_build_array('WG',w.site_code,w.business,w.order_number)::text)::uuid as id,
   null::text as system_order_id,w.order_number,w.third_order_number as third_party_order_number,w.member_id,
   coalesce(nullif(btrim(w.provider),''),'未识别通道') as provider,
   coalesce(nullif(btrim(w.channel),''),'其他类型') as channel_type,
   case w.business when 'recharge' then 'charge' else 'withdraw' end as direction,
   w.status_code::text as status,
   case w.status_group when 'paying' then 'pending' when 'cancelled' then 'failed'
    when 'forced' then 'unknown' else w.status_group end as status_group,
   w.created_at,case when w.business='recharge' and w.status_code=2 then w.success_at end as success_at,
   w.member_amount as amount,
   case when w.settlement_currency=w.member_currency then w.settlement_amount end as actual_amount,
   case when w.settlement_currency=w.member_currency then w.settlement_fee end as withdraw_fee,
   w.member_currency as currency,w.stored_at as synced_at,w.utr,w.provider as raw_provider
  from (select * from public.wg_recharge_details union all select * from public.wg_withdraw_details) w
  where w.site_code=(select s.site_code from private.dashboard_admin_wg_sites()s where s.country_code=$3 and s.platform=$22)
   and w.business=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and ((%2$L::boolean and w.business='recharge' and w.status_code=2 and w.success_at>=$5 and w.success_at<$6)
    or (not %2$L::boolean and (
     ($19<>'aggregate' and $8<>'success' and w.created_at>=$5 and w.created_at<$6)
     or (($19='aggregate' or $8='success') and (w.created_at>=$5 and w.created_at<$6
      or(w.business='recharge' and w.status_code=2 and w.success_at>=$5 and w.success_at<$6))))))
   and ($9 is null or w.member_id=$9) and ($10 is null or w.order_number=$10)
   and ($23 is null or w.third_order_number=$23) and (%1$L::text is null or w.utr=%1$L::text)
 $source$,p_utr,coalesce(p_latency,false));
$function$;
revoke all on function private.dashboard_admin_wg_order_source(text,boolean) from public,anon,authenticated;

create or replace function private.dashboard_admin_wg_capabilities(p_direction text default 'all')
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('thirdPartyOrderNumber',true,'utr',true,'actualAmount',true,'recordedFee',true,
  'amountBasis','normalized_member_amount','actualAmountBasis','settlement_amount_only_when_same_currency',
  'recordedFeeBasis','settlement_fee_only_when_same_currency','separateSettlementCurrency',true,
  'sourceDetailSystem','WG','sourcePriority','native_details_only_no_legacy_daily_union',
  'successTimeAvailable',p_direction='charge','withdrawSuccessTimeAvailable',false,
  'successTimeBasis','recharge_notify_time_only','latencyBasis','recharge_notify_time_minus_created',
  'successCohort','recharge_success_at_in_selected_range_withdraw_unavailable',
  'createdSuccessBasis','recharge_status_2_withdraw_status_4',
  'pendingBasis','created_cohort_current_pending_or_paying_not_midnight_snapshot',
  'statusProjection',jsonb_build_object('paying','pending','cancelled','failed','forced','unknown'),
  'sourceCompletenessVerified',false,'coverageBasis','separate_collector_committed_windows');
$$;
revoke all on function private.dashboard_admin_wg_capabilities(text) from public,anon,authenticated;

-- Existing general charts use success-time counts. NULL means unavailable for
-- WG withdrawal; it must never turn operation/cach time into a paid timestamp.
-- Current status-4 creation-cohort success counts remain independently valid.
create or replace function private.dashboard_admin_wg_order_result(p_result jsonb,p_country text,p_platform text)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;v_site text;
begin
 select site_code into strict v_site from private.dashboard_admin_wg_sites() where country_code=p_country and platform=p_platform;
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(case when r->>'direction'='withdraw' then
   r || case when r?'success_count' then jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false) else '{}'::jsonb end
     || case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   else r end order by n),'[]') into v_rows
  from jsonb_array_elements(case when v_key='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',v_key],'[]') end) with ordinality x(r,n);
  v_result:=jsonb_set(v_result,case when v_key='summary' then array['summary'] else array['groups',v_key] end,v_rows,true);
 end loop;
 -- Join only the already-authorized, bounded result page by site/order PK.
 select coalesce(jsonb_agg(r||jsonb_build_object(
  'site_code',v_site,'source_status_code',w.status_code,'source_status_group',w.status_group,
  'source_updated_at',w.updated_at,'operated_at',w.operated_at,'completion_at_unverified',w.completion_at_unverified,
  'member_currency',w.member_currency,'member_unit_scale',w.member_unit_scale,'member_amount_units',w.member_amount_units::text,
  'settlement_currency',w.settlement_currency,'settlement_amount',w.settlement_amount::text,
  'settlement_fee',w.settlement_fee::text,'exchange_rate',w.exchange_rate::text,
  'operator_name',w.business_fields->>'operator_name','operator_class',w.business_fields->>'operator_class',
  'remark_sanitized',w.business_fields->>'remark_sanitized','rejection_reason',w.business_fields->>'rejection_reason',
  'interception_reason',w.business_fields->>'interception_reason','interception_codes',w.business_fields->'interception_codes',
  'front_note_sanitized',w.business_fields->>'front_note_sanitized','back_note_sanitized',w.business_fields->>'back_note_sanitized'
 ) order by n),'[]') into v_rows
 from jsonb_array_elements(coalesce(v_result->'rows','[]')) with ordinality x(r,n)
 join lateral (select status_code,status_group,updated_at,operated_at,completion_at_unverified,member_currency,member_unit_scale,member_amount_units,settlement_currency,settlement_amount,settlement_fee,exchange_rate,business_fields
   from public.wg_recharge_details where site_code=v_site and order_number=r->>'order_number' and r->>'direction'='charge'
  union all select status_code,status_group,updated_at,operated_at,completion_at_unverified,member_currency,member_unit_scale,member_amount_units,settlement_currency,settlement_amount,settlement_fee,exchange_rate,business_fields
   from public.wg_withdraw_details where site_code=v_site and order_number=r->>'order_number' and r->>'direction'='withdraw')w on true;
 if v_result?'rows' then v_result:=jsonb_set(v_result,'{rows}',v_rows,true);end if;
 return v_result||jsonb_build_object('nativeSource','WG','sourcePolicy','details_only','withdrawSuccessTimeAvailable',false);
end;
$$;
revoke all on function private.dashboard_admin_wg_order_result(jsonb,text,text) from public,anon,authenticated;

-- Helper used only while installing. Every replacement must occur exactly once.
create or replace function private.dashboard_admin_wg_patch_once(d text,a text,b text)
returns text language plpgsql immutable set search_path='' as $$
begin
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'wg_existing_orders_anchor_drift: %',left(a,100);end if;
 return replace(d,a,b);
end;$$;
revoke all on function private.dashboard_admin_wg_patch_once(text,text,text) from public,anon,authenticated;

do $patch$
declare item text;p record;d text;old_acl aclitem[];old_owner oid;new_acl aclitem[];new_owner oid;source_call text;
begin
 foreach item in array array['dashboard_admin_live_platforms()','dashboard_admin_live_query_raw(jsonb)',
  'dashboard_admin_live_drilldown_raw(jsonb)','dashboard_admin_live_provider_options(jsonb)',
  'dashboard_admin_live_expand_provider_filter(jsonb)','dashboard_admin_live_order_intake()'] loop
  select * into strict p from pg_proc where oid=to_regprocedure('private.'||item);
  if not p.prosecdef or p.provolatile<>'s' or not ('search_path=""'=any(p.proconfig))
   or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'wg_existing_orders_function_contract_drift: %',item;end if;
  d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
  if position('-- wg_existing_orders_v1' in d)>0 then
   if md5(p.prosrc) is distinct from (case item
    when 'dashboard_admin_live_query_raw(jsonb)' then '88b2877df712e64daf3169360585e09c'
    when 'dashboard_admin_live_drilldown_raw(jsonb)' then '4b9c4d3c05157765691504b443324973'
    when 'dashboard_admin_live_platforms()' then 'f230e051dce0f2200f8fa41fb0f65c5b'
    when 'dashboard_admin_live_provider_options(jsonb)' then 'a3f285b547cdf076e6e6fc4b32187426'
    when 'dashboard_admin_live_expand_provider_filter(jsonb)' then 'c3af246b2aa3b4ac118815bdcec4e0ba'
    when 'dashboard_admin_live_order_intake()' then '7935b7161c8212bd633b4d8b52823594' end)
   then raise exception 'wg_existing_orders_installed_baseline_drift: %',item;end if;
   continue;
  end if;
  if md5(p.prosrc) is distinct from (case item
   when 'dashboard_admin_live_query_raw(jsonb)' then '2a954c06b88496c212b6c5690ad94f60'
   when 'dashboard_admin_live_drilldown_raw(jsonb)' then 'feb26ff524fce832a5b49d87482e3486'
   when 'dashboard_admin_live_platforms()' then 'b82d69bba3f150bf5358aee20253effa'
   when 'dashboard_admin_live_provider_options(jsonb)' then '71ca258670880859a6b5a42ce2a5a9fc'
   when 'dashboard_admin_live_expand_provider_filter(jsonb)' then '635e3374d3c17174f471d200b091151b'
   when 'dashboard_admin_live_order_intake()' then '020aa7142b408c9ffcfb3d4a184d0612' end)
  then raise exception 'wg_existing_orders_production_baseline_drift: %',item;end if;
  if item='dashboard_admin_live_platforms()' then
   d:=private.dashboard_admin_wg_patch_once(d,E';\nend;', $new$
  union all
  select md5('WG:'||w.site_code)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
    'wg'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_wg_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='WG' and t.country_code=w.country_code
      and upper(btrim(t.source_platform))=w.platform
    order by (t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where private.dashboard_scope_allows(v_scope,w.country_code,w.platform)
;
end;$new$);
  elsif item in('dashboard_admin_live_query_raw(jsonb)','dashboard_admin_live_drilldown_raw(jsonb)') then
   if position('public.lg_orders' in d)=0 or position('sourceCompletenessVerified' in d)=0
    or position('duration_precision_ranges_v2' in d)=0 then raise exception 'wg_existing_orders_engine_baseline_drift: %',item;end if;
   source_call:=case when item='dashboard_admin_live_drilldown_raw(jsonb)' then 'v_kind=''latency''' else 'false' end;
   d:=private.dashboard_admin_wg_patch_once(d,$old$  elsif v_platform.source='game66' then$old$,
    E'  elsif v_platform.source=''wg'' then\n    v_source:=private.dashboard_admin_wg_order_source(v_utr,'||source_call||E');\n  elsif v_platform.source=''game66'' then');
   d:=private.dashboard_admin_wg_patch_once(d,$old$if v_utr is not null or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66')) then$old$,
    $new$if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg')) then$new$);
   d:=private.dashboard_admin_wg_patch_once(d,$old$  v_meta:=jsonb_build_object('id',v_platform.id,$old$,
    $new$  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,$new$);
   d:=private.dashboard_admin_wg_patch_once(d,$old$  return v_result||case when v_duration_version=2 then$old$,
    $new$  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  return v_result||case when v_duration_version=2 then$new$);
   if item='dashboard_admin_live_query_raw(jsonb)' then
    d:=private.dashboard_admin_wg_patch_once(d,$old$'scopeGroupIsGeographicCountry',p->>'source'<>'game66')))$old$,
     $new$'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end))$new$);
   else
    d:=private.dashboard_admin_wg_patch_once(d,$old$case when v_platform.source='lg' then v_platform.source_name else v_platform.name end$old$,
     $new$case when v_platform.source in('lg','wg') then v_platform.source_name else v_platform.name end$new$);
   end if;
  elsif item='dashboard_admin_live_provider_options(jsonb)' then
   d:=private.dashboard_admin_wg_patch_once(d,$old$where p.source<>'lg' and$old$,$new$where p.source not in('lg','wg') and$new$);
   d:=private.dashboard_admin_wg_patch_once(d,$old$select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) from lg_names$old$,
    $new$select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider) from lg_names
    union
    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,n.provider)
    from platforms p join private.dashboard_admin_wg_sites()s on p.source='wg' and p.scope_group=s.country_code and p.source_name=s.platform
    cross join lateral (
      select distinct coalesce(nullif(btrim(provider),''),'未识别通道') provider from public.wg_recharge_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','charge')
      union select distinct coalesce(nullif(btrim(provider),''),'未识别通道') from public.wg_withdraw_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','withdraw')
    )n$new$);
  elsif item='dashboard_admin_live_expand_provider_filter(jsonb)' then
   d:=private.dashboard_admin_wg_patch_once(d,$old$  if v_platform.source='lg' then$old$,
    $new$  if v_platform.source='wg' then
    with names as (
      select distinct coalesce(nullif(btrim(d.provider),''),'未识别通道') provider
      from public.wg_recharge_details d join private.dashboard_admin_wg_sites()s on s.site_code=d.site_code
      where s.country_code=v_platform.scope_group and s.platform=v_platform.source_name and coalesce(p_request->>'direction','all') in('all','charge')
      union select distinct coalesce(nullif(btrim(d.provider),''),'未识别通道')
      from public.wg_withdraw_details d join private.dashboard_admin_wg_sites()s on s.site_code=d.site_code
      where s.country_code=v_platform.scope_group and s.platform=v_platform.source_name and coalesce(p_request->>'direction','all') in('all','withdraw')
    ), matches as (
      select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='lg' then$new$);
  else
   d:=private.dashboard_admin_wg_patch_once(d,$old$   elsif p.source='lg' then$old$,
    $new$   elsif p.source='wg' then
    select n.created_at,n.stored_at into v_created,v_updated from (
     select w.created_at,w.stored_at from public.wg_recharge_details w join private.dashboard_admin_wg_sites()s on s.site_code=w.site_code
      where d='charge' and s.country_code=p.scope_group and s.platform=p.source_name order by w.created_at desc limit 1
    )n;
    if d='withdraw' then
     select w.created_at,w.stored_at into v_created,v_updated from public.wg_withdraw_details w join private.dashboard_admin_wg_sites()s on s.site_code=w.site_code
      where s.country_code=p.scope_group and s.platform=p.source_name order by w.created_at desc limit 1;
    end if;
    v_found:=found;
    if not v_found then
     select null::timestamptz,max(q.last_success_at) into v_created,v_updated from private.wg_detail_progress q
      join private.dashboard_admin_wg_sites()s on s.site_code=q.site_code
      where s.country_code=p.scope_group and s.platform=p.source_name and q.business=case d when 'charge' then 'recharge' else 'withdraw' end
       and q.basis='created' and q.cursor is not null;
     v_found:=v_updated is not null;
    end if;
   elsif p.source='lg' then$new$);
  end if;
  -- Tag the body, leaving CREATE OR REPLACE's owner/ACL/defaults untouched.
  d:=private.dashboard_admin_wg_patch_once(d,E'\nbegin\n',E'\nbegin\n -- wg_existing_orders_v1\n');
  execute d;
  select proacl,proowner into new_acl,new_owner from pg_proc where oid=p.oid;
  if new_acl is distinct from old_acl or new_owner is distinct from old_owner then raise exception 'wg_existing_orders_acl_changed: %',item;end if;
 end loop;
end;$patch$;

-- Fast platform/provider inventories; no new public access and no raw payload.
create index if not exists wg_recharge_site_provider on public.wg_recharge_details(site_code,provider);
create index if not exists wg_withdraw_site_provider on public.wg_withdraw_details(site_code,provider);
drop function private.dashboard_admin_wg_patch_once(text,text,text);
notify pgrst,'reload schema';
commit;
