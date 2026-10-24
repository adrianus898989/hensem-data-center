CREATE FUNCTION private.submission_cohort_read(p_request jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $function$
DECLARE q jsonb:=p_request-ARRAY['preparedVersion','forceRefresh'];c jsonb;t jsonb;dep text;v jsonb;child jsonb;children jsonb:='[]'::jsonb;
 k jsonb;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;old_result jsonb;sid uuid;v_day date;dv jsonb;budget integer;at timestamptz:=clock_timestamp();all_ready boolean:=true;source_failed boolean:=false;force boolean:=false;freshness text;
BEGIN
 -- One existing RPC, explicit opt-in; old clients and disabled rollout retain
 -- the original validation/execution path without an unknown envelope.
 IF p_request?'preparedVersion'AND p_request->'preparedVersion'IS DISTINCT FROM'1'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='invalid_request';END IF;
 IF p_request?'forceRefresh'AND p_request->'preparedVersion'IS DISTINCT FROM'1'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='invalid_request';END IF;
 IF p_request?'forceRefresh'THEN IF p_request->'forceRefresh'NOT IN('true'::jsonb,'false'::jsonb)THEN RAISE EXCEPTION USING errcode='22023',message='invalid_request';END IF;force:=(p_request->>'forceRefresh')::boolean;END IF;
 IF p_request->'preparedVersion'IS DISTINCT FROM'1'::jsonb OR NOT(SELECT enabled FROM private.submission_cohort_control WHERE singleton)THEN RETURN private.dashboard_admin_live_submission_analysis(q);END IF;
 -- Exact copy of the original prologue validates the active session, role
 -- gateway/data scope, native identity and every original request field first.
 c:=private.submission_cohort_context(q);
 IF c IS NULL THEN RETURN private.dashboard_admin_live_submission_analysis(q);END IF;
 t:=c->'target';dep:=private.submission_cohort_semantic(t);
 SELECT jsonb_agg(jsonb_build_object('date',ds::date,'version',private.submission_cohort_version(t,ds::date))ORDER BY ds)INTO v
 FROM generate_series((c->>'from')::date,(c->>'through')::date,interval'1day')ds;
 IF dep IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v)x WHERE x->'version'='null'::jsonb)THEN
  RETURN jsonb_build_object('prepared',jsonb_build_object('contract','submission-exact-window-v1','status','failed','reason','submission_source_unverifiable','platformId',q->'platformId','startAt',q->'startAt','endAt',q->'endAt','currency',q->'currency','operation','summary','threshold',15,'charts',false),'result',NULL);
 END IF;
 k:=jsonb_build_array('submission-exact-window-v1',q,t);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 IF a.id IS NOT NULL AND a.payload->>'contract'='submission-exact-window-v1'AND a.payload->'request'=q AND a.payload->'target'=t AND a.dependency=dep
 AND jsonb_typeof(a.payload->'result'->'metrics')='array'AND jsonb_typeof(a.payload->'result'->'coverage')='object'THEN
  old_result:=a.payload->'result';
  IF a.revision=j.revision AND j.dependency=dep AND a.payload->'version'=v AND(a.payload->>'validUntil'IS NULL OR(a.payload->>'validUntil')::timestamptz>at)THEN
   IF force OR a.expires_at<=at THEN UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=at WHERE id=j.id AND status='ready'AND revision=a.revision AND dependency=dep;END IF;
   UPDATE private.withdraw_prepared_jobs SET last_requested_at=at,scope=scope||jsonb_build_object('humanRequestedAt',at)WHERE id=j.id AND last_requested_at<at-interval'5minutes';
   SELECT status INTO freshness FROM private.withdraw_prepared_jobs WHERE id=j.id;
   RETURN old_result||jsonb_build_object('publication',jsonb_build_object('contract','submission-exact-window-v1','status','ready','computedAt',a.computed_at,'expiresAt',a.expires_at,
    'sourceAsOf',old_result->'asOf','freshness',CASE WHEN NOT force AND a.expires_at>at THEN'fresh'ELSE'refresh_due'END,'servedLastComplete',false,'refreshState',CASE WHEN freshness IN('queued','running','failed')THEN freshness ELSE'idle'END));
  END IF;
 END IF;
 -- Reserve one authenticated window before any child source/job locks. Day
 -- children are mechanical dependencies, never extra unbudgeted user windows.
 IF j.id IS NULL THEN
  IF auth.uid()IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='submission_prepared_actor_required';END IF;
  INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
  IF budget IS NULL THEN RETURN jsonb_build_object('prepared',jsonb_build_object('contract','submission-exact-window-v1','status','failed','reason','submission_admission_limited','platformId',q->'platformId','startAt',q->'startAt','endAt',q->'endAt','currency',q->'currency','operation','summary','threshold',15,'charts',false),'result',NULL);END IF;
 END IF;
 FOR child IN SELECT *FROM jsonb_array_elements(v)LOOP
  v_day:=(child->>'date')::date;dv:=child->'version';
  sid:=private.submission_cohort_admit(private.submission_cohort_day_request(t,v_day),t,dep,dv,NULL,true);
  IF sid IS NULL OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs z WHERE z.id=sid AND z.status='failed'AND z.attempts>=3)THEN source_failed:=true;END IF;
  children:=children||jsonb_build_array(child||jsonb_build_object('jobId',sid));
 END LOOP;
 sid:=private.submission_cohort_admit(q,t,dep,v,children,true);
 IF sid IS NOT NULL AND NOT source_failed THEN PERFORM private.submission_cohort_wake(sid);END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=sid;
 IF old_result IS NOT NULL THEN
  RETURN old_result||jsonb_build_object('publication',jsonb_build_object('contract','submission-exact-window-v1','status','ready','computedAt',a.computed_at,'expiresAt',a.expires_at,'sourceAsOf',old_result->'asOf',
   'freshness','refresh_due','servedLastComplete',true,'refreshState',CASE WHEN source_failed OR j.id IS NULL OR j.status='failed'AND j.attempts>=3 THEN'failed'ELSE CASE WHEN j.status='running'THEN'running'ELSE'queued'END END));
 END IF;
 RETURN jsonb_build_object('prepared',jsonb_build_object('contract','submission-exact-window-v1','status',CASE WHEN source_failed OR j.id IS NULL OR j.status='failed'AND j.attempts>=3 THEN'failed'ELSE'building'END,
 'reason',CASE WHEN source_failed OR j.id IS NULL THEN'submission_admission_limited'WHEN j.status='failed'AND j.attempts>=3 THEN coalesce(j.last_error,'submission_compute_failed')ELSE'submission_preparing'END,'platformId',q->'platformId','startAt',q->'startAt','endAt',q->'endAt','currency',q->'currency','operation','summary','threshold',15,'charts',false),'result',NULL);
END;$function$;
REVOKE ALL ON FUNCTION private.submission_cohort_context(jsonb),private.submission_cohort_semantic(jsonb),private.submission_cohort_day_key(jsonb,date),private.submission_cohort_day_request(jsonb,date),private.submission_cohort_day_ready(private.withdraw_prepared_jobs,private.withdraw_prepared_artifacts,jsonb,date,text,jsonb),private.submission_cohort_admit(jsonb,jsonb,text,jsonb,jsonb,boolean),private.submission_cohort_wake(uuid),private.submission_cohort_read(jsonb)FROM PUBLIC,anon,authenticated,service_role;
-- Match the existing invoker public wrapper -> authenticated private parent
-- arrangement. The read function performs the original session/scope admission
-- before any cache access; all other new helpers remain owner-only.
GRANT EXECUTE ON FUNCTION private.submission_cohort_read(jsonb)TO authenticated;
