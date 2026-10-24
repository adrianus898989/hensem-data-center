CREATE OR REPLACE FUNCTION public.dashboard_admin_live_submission_analysis(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 VOLATILE
 SET search_path TO ''
AS $function$select private.submission_cohort_read(p_request);$function$
