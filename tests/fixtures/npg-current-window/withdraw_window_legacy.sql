CREATE OR REPLACE FUNCTION private.withdraw_window_legacy(q jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT q-ARRAY['windowVersion','successStartAt','successEndAt','successBasis','includeSecondary'];
$function$;
