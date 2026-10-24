CREATE OR REPLACE FUNCTION private.withdraw_reason_dependency()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT md5(jsonb_build_array('original-reason-source-4dcc-7c63-v1',coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),to_jsonb(p)-ARRAY['oid','prosrc','probin'])ORDER BY p.oid),'[]'::jsonb))::text)
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND (
  p.proname LIKE 'withdraw_reason_%'OR p.proname LIKE'dashboard_admin_live_blocking_%'OR p.proname LIKE'dashboard_admin_live_rejection_%'OR p.proname LIKE'dashboard_admin_live_%note%'OR p.proname IN(
   'dashboard_admin_newar_withdraw_reasons',
   'dashboard_admin_live_clean_note','dashboard_admin_live_blocking_details_cleaned','dashboard_admin_live_blocking_category',
   'dashboard_admin_live_rejection_exact_note','dashboard_admin_live_rejection_exact_key',
   'ar_withdraw_detail_evidence_generation','dashboard_admin_ar_local_amount','dashboard_admin_live_withdraw_key',
   'dashboard_scope_allows','dashboard_data_scope_valid','dashboard_data_group','dashboard_scope_platform_key'));
$function$

