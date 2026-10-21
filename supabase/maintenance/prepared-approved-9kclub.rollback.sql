-- Roll back only the exact appended 9KCLUB membership. Never delete its jobs,
-- artifacts or heads, reset attempts, or alter the independent published roster.
BEGIN;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
DO $rollback$
DECLARE s private.prepared_aggregate_schedule%rowtype;before_row jsonb;proposed jsonb;
 expected constant jsonb:='{"id":"6a05acd2-a892-9fa4-a376-af1f942d2a3b","name":"9KCLUB","team":"M8","source":"newar","country":"印度","currency":"INR","timezone":"Asia/Kolkata","scope_group":"IN","source_name":"9KCLUB"}';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='prepared_9k_rollback_owner_only';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0)) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='prepared_9k_rollback_schedule_busy';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton FOR UPDATE;
 before_row:=to_jsonb(s);
 IF md5(s.approved_targets::text)<>'0d4ce9fc519c49fa6634ee9c817ef751' OR jsonb_array_length(s.approved_targets)<>102
 OR s.approved_targets->101 IS DISTINCT FROM expected THEN RAISE EXCEPTION 'prepared_9k_rollback_manifest_drift';END IF;
 proposed:=s.approved_targets-101;
 IF md5(proposed::text)<>'fcd17ce5c267c04e79e27fce3895f1aa' THEN RAISE EXCEPTION 'prepared_9k_rollback_proposed_drift';END IF;
 UPDATE private.prepared_aggregate_schedule SET approved_targets=proposed WHERE singleton AND approved_targets=s.approved_targets;
 IF NOT FOUND THEN RAISE EXCEPTION 'prepared_9k_rollback_compare_and_swap_lost';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton;
 IF s.approved_targets IS DISTINCT FROM proposed OR(to_jsonb(s)-'approved_targets')IS DISTINCT FROM(before_row-'approved_targets') THEN RAISE EXCEPTION 'prepared_9k_rollback_unrelated_change';END IF;
END;$rollback$;
SELECT md5(approved_targets::text)AS approved_md5,jsonb_array_length(approved_targets)AS targets,enabled FROM private.prepared_aggregate_schedule WHERE singleton;
COMMIT;
