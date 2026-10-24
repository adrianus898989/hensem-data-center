CREATE OR REPLACE FUNCTION private.submission_cohort_prewarm(t jsonb, p_from date, p_through date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 RETURN private.submission_cohort_prewarm_request(t,p_from,p_through,NULL);
END;
$function$
