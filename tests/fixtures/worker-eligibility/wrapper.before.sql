CREATE OR REPLACE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE family text;c jsonb;base_turn boolean;
 lane private.prepared_aggregate_worker_turn%rowtype;
 aj uuid;wj uuid;am timestamptz;wm timestamptz;withdraw_streak smallint;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('daily_provider_base.claim','',false);
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;

 -- All decisions below remain inside the original claim advisory lock.
 -- Lock a genuine eligible marked row before temporarily selecting its family.
 -- The unchanged inner claim still owns native checks, run/fence and lease.
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())
 OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT *INTO lane FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN null;END IF;
 IF lane.lane_interactive_streak<2 AND private.shared_worker_priority_contract_current()THEN
  SELECT a.id,a.interactive_requested_at INTO aj,am FROM private.prepared_aggregate_jobs a
   WHERE a.status IN('queued','failed')AND a.attempts<3 AND a.not_before<=clock_timestamp()AND a.interactive_requested_at BETWEEN statement_timestamp()-interval'20minutes'AND statement_timestamp() ORDER BY a.interactive_requested_at,a.not_before,a.created_at
   FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF EXISTS(SELECT 1 FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled)THEN
   SELECT w.id,private.dashboard_withdraw_priority_at(w,statement_timestamp()) INTO wj,wm FROM private.withdraw_prepared_jobs w
    WHERE w.status IN('queued','failed')AND w.attempts<3 AND w.not_before<=clock_timestamp()AND private.dashboard_withdraw_priority_at(w,statement_timestamp()) IS NOT NULL ORDER BY private.dashboard_withdraw_priority_at(w,statement_timestamp()),w.not_before,w.created_at
    FOR UPDATE OF w SKIP LOCKED LIMIT 1;
  END IF;
  IF aj IS NOT NULL OR wj IS NOT NULL THEN
   family:=CASE WHEN aj IS NOT NULL AND(wj IS NULL OR am<=wm)THEN'payment'ELSE'withdraw'END;
   -- A row locked above guarantees the chosen family has a waiting candidate.
   -- Reset only its inner priority selector for this bounded attempt, restoring
   -- original accounting afterwards. No job state or financial key is changed.
   UPDATE private.prepared_aggregate_worker_turn SET next_kind='prepared',waiting_since=null,
    interactive_streak=CASE WHEN family='payment'THEN 0 ELSE lane.interactive_streak END WHERE singleton;
   IF family='payment'THEN c:=private.prepared_aggregate_prepare_claim(p_worker);
   ELSE
    SELECT interactive_streak INTO withdraw_streak FROM private.withdraw_prepared_scheduler WHERE singleton FOR UPDATE;
    UPDATE private.withdraw_prepared_scheduler SET interactive_streak=0 WHERE singleton;
    c:=private.withdraw_prepared_claim();
    UPDATE private.withdraw_prepared_scheduler SET interactive_streak=CASE WHEN c IS NULL THEN withdraw_streak ELSE least(withdraw_streak+1,2)END WHERE singleton;
   END IF;
   IF c IS NOT NULL THEN
    UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=lane.lane_interactive_streak+1,
     next_kind=lane.next_kind,waiting_since=lane.waiting_since,lane_waiting_since=null,interactive_streak=CASE WHEN family='payment'THEN least(lane.interactive_streak+1,2)ELSE lane.interactive_streak END WHERE singleton;
    PERFORM set_config('withdraw_prepared.family',family,false);
    IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
    -- Preserve next_kind/next_base/next_family: burst service cannot erase an owed normal
    -- background turn. The third service follows the original rotation below.
    RETURN c;
   END IF;
   UPDATE private.prepared_aggregate_worker_turn SET next_kind=lane.next_kind,waiting_since=lane.waiting_since,
    interactive_streak=lane.interactive_streak WHERE singleton;
  END IF;
 END IF;
 SELECT next_base INTO base_turn FROM private.daily_provider_base_scheduler WHERE singleton FOR UPDATE;
 IF base_turn AND EXISTS(SELECT 1 FROM private.daily_provider_base_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()AND priority>=100)THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
   PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);
   UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;RETURN c;
  END IF;
 END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('withdraw_prepared.family','payment',false);UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;ELSE c:=private.daily_provider_base_claim();IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton;
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
  UPDATE private.daily_provider_base_scheduler SET next_base=true WHERE singleton;
 END IF;
 IF c IS NULL THEN
  c:=private.daily_provider_base_claim();
  IF c IS NOT NULL THEN
   UPDATE private.prepared_aggregate_worker_turn SET lane_interactive_streak=0,lane_waiting_since=null WHERE singleton; PERFORM set_config('daily_provider_base.claim',c::text,false);PERFORM set_config('withdraw_prepared.family','base',false);UPDATE private.daily_provider_base_scheduler SET next_base=false WHERE singleton;END IF;
 END IF;RETURN c;
END;$function$
