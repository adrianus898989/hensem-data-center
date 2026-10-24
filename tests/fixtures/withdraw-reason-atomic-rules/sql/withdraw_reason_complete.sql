CREATE OR REPLACE FUNCTION private.withdraw_reason_complete(claim jsonb, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;aid uuid;at timestamptz:=clock_timestamp();bytes integer;v jsonb;c jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 c:=j.scope->'context';v:=j.scope->'version';dep:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN
  UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='obsolete_native'WHERE id=j.id AND status='running'AND run_id=(claim->>'runId')::uuid AND fence=(claim->>'fence')::bigint;
  RETURN jsonb_build_object('published',false,'reason','obsolete_native');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.request_key->>0<>'withdraw-reasons-blocking-v1'OR j.claim_pid IS DISTINCT FROM pg_backend_pid()
 OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 IF j.scope->'context'IS DISTINCT FROM c OR j.scope->'version'IS DISTINCT FROM v THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at,last_error='source_changed'WHERE id=j.id;
  RETURN jsonb_build_object('published',false,'reason','obsolete_manifest');END IF;
 IF payload IS NULL OR private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR j.dependency IS DISTINCT FROM dep OR payload->'version'IS DISTINCT FROM v OR payload->'context'IS DISTINCT FROM c THEN
  IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN
   UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='obsolete_native'WHERE id=j.id;
  ELSE
   v:=private.withdraw_reason_versions_ensure((c->'native')||jsonb_build_object('aliases',c->'aliases','rawOnly',c->'rawOnly'),(j.request->>'date')::date);
   IF v IS NULL THEN UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,attempts=3,last_error='source_unverifiable'WHERE id=j.id;
   ELSE UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at+interval'1second',last_error='source_changed',
    scope=jsonb_build_object('context',c,'version',v)||(j.scope-ARRAY['context','version']),revision=revision+1,dependency=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)WHERE id=j.id;END IF;
  END IF;
  RETURN jsonb_build_object('published',false,'reason','source_changed');END IF;
 bytes:=octet_length(payload::text);
 IF payload->'result'->>'reasonGrouping'IS DISTINCT FROM'atomic_rules_v1'OR(c->'native'->>'source'='newar'AND private.withdraw_reason_newar_index_valid(payload->'result')IS NOT TRUE)OR payload->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'OR payload->'request'IS DISTINCT FROM j.request OR bytes>4194304
 OR jsonb_typeof(payload->'result'->'rows')IS DISTINCT FROM'array'OR jsonb_typeof(payload->'result'->'total')IS DISTINCT FROM'number'OR coalesce(payload->'result'->>'total','')!~'^[0-9]+$'OR(payload->'result'->>'total')::bigint IS DISTINCT FROM jsonb_array_length(payload->'result'->'rows')
 OR nullif(payload->>'computedAt','')IS NULL OR(payload->>'computedAt')::timestamptz>at OR(payload->>'computedAt')::timestamptz<at-interval'2minutes'THEN RAISE EXCEPTION 'withdraw_reason_payload_mismatch';END IF;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION 'withdraw_prepared_capacity';END IF;
 IF private.withdraw_reason_versions_match(v)IS NOT TRUE THEN UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=null,attempts=0,not_before=at+interval'1second',last_error='source_changed'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','source_changed');END IF;
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)
 VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,'infinity',bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=null,next_due_at=at+interval'1minute',last_error=null WHERE id=j.id;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$function$

