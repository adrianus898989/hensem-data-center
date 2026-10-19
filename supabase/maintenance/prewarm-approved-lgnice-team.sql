-- User confirmed LGNICE belongs to M8. Repair only its stale prewarm descriptor.
-- No target expansion, source fact, financial calculation, permission or schedule change.
BEGIN;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
DO $repair$
DECLARE s private.prepared_aggregate_schedule%rowtype;old_row jsonb;proposed jsonb;live jsonb;old_target jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='approved_team_repair_owner_only';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton FOR UPDATE;
 old_row:=to_jsonb(s);
 IF md5(s.approved_targets::text)<>'537c991498ee48609a57c2011bdca40e' OR jsonb_array_length(s.approved_targets)<>101
 OR (SELECT count(DISTINCT x->>'id')FROM jsonb_array_elements(s.approved_targets)x)<>101 THEN RAISE EXCEPTION 'approved_team_repair_manifest_drift';END IF;
 SELECT x INTO STRICT old_target FROM jsonb_array_elements(s.approved_targets)x WHERE x->>'id'='1f57d3bd-fb95-d929-f623-bf930217851e';
 IF old_target IS DISTINCT FROM '{"id":"1f57d3bd-fb95-d929-f623-bf930217851e","name":"LGNICE","team":null,"source":"lg","country":"菲律宾","currency":"PHP","timezone":"Asia/Manila","scope_group":"PH","source_name":"LGNICE"}'::jsonb THEN RAISE EXCEPTION 'approved_team_repair_target_drift';END IF;
 SELECT to_jsonb(n)INTO STRICT live FROM private.prepared_aggregate_native_catalog()n WHERE n.id::text=old_target->>'id';
 IF live IS DISTINCT FROM jsonb_set(old_target,'{team}','"M8"'::jsonb)THEN RAISE EXCEPTION 'approved_team_repair_live_drift';END IF;
 SELECT jsonb_agg(CASE WHEN x->>'id'=old_target->>'id'THEN live ELSE x END ORDER BY ord)INTO proposed FROM jsonb_array_elements(s.approved_targets)WITH ORDINALITY a(x,ord);
 IF (SELECT count(*)FROM jsonb_array_elements(s.approved_targets)WITH ORDINALITY a(x,ord)WHERE x IS DISTINCT FROM proposed->(ord::integer-1))<>1 THEN RAISE EXCEPTION 'approved_team_repair_not_single_change';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(proposed)x WHERE NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_native_catalog()n WHERE to_jsonb(n)=x))THEN RAISE EXCEPTION 'approved_team_repair_unresolved_drift';END IF;
 UPDATE private.prepared_aggregate_schedule SET approved_targets=proposed WHERE singleton AND approved_targets=s.approved_targets;
 IF NOT FOUND THEN RAISE EXCEPTION 'approved_team_repair_compare_and_swap_lost';END IF;
 SELECT * INTO STRICT s FROM private.prepared_aggregate_schedule WHERE singleton;
 IF s.approved_targets IS DISTINCT FROM proposed OR (to_jsonb(s)-'approved_targets')IS DISTINCT FROM(old_row-'approved_targets')THEN RAISE EXCEPTION 'approved_team_repair_unrelated_change';END IF;
END;$repair$;
SELECT md5(approved_targets::text)AS approved_md5,jsonb_array_length(approved_targets)AS targets,enabled FROM private.prepared_aggregate_schedule WHERE singleton;
COMMIT;
