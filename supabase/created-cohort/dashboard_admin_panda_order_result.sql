CREATE OR REPLACE FUNCTION private.dashboard_admin_panda_order_result(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;k text;a jsonb;
begin
 for k in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r||case when r?'created_success_count' then jsonb_build_object(
   'created_success_amount',case when p_result->>'successBasis'='created'then r->>'created_success_amount'when (r->>'created_success_count')::bigint=0 then '0' else
    ((r->>'all_amount')::numeric-coalesce(r->>'reviewed_pending_amount',r->>'pending_amount')::numeric-
    (r->>'failed_amount')::numeric-(r->>'rejected_amount')::numeric-(r->>'unknown_amount')::numeric)::text end) else '{}'::jsonb end
   ||case when r?'success_count' then case when p_result->>'successBasis'='created'then jsonb_build_object('success_time_available',false)else jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false)end else '{}'::jsonb end
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
end;$function$
