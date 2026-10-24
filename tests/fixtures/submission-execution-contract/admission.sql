CREATE FUNCTION private.submission_cohort_admit(q jsonb,t jsonb,dep text,v jsonb,children jsonb,human boolean)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE k jsonb;isday boolean:=children IS NULL;j private.withdraw_prepared_jobs%rowtype;sid uuid;budget integer;at timestamptz:=clock_timestamp();
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='submission_prepared_owner_required';END IF;
 IF dep IS NULL OR v IS NULL THEN RETURN NULL;END IF;
 k:=CASE WHEN isday THEN private.submission_cohort_day_key(t,((q->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date)ELSE jsonb_build_array('submission-exact-window-v1',q,t)END;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k FOR UPDATE;
 IF FOUND THEN
  IF isday AND j.status='ready'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts a ON a.id=h.artifact_id WHERE h.job_id=j.id AND(a.payload->>'validUntil')::timestamptz<=at)THEN
   UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=0,revision=revision+1,not_before=at WHERE id=j.id AND status='ready';
  END IF;
  UPDATE private.withdraw_prepared_jobs SET
   last_requested_at=CASE WHEN human THEN at ELSE last_requested_at END,
   scope=jsonb_build_object('target',t,'version',v,'children',children)||CASE WHEN human THEN jsonb_build_object('humanRequestedAt',at)ELSE j.scope-'target'-'version'-'children'END,
   dependency=dep,revision=revision+CASE WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN 1 ELSE 0 END,
   status=CASE WHEN status='running'THEN status WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN'queued'ELSE status END,
   attempts=CASE WHEN status<>'running'AND(dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v)THEN 0 ELSE attempts END,
   not_before=CASE WHEN dependency IS DISTINCT FROM dep OR scope->'version'IS DISTINCT FROM v THEN CASE WHEN isday THEN at ELSE'infinity'::timestamptz END ELSE not_before END
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
END;$function$;
CREATE FUNCTION private.submission_cohort_wake(p_window uuid)RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE w private.withdraw_prepared_jobs%rowtype;child jsonb;djob private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;
BEGIN
 SELECT *INTO w FROM private.withdraw_prepared_jobs WHERE id=p_window;
 IF w.id IS NULL OR w.request_key->>0<>'submission-exact-window-v1'OR w.status='running'OR w.status='failed'AND w.attempts>=3 THEN RETURN;END IF;
 FOR child IN SELECT *FROM jsonb_array_elements(w.scope->'children')LOOP
  SELECT *INTO djob FROM private.withdraw_prepared_jobs WHERE id=(child->>'jobId')::uuid;
  SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=djob.id;
  IF NOT private.submission_cohort_day_ready(djob,a,w.scope->'target',(child->>'date')::date,w.dependency,child->'version')THEN RETURN;END IF;
 END LOOP;
 UPDATE private.withdraw_prepared_jobs SET not_before=clock_timestamp()WHERE id=w.id AND revision=w.revision AND status IN('queued','ready')AND(status<>'ready'OR next_due_at<=clock_timestamp());
END;$function$;
