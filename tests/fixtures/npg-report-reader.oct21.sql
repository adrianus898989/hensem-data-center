CREATE OR REPLACE FUNCTION private.npg_withdraw_report_snapshots(p_start date, p_end date, p_scope jsonb, p_targets jsonb, p_request jsonb)
 RETURNS SETOF newar_business_snapshots
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH maps(code,country,platform,timezone) AS (
  VALUES('CO','哥伦比亚','NPG-COLOMBIA','America/Bogota'),
        ('MX','墨西哥','NPG-MEXICO','America/Mexico_City'),
        ('CL','智利','NPG-CHILE','America/Santiago')
 ), selected AS MATERIALIZED (
  SELECT m.* FROM maps m
  WHERE private.withdraw_window_whole_days(p_request)
   AND private.dashboard_scope_allows(p_scope,m.country,m.platform)
   AND CASE WHEN nullif(p_request->>'platform','') IS NOT NULL
    THEN private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(m.platform)
    WHEN jsonb_typeof(p_request->'platforms')='array' AND jsonb_array_length(p_request->'platforms')>0
    THEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_request->'platforms')p
     WHERE private.dashboard_admin_live_withdraw_key(p)=private.dashboard_admin_live_withdraw_key(m.platform))
    ELSE true END
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_targets)t
    WHERE t->>'country'=m.country
     AND (NOT t?'platforms' OR t->'platforms'='null'::jsonb
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'platforms')p
       WHERE private.dashboard_admin_live_withdraw_key(p)=private.dashboard_admin_live_withdraw_key(m.platform))))
 ), verified AS MATERIALIZED (
  SELECT d.*,m.country,m.timezone,r.received_at,
   d.observed_at >= ((d.stat_date+1)::timestamp AT TIME ZONE m.timezone) AS source_complete
  FROM selected m JOIN public.npg_withdraw_daily d ON d.country_code=m.code AND d.platform=m.platform
  JOIN private.npg_summary_heads h ON h.country_code=d.country_code AND h.stat_date=d.stat_date
   AND h.task='withdraw_daily' AND h.run_id=d.run_id AND h.observed_at=d.observed_at
  JOIN private.npg_summary_receipts r ON r.run_id=h.run_id AND r.country_code=d.country_code
   AND r.stat_date=d.stat_date AND r.task=h.task AND r.observed_at=d.observed_at
   AND r.source_run_id=d.source_run_id AND r.source_order_count=d.source_order_count
  JOIN public.npg_order_coverage c ON c.country_code=d.country_code AND c.stat_date=d.stat_date
   AND c.order_kind='withdraw' AND c.run_id=d.source_run_id AND c.observed_at=d.observed_at
   AND c.order_count=d.source_order_count
  JOIN private.npg_ingest_runs i ON i.run_id=c.run_id AND i.country_code=c.country_code
   AND i.stat_date=c.stat_date AND i.order_kind=c.order_kind AND i.observed_at=c.observed_at
   AND i.status='complete' AND i.completed_at IS NOT NULL AND c.completed_at IS NOT NULL
   AND i.order_count=c.order_count AND i.batch_count=c.batch_count AND i.credential_hash=r.credential_hash
  WHERE d.stat_date BETWEEN p_start AND p_end
   AND d.stat_date <= (statement_timestamp() AT TIME ZONE m.timezone)::date
   AND d.total_count=d.source_order_count
   AND d.total_count=d.paid_count+d.rejected_count+d.pending_count+d.unknown_count
   AND d.total_count=d.legacy_rejected_count+d.legacy_non_rejected_count
   AND d.total_count=d.auto_count+d.manual_count
   AND d.total_count>=0 AND d.paid_count>=0 AND d.rejected_count>=0
   AND d.pending_count>=0 AND d.unknown_count>=0 AND d.legacy_rejected_count>=0
   AND d.legacy_non_rejected_count>=0 AND d.auto_count>=0 AND d.manual_count>=0
   AND d.unknown_operator_count BETWEEN 0 AND d.auto_count
   AND d.handle_count BETWEEN 0 AND d.total_count AND d.total_handle_seconds>=0
 ), combined AS MATERIALIZED (
  SELECT d.*,o.operator_rows
  FROM verified d
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('operator',o.operator_key,
     'processed_count',o.processed_count,'reject_count',o.legacy_rejected_count,
     'total_handle_seconds',o.total_handle_seconds,'handle_count',o.handle_count)
     ORDER BY o.operator_key),'[]'::jsonb) operator_rows,
    coalesce(sum(o.processed_count),0) processed,coalesce(sum(o.legacy_rejected_count),0) rejected,
    coalesce(sum(o.handle_count),0) samples,coalesce(sum(o.total_handle_seconds),0) seconds,
    coalesce(bool_and(o.processed_count>=0 AND o.legacy_rejected_count BETWEEN 0 AND o.processed_count
     AND o.handle_count BETWEEN 0 AND o.processed_count AND o.total_handle_seconds>=0),true) valid
   FROM public.npg_operator_daily o WHERE o.country_code=d.country_code AND o.stat_date=d.stat_date
    AND o.platform=d.platform AND o.run_id=d.run_id AND o.observed_at=d.observed_at
  )o
  WHERE o.valid AND o.processed=d.manual_count AND o.rejected<=d.legacy_rejected_count
   AND o.samples<=d.handle_count AND o.seconds<=d.total_handle_seconds
 )
 SELECT jsonb_populate_record(null::public.newar_business_snapshots,jsonb_build_object(
  'kind','auto_withdraw_bundle','platform',d.platform,'country_code',d.country_code,
  'country',d.country,'stat_date',d.stat_date,'direction','all','captured_at',d.observed_at,
  'payload',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
    'total_count',d.total_count,'success_count',d.legacy_non_rejected_count,
    'reject_count',d.legacy_rejected_count,'auto_count',d.auto_count,'manual_count',d.manual_count,
    'total_handle_seconds',d.total_handle_seconds,'handle_count',d.handle_count)),
   'operator_rows',d.operator_rows,
   'npgSource',jsonb_build_object('source','NPG','timeBasis','created_at','timezone',d.timezone,
    'successBasis','source_legacy_non_rejected','classificationBasis','source_legacy_operator',
    'complete',d.source_complete,'observedAt',d.observed_at,'receivedAt',d.received_at,
    'runId',d.run_id,'sourceRunId',d.source_run_id,'sourceOrderCount',d.source_order_count)),
  'component_captured_at','{}'::jsonb,'updated_at',d.received_at))
 FROM combined d;
$function$;

