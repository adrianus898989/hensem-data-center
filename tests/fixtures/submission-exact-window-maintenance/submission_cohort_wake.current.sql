CREATE OR REPLACE FUNCTION private.submission_cohort_wake(p_window uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END;$function$

