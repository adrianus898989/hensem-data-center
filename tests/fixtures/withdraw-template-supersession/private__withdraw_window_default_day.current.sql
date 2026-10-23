CREATE OR REPLACE FUNCTION private.withdraw_window_default_day(q jsonb, d date)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT q||jsonb_build_object('startAt',d::text||'T00:00:00.000Z','endAt',d::text||'T23:59:59.000Z','successStartAt',d::text||'T00:00:00.000Z','successEndAt',d::text||'T23:59:59.000Z','windowVersion',2,'successBasis',coalesce(q->>'successBasis','success'));
$function$
