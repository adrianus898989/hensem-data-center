CREATE OR REPLACE FUNCTION private.submission_cohort_admit(q jsonb, t jsonb, dep text, v jsonb, children jsonb, human boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE k jsonb;isday boolean:=children IS NULL;j private.withdraw_prepared_jobs%rowtype;sid uuid;budget integer;at timestamptz:=clock_timestamp();wake_parked boolean:=false;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='submission_prepared_owner_required';END IF;
 IF dep IS NULL OR v IS NULL THEN RETURN NULL;END IF;
 k:=CASE WHEN isday THEN private.submission_cohort_day_key(t,((q->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date)ELSE jsonb_build_array('submission-exact-window-v1',q,t)END;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k FOR UPDATE;
 IF FOUND THEN
  -- A previously unverifiable vector can become valid without changing
  -- its value. Only a fresh verified admission may wake that parked day;
  -- never revive a stale supplied vector or bypass a failed attempt cap.
  IF isday AND j.status='queued'AND j.last_error='submission_inputs_changed'
   AND j.not_before='infinity'::timestamptz AND j.attempts<3
   AND j.dependency=dep AND j.scope->'version'=v THEN
   wake_parked:=dep IS NOT DISTINCT FROM private.submission_cohort_semantic(t)
    AND v IS NOT DISTINCT FROM private.submission_cohort_version(t,((q->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date);
  END IF;
  IF isday AND j.status='ready'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts a ON a.id=h.artifact_id WHERE h.job_id=j.id AND(a.payload->>'validUntil')::timestamptz<=at)THEN
   UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=0,revision=revision+1,not_before=at WHERE id=j.id AND status='ready';
  END IF;
  UPDATE private.withdraw_prepared_jobs SET
   last_requested_at=CASE WHEN human THEN at ELSE last_requested_at END,
   scope=jsonb_build_object('target',t,'version',v,'children',children)||CASE WHEN human THEN jsonb_build_object('humanRequestedAt',at)ELSE j.scope-'target'-'version'-'children'END,
   dependency=dep,revision=revision+CASE WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN 1 ELSE 0 END,
   status=CASE WHEN status='running'THEN status WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN'queued'ELSE status END,
   attempts=CASE WHEN status<>'running'AND(dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v)THEN 0 ELSE attempts END,
   not_before=CASE WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN CASE WHEN isday THEN at ELSE'infinity'::timestamptz END WHEN wake_parked THEN at ELSE not_before END
  WHERE id=j.id;
  RETURN j.id;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN NULL;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_jobs)>=2000 OR(SELECT count(*)FROM private.withdraw_prepared_jobs WHERE request_key->>0 IN('submission-local-day-cohort-v1','submission-exact-window-v1'))>=1024
 OR NOT isday AND(SELECT count(*)FROM private.withdraw_prepared_jobs WHERE request_key->>0='submission-exact-window-v1')>=256 THEN RETURN NULL;END IF;
 INSERT INTO private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency,not_before)
 VALUES(k,q,jsonb_build_object('target',t,'version',v,'children',children)||CASE WHEN human THEN jsonb_build_object('humanRequestedAt',at)ELSE'{}'::jsonb END,jsonb_build_array(t),dep,CASE WHEN isday THEN at ELSE'infinity'::timestamptz END)
 ON CONFLICT(fingerprint)DO UPDATE SET last_requested_at=excluded.last_requested_at WHERE private.withdraw_prepared_jobs.request_key=excluded.request_key RETURNING id INTO sid;
 RETURN sid;
END;$function$

