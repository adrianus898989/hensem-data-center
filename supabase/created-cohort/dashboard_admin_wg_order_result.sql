CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_order_result(p_result jsonb, p_country text, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;v_site text;
begin
 select site_code into strict v_site from private.dashboard_admin_wg_sites() where country_code=p_country and platform=p_platform;
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(case when r->>'direction'='withdraw' then
   r || case when r?'success_count' then case when p_result->>'successBasis'='created'then jsonb_build_object('success_time_available',false)else jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false)end else '{}'::jsonb end
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
$function$
