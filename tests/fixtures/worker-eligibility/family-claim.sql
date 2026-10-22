CREATE OR REPLACE FUNCTION private.withdraw_prepared_family_claim(p_family text, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE lane private.prepared_aggregate_worker_turn%rowtype;claim jsonb;bypassed boolean:=false;
BEGIN
 IF p_family IS NULL OR p_family NOT IN('payment','withdraw','base')THEN RAISE EXCEPTION USING errcode='22023',message='worker_eligibility_family_invalid';END IF;
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='worker_eligibility_owner_required';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION USING errcode='22023',message='worker_eligibility_deadline_required';END IF;
 -- The original claim and compute lane keep their locks, lease and fencing.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT *INTO lane FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 -- FALSE is the same definitive refusal used by provider_snapshot_claim.
 -- NULL, future work and other eligibility checks retain original behavior.
 IF lane.next_kind='provider'AND private.provider_snapshot_kernel_contract_current() IS FALSE THEN
  UPDATE private.prepared_aggregate_worker_turn SET next_kind='prepared',waiting_since=null WHERE singleton;
  bypassed:=true;
 END IF;
 CASE p_family
  WHEN 'payment'THEN claim:=private.prepared_aggregate_prepare_claim(p_worker);
  WHEN 'withdraw'THEN claim:=private.withdraw_prepared_claim();
  WHEN 'base'THEN claim:=private.daily_provider_base_claim();
 END CASE;
 IF bypassed AND claim IS NULL THEN
  UPDATE private.prepared_aggregate_worker_turn SET next_kind=lane.next_kind,waiting_since=lane.waiting_since WHERE singleton;
 END IF;
 -- A granted inner claim already sets next_kind back to provider. No lane
 -- accounting is changed here, so a newly valid provider still owns its turn.
 RETURN claim;
END;$function$;
