CREATE FUNCTION private.submission_cohort_compute(j private.withdraw_prepared_jobs)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE t jsonb:=j.scope->'target';v jsonb;result jsonb;day date;child jsonb;dj private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;
 parts jsonb:='[]'::jsonb;components jsonb:='[]'::jsonb;asof timestamptz;until_at timestamptz;candidate_until timestamptz;dep text;
BEGIN
 IF current_user<>'postgres'OR current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION'submission_cohort_worker_context';END IF;
 IF NOT(SELECT enabled FROM private.submission_cohort_control WHERE singleton)THEN RETURN NULL;END IF;
 dep:=private.submission_cohort_semantic(t);
 IF dep IS DISTINCT FROM j.dependency THEN RETURN NULL;END IF;
 IF j.request_key->>0='submission-local-day-cohort-v1'THEN
  day:=((j.request->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date;
  v:=private.submission_cohort_version(t,day);
  IF v IS NULL OR v IS DISTINCT FROM j.scope->'version'THEN RETURN NULL;END IF;
  asof:=statement_timestamp();
  result:=private.submission_cohort_day_compute(j.request,j.catalog);
  -- YASH quality may change as a future timestamp becomes visible without a
  -- write. Bound that exact old snapshot; the next read cannot call it current.
  IF t->>'source'='kb'THEN
   SELECT min(x.at)INTO until_at FROM(
    SELECT min(y.completed_at)at FROM private.yash_orders y WHERE y.source_site='yash'AND y.order_type='deposit'AND y.status IN('充值成功','人工确认成功')AND y.completed_at>asof
    AND(y.created_at<(day+1)::timestamp AT TIME ZONE(t->>'timezone')OR y.created_at IS NULL)
    UNION ALL SELECT min(w.observed_at)FROM private.yash_sync_windows w WHERE w.order_type='deposit'AND w.observed_at>asof AND w.start_at<(day+1)::timestamp AT TIME ZONE(t->>'timezone')AND w.end_exclusive>day::timestamp AT TIME ZONE(t->>'timezone')
   )x;
  END IF;
  IF private.submission_cohort_version(t,day)IS DISTINCT FROM v OR private.submission_cohort_semantic(t)IS DISTINCT FROM dep THEN RETURN NULL;END IF;
  RETURN jsonb_build_object('contract','submission-local-day-cohort-v1','request',j.request,'target',t,'version',v,'result',result,'sourceAsOf',asof,'validUntil',until_at);
 END IF;
 IF j.request_key->>0<>'submission-exact-window-v1'OR jsonb_typeof(j.scope->'children')IS DISTINCT FROM'array'THEN RETURN NULL;END IF;
 FOR child IN SELECT *FROM jsonb_array_elements(j.scope->'children')LOOP
  SELECT *INTO dj FROM private.withdraw_prepared_jobs WHERE id=(child->>'jobId')::uuid;
  SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=dj.id;
  IF NOT private.submission_cohort_day_ready(dj,a,t,(child->>'date')::date,dep,child->'version')OR private.submission_cohort_version(t,(child->>'date')::date)IS DISTINCT FROM child->'version'THEN RETURN NULL;END IF;
  parts:=parts||jsonb_build_array(a.payload->'result');asof:=least(asof,(a.payload->>'sourceAsOf')::timestamptz);
  candidate_until:=(a.payload->>'validUntil')::timestamptz;until_at:=least(until_at,candidate_until);
  components:=components||jsonb_build_array(jsonb_build_object('date',child->'date','artifactId',a.id,'computedAt',a.computed_at,'sourceAsOf',a.payload->'sourceAsOf'));
 END LOOP;
 result:=private.submission_cohort_project(parts,j.request,t,asof);
 SELECT jsonb_agg(jsonb_build_object('date',ds::date,'version',private.submission_cohort_version(t,ds::date))ORDER BY ds)INTO v
 FROM generate_series(((j.request->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date,(((j.request->>'endAt')::timestamptz-interval'1microsecond')AT TIME ZONE(t->>'timezone'))::date,interval'1day')ds;
 IF v IS DISTINCT FROM j.scope->'version'OR private.submission_cohort_semantic(t)IS DISTINCT FROM dep THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('contract','submission-exact-window-v1','request',j.request,'target',t,'version',v,'result',result,'components',components,'validUntil',until_at);
END;$function$;
CREATE FUNCTION private.submission_cohort_complete(claim jsonb,payload jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE j private.withdraw_prepared_jobs%rowtype;at timestamptz:=clock_timestamp();aid uuid;bytes bigint;expires timestamptz;t jsonb;dep text;v jsonb;day date;w record;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='submission_cohort_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN RETURN jsonb_build_object('published',false,'reason','busy');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 IF NOT(SELECT enabled FROM private.submission_cohort_control WHERE singleton)THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=NULL,claim_pid=NULL,claim_backend_start=NULL,attempts=greatest(attempts-1,0),not_before='infinity'::timestamptz
   WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  RETURN jsonb_build_object('published',false,'reason','submission_disabled');
 END IF;
 t:=j.scope->'target';dep:=private.submission_cohort_semantic(t);
 IF j.request_key->>0='submission-local-day-cohort-v1'THEN
  day:=((j.request->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date;v:=private.submission_cohort_version(t,day);
 ELSE
  SELECT jsonb_agg(jsonb_build_object('date',ds::date,'version',private.submission_cohort_version(t,ds::date))ORDER BY ds)INTO v FROM generate_series(((j.request->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date,(((j.request->>'endAt')::timestamptz-interval'1microsecond')AT TIME ZONE(t->>'timezone'))::date,interval'1day')ds;
 END IF;
 IF dep IS NULL OR v IS NULL OR dep IS DISTINCT FROM j.dependency OR v IS DISTINCT FROM j.scope->'version'OR payload IS NULL OR(payload?'version'AND payload->'version'IS DISTINCT FROM v)THEN
  -- Never publish a mixed source version. A waiting window holds no worker
  -- lease and is woken only by completed child publications or a real reread.
  UPDATE private.withdraw_prepared_jobs SET status='queued',lease_until=NULL,claim_pid=NULL,claim_backend_start=NULL,attempts=greatest(attempts-1,0),
   not_before=CASE WHEN request_key->>0='submission-exact-window-v1'THEN'infinity'::timestamptz ELSE at+interval'1second'END,last_error='submission_inputs_changed'
  WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  RETURN jsonb_build_object('published',false,'reason','submission_inputs_changed');
 END IF;
 IF payload->>'contract'IS DISTINCT FROM j.request_key->>0 OR payload->'request'IS DISTINCT FROM j.request OR payload->'target'IS DISTINCT FROM t OR payload->'version'IS DISTINCT FROM v
 OR jsonb_typeof(payload->'result')IS DISTINCT FROM'object'THEN RAISE EXCEPTION'submission_cohort_payload_mismatch';END IF;
 IF j.request_key->>0='submission-local-day-cohort-v1'AND(jsonb_typeof(payload->'result'->'qualified')IS DISTINCT FROM'array'OR jsonb_typeof(payload->'result'->'providers')IS DISTINCT FROM'array'OR jsonb_typeof(payload->'result'->'unknownMembers')IS DISTINCT FROM'array')
 OR j.request_key->>0='submission-exact-window-v1'AND(jsonb_typeof(payload->'result'->'metrics')IS DISTINCT FROM'array'OR jsonb_typeof(payload->'result'->'coverage')IS DISTINCT FROM'object'OR payload#>>'{result,version}'IS DISTINCT FROM'3'OR payload#>>'{result,platform,id}'IS DISTINCT FROM t->>'id')THEN RAISE EXCEPTION'submission_cohort_payload_incomplete';END IF;
 bytes:=octet_length(payload::text);
 IF bytes>4194304 THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,lease_until=NULL,last_error='submission_payload_too_large'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','submission_payload_too_large');END IF;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION'withdraw_prepared_capacity';END IF;
 expires:=private.withdraw_prepared_expiry(at,(((j.request->>'endAt')::timestamptz-interval'1microsecond')AT TIME ZONE(t->>'timezone'))::date,j.catalog);
 expires:=least(expires,(payload->>'validUntil')::timestamptz);
 IF expires<=at THEN RAISE EXCEPTION'submission_cohort_time_changed';END IF;
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,expires,bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=NULL,next_due_at=expires,last_error=NULL WHERE id=j.id;
 IF j.request_key->>0='submission-local-day-cohort-v1'THEN
  FOR w IN SELECT z.id FROM private.withdraw_prepared_jobs z WHERE z.request_key->>0='submission-exact-window-v1'AND z.scope->'target'=t AND z.status='queued'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(z.scope->'children')c WHERE c->>'jobId'=j.id::text)ORDER BY z.last_requested_at DESC LIMIT 8 LOOP
   PERFORM private.submission_cohort_wake(w.id);
  END LOOP;
 END IF;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$function$;
REVOKE ALL ON FUNCTION private.submission_cohort_compute(private.withdraw_prepared_jobs),private.submission_cohort_complete(jsonb,jsonb)FROM PUBLIC,anon,authenticated,service_role;
