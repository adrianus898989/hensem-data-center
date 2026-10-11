CREATE OR REPLACE FUNCTION private.dashboard_admin_ar_local_amount(p_country text, p_kind text, p_channel_type text, p_version smallint, p_local numeric, p_local_currency text, p_issue text, p_legacy_display numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
 SELECT CASE
  WHEN p_country IS DISTINCT FROM 'IN' THEN p_legacy_display
  WHEN p_issue = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN p_version IS NOT NULL THEN CASE
   WHEN p_version = 1 AND p_local_currency = 'INR'
    AND (p_issue IS NULL OR p_issue = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND p_local IS NOT NULL AND p_local::text NOT IN ('NaN','Infinity','-Infinity')
   THEN p_local ELSE NULL::numeric END
  WHEN p_kind = 'withdraw' AND upper(btrim(coalesce(p_channel_type,''))) = 'USDT'
   THEN NULL::numeric
  ELSE p_legacy_display
 END;
$function$
;
