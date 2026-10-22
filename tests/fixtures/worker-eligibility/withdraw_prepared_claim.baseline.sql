CREATE OR REPLACE FUNCTION private.withdraw_prepared_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;started timestamptz;streak integer;is_interactive boolean;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error='lease_expired',not_before=clock_timestamp()+interval'1minute'WHERE status='running'AND lease_until<=clock_timestamp();
 -- This row is already locked by prepare_claim in the ordinary worker
 -- path. The shared advisory lock also serializes owner-only direct claims.
 SELECT interactive_streak INTO streak FROM private.withdraw_prepared_scheduler WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()
 ORDER BY CASE WHEN streak>=2 THEN 1-(CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)ELSE(CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)END,
  not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 -- Classify only the selected row after all existing eligibility/turn
 -- gates. No job, a busy lane, failed guards or no turn consumes no priority.
 SELECT (CASE WHEN private.dashboard_withdraw_priority_at(withdraw_prepared_jobs,statement_timestamp())IS NOT NULL THEN 0 ELSE 1 END)=0 INTO is_interactive FROM private.withdraw_prepared_jobs WHERE id=j.id;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 UPDATE private.withdraw_prepared_jobs SET status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started,interactive_requested_at=NULL WHERE id=j.id RETURNING *INTO j;
 UPDATE private.withdraw_prepared_scheduler SET interactive_streak=CASE WHEN is_interactive THEN least(streak+1,2)ELSE 0 END WHERE singleton;
 RETURN jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
END;$function$
