-- User confirmed 9KCLUB belongs to M8. Admit this exact native target to the
-- existing bounded prepared schedule only. The separate published dispatcher
-- is capped at 18 targets and is intentionally NOT registered or modified here.
BEGIN;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
DO $repair$
DECLARE s private.prepared_aggregate_schedule%rowtype;before_row jsonb;live jsonb;proposed jsonb;
 expected constant jsonb:='{"id":"6a05acd2-a892-9fa4-a376-af1f942d2a3b","name":"9KCLUB","team":"M8","source":"newar","country":"印度","currency":"INR","timezone":"Asia/Kolkata","scope_group":"IN","source_name":"9KCLUB"}';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='prepared_9k_owner_only';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0)) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='prepared_9k_schedule_busy';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton FOR UPDATE;
 before_row:=to_jsonb(s);
 IF md5(s.approved_targets::text)<>'fcd17ce5c267c04e79e27fce3895f1aa' OR jsonb_array_length(s.approved_targets)<>101
 OR (SELECT count(DISTINCT x->>'id')FROM jsonb_array_elements(s.approved_targets)x)<>101
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.approved_targets)x WHERE x->>'id'=expected->>'id') THEN RAISE EXCEPTION 'prepared_9k_manifest_drift';END IF;
 SELECT to_jsonb(n) INTO STRICT live FROM private.prepared_aggregate_native_catalog()n WHERE n.id::text=expected->>'id';
 IF live IS DISTINCT FROM expected THEN RAISE EXCEPTION 'prepared_9k_native_drift';END IF;
 proposed:=s.approved_targets||jsonb_build_array(live);
 IF md5(proposed::text)<>'0d4ce9fc519c49fa6634ee9c817ef751' OR jsonb_array_length(proposed)<>102 THEN RAISE EXCEPTION 'prepared_9k_proposed_drift';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(proposed)x WHERE NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_native_catalog()n WHERE to_jsonb(n)=x)) THEN RAISE EXCEPTION 'prepared_9k_unresolved_native_drift';END IF;
 UPDATE private.prepared_aggregate_schedule SET approved_targets=proposed WHERE singleton AND approved_targets=s.approved_targets;
 IF NOT FOUND THEN RAISE EXCEPTION 'prepared_9k_compare_and_swap_lost';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton;
 IF s.approved_targets IS DISTINCT FROM proposed OR (to_jsonb(s)-'approved_targets')IS DISTINCT FROM(before_row-'approved_targets') THEN RAISE EXCEPTION 'prepared_9k_unrelated_change';END IF;
END;$repair$;
SELECT md5(approved_targets::text)AS approved_md5,jsonb_array_length(approved_targets)AS targets,enabled FROM private.prepared_aggregate_schedule WHERE singleton;
COMMIT;
