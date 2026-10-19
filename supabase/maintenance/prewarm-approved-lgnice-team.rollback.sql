-- Recovery only: restores the previous blocked prewarm manifest. Do not run routinely.
BEGIN;
SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='500ms';
DO $undo$
DECLARE s private.prepared_aggregate_schedule%rowtype;old_row jsonb;proposed jsonb;live jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='approved_team_repair_owner_only';END IF;
 SELECT *INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton FOR UPDATE;old_row:=to_jsonb(s);
 IF md5(s.approved_targets::text)<>'fcd17ce5c267c04e79e27fce3895f1aa'OR jsonb_array_length(s.approved_targets)<>101 THEN RAISE EXCEPTION'approved_team_rollback_manifest_drift';END IF;
 SELECT to_jsonb(n)INTO STRICT live FROM private.prepared_aggregate_native_catalog()n WHERE n.id::text='1f57d3bd-fb95-d929-f623-bf930217851e';
 IF live IS DISTINCT FROM'{"id":"1f57d3bd-fb95-d929-f623-bf930217851e","name":"LGNICE","team":"M8","source":"lg","country":"菲律宾","currency":"PHP","timezone":"Asia/Manila","scope_group":"PH","source_name":"LGNICE"}'::jsonb THEN RAISE EXCEPTION'approved_team_rollback_live_drift';END IF;
 SELECT jsonb_agg(CASE WHEN x=live THEN jsonb_set(x,'{team}','null'::jsonb)ELSE x END ORDER BY ord)INTO proposed FROM jsonb_array_elements(s.approved_targets)WITH ORDINALITY a(x,ord);
 IF md5(proposed::text)<>'537c991498ee48609a57c2011bdca40e'THEN RAISE EXCEPTION'approved_team_rollback_not_exact_baseline';END IF;
 UPDATE private.prepared_aggregate_schedule SET approved_targets=proposed WHERE singleton AND approved_targets=s.approved_targets;
 IF NOT FOUND THEN RAISE EXCEPTION'approved_team_rollback_compare_and_swap_lost';END IF;
 SELECT *INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton;
 IF(to_jsonb(s)-'approved_targets')IS DISTINCT FROM(old_row-'approved_targets')THEN RAISE EXCEPTION'approved_team_rollback_unrelated_change';END IF;
END;$undo$;
COMMIT;
