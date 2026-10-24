CREATE OR REPLACE FUNCTION private.withdraw_prepared_run_claimed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE claim jsonb:=nullif(current_setting('withdraw_prepared.claim',true),'')::jsonb;j private.withdraw_prepared_jobs%rowtype;started timestamptz;result jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'60seconds'THEN RAISE EXCEPTION 'withdraw_prepared_deadline_required';END IF;
 IF claim IS NULL THEN RETURN jsonb_build_object('status','idle');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 IF j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM started OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=clock_timestamp()THEN RETURN jsonb_build_object('status','obsolete');END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=greatest(attempts-1,0),lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  PERFORM set_config('withdraw_prepared.claim','',false);RETURN jsonb_build_object('status','busy');END IF;
 BEGIN
  IF j.request_key->>0 IN('submission-local-day-cohort-v1','submission-exact-window-v1')THEN
   result:=private.submission_cohort_compute(j);
  ELSIF j.request_key->>0='withdraw-reasons-blocking-v1'THEN
   result:=private.withdraw_reason_compute(j.request,j.scope->'context',j.scope->'version',j.dependency);
  ELSE result:=private.withdraw_prepared_compute(j.request,j.scope,j.catalog);END IF;
  result:=private.withdraw_prepared_complete(claim,result);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  IF j.request_key->>0='withdraw-reasons-blocking-v1'AND SQLERRM='withdraw_reason_payload_too_large'THEN
   UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,lease_until=null,last_error='withdraw_reasons_payload_too_large'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  ELSE
  UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error=CASE WHEN SQLSTATE='57014'THEN'compute_timeout'ELSE'compute_failed'END,not_before=clock_timestamp()+interval'1minute'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  END IF;
  result:=jsonb_build_object('published',false,'reason','compute_failed');
 END;
 PERFORM set_config('withdraw_prepared.claim','',false);RETURN result;
END;$function$
