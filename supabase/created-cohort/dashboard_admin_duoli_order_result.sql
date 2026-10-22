CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_order_result(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;
begin
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r || case when r?'success_count' then jsonb_build_object(
   'success_time_available',true,'success_time_basis','order_updated_at',
   -- The five current-status groups partition the exact same creation cohort.
   -- This preserves numeric precision and propagates missing amounts.
   'created_success_amount',case when p_result->>'successBasis'='created'then r->>'created_success_amount'when r?'created_success_count' then (
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
 -- Updating a successful order is a statistical clock, not payment latency.
 if v_result?'latencySummary' then v_result:=jsonb_set(v_result,'{latencySummary}','[]'::jsonb);end if;
 for v_key in select unnest(array['latency','latency_thresholds','latency_custom']) loop
  if v_result->'groups'?v_key then v_result:=jsonb_set(v_result,array['groups',v_key],'[]'::jsonb);end if;
 end loop;
 return v_result||jsonb_build_object('nativeSource','DOLI','sourcePolicy','details_only',
  'successTimeAvailable',true,'chargeSuccessTimeAvailable',true,'withdrawSuccessTimeAvailable',true,
  'successTimeBasis','order_updated_at','paymentSuccessTimeAvailable',false,'latencyAvailable',false);
end;
$function$
