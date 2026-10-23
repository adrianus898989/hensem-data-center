CREATE OR REPLACE FUNCTION private.withdraw_prepared_provider_gate()
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t private.prepared_aggregate_worker_turn%rowtype;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN false;END IF;
 -- Caller has selected a provider job and holds provider_snapshot_claim_v1.
 SELECT *INTO t FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF t.next_kind='prepared'AND(EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())OR EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()))
  AND(t.waiting_since IS NULL OR t.waiting_since>clock_timestamp()-interval'3seconds')THEN
  UPDATE private.prepared_aggregate_worker_turn SET waiting_since=coalesce(waiting_since,clock_timestamp())WHERE singleton;RETURN false;
 END IF;
 RETURN true;
END;$function$
