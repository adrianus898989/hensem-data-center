CREATE OR REPLACE FUNCTION private.withdraw_prepared_complete(claim jsonb, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;dep text;aid uuid;at timestamptz:=clock_timestamp();expires timestamptz;bytes integer;k text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN RETURN jsonb_build_object('published',false,'reason','busy');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 IF j.request_key->>0 IN('submission-local-day-cohort-v1','submission-exact-window-v1')THEN RETURN private.submission_cohort_complete(claim,payload);END IF;
 IF j.request_key->>0='withdraw-reasons-blocking-v1'THEN RETURN private.withdraw_reason_complete(claim,payload);END IF;
 dep:=private.withdraw_prepared_dependency();
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,lease_until=null,last_error='source_contract_changed'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','source_contract_changed');END IF;
 IF dep<>j.dependency OR NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=0,lease_until=null,revision=revision+1,dependency=dep,not_before=at WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','dependency_changed');END IF;
 bytes:=octet_length(payload::text);
 IF payload->>'contract'IS DISTINCT FROM'withdraw-independent-windows-v2'OR payload->'request'IS DISTINCT FROM j.request OR payload->'catalog'IS DISTINCT FROM j.catalog OR payload->'scope'IS DISTINCT FROM j.scope OR bytes>4194304 OR jsonb_typeof(payload->'game66')IS DISTINCT FROM'object' OR jsonb_typeof(payload->'secondary')IS DISTINCT FROM'object'
 OR nullif(payload->>'computedAt','')IS NULL OR(payload->>'computedAt')::timestamptz>at OR(payload->>'computedAt')::timestamptz<at-interval'2minutes' THEN RAISE EXCEPTION 'withdraw_prepared_payload_mismatch';END IF;
 FOREACH k IN ARRAY ARRAY['wg','yash','newar','ar','duoli','arHistory']LOOP IF jsonb_typeof(payload->k)IS DISTINCT FROM'array'THEN RAISE EXCEPTION 'withdraw_prepared_payload_incomplete';END IF;END LOOP;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION 'withdraw_prepared_capacity';END IF;
 expires:=private.withdraw_prepared_expiry(at,greatest(left(j.request->>'endAt',10)::date,left(j.request->>'successEndAt',10)::date),j.catalog);
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,expires,bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=null,next_due_at=expires-interval'2minutes',last_error=null WHERE id=j.id;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$function$
