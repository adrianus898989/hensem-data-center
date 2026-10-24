CREATE OR REPLACE FUNCTION private.dashboard_health_wg_evidence_format(n bigint, seen timestamptz, covered boolean, has_window boolean, hi timestamptz, asof timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
begin
 -- Only fully acknowledged creation windows certify a complete day, even zero.
 covered:=covered and hi<=asof;
 return jsonb_build_object('received',n>0 or covered,'count',n,'complete',covered,'hasWindow',has_window,
  'zeroConfirmed',covered and n=0,'seen',seen,
  'status',case when covered and n=0 then 'zero_complete' when covered then 'complete' when n>0 or has_window then 'partial' else 'not_received' end,
  'evidence',case when covered and n=0 then 'source_completed_zero_rows' when covered then 'source_day_task_completed'
   when n>0 or has_window then 'source_full_day_not_published' else 'no_created_orders_received' end);
end;$function$;
