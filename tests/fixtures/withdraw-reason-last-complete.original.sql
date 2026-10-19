-- Code-only prior admission/page functions. Synthetic source fixtures supply
-- metadata dependencies; no captured account, directory, receipt or payload.
CREATE OR REPLACE FUNCTION private.withdraw_reason_dependency()RETURNS text LANGUAGE sql STABLE SET search_path=''AS $function$
 SELECT md5(jsonb_build_array('original-reason-source-4dcc-7c63-v1',coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),to_jsonb(p)-ARRAY['oid','prosrc','probin'])ORDER BY p.oid),'[]'::jsonb))::text)
 FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND (
  p.proname LIKE 'withdraw_reason_%'OR p.proname LIKE'dashboard_admin_live_blocking_%'OR p.proname LIKE'dashboard_admin_live_rejection_%'OR p.proname LIKE'dashboard_admin_live_%note%'OR p.proname IN(
   'dashboard_admin_newar_withdraw_reasons',
   'dashboard_admin_live_clean_note','dashboard_admin_live_blocking_details_cleaned','dashboard_admin_live_blocking_category',
   'dashboard_admin_live_rejection_exact_note','dashboard_admin_live_rejection_exact_key',
   'ar_withdraw_detail_evidence_generation','dashboard_admin_ar_local_amount','dashboard_admin_live_withdraw_key',
   'dashboard_scope_allows','dashboard_data_scope_valid','dashboard_data_group','dashboard_scope_platform_key'));
$function$;
CREATE OR REPLACE FUNCTION private.withdraw_reason_context_current(c jsonb)RETURNS boolean LANGUAGE sql STABLE SET search_path=''AS $function$
 SELECT coalesce(jsonb_typeof(c)='object'AND jsonb_typeof(c->'native')='object'AND jsonb_typeof(c->'aliases')='array'
 AND jsonb_array_length(c->'aliases')=3 AND c->'native'->>'source'IN('ar','newar')
 AND private.withdraw_prepared_catalog_current(jsonb_build_array(c->'native'))AND private.withdraw_reason_parent_current(),false);
$function$;
CREATE OR REPLACE FUNCTION private.withdraw_reason_page(payload jsonb,q jsonb)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=''AS $function$
 SELECT (payload-ARRAY['rows','offset','limit'])||jsonb_build_object(
  'offset',coalesce((q->>'offset')::integer,0),'limit',coalesce((q->>'limit')::integer,20),
  'rows',coalesce((SELECT jsonb_agg(e.item ORDER BY e.n) FROM jsonb_array_elements(payload->'rows')WITH ORDINALITY e(item,n)
   WHERE e.n>coalesce((q->>'offset')::integer,0)AND e.n<=coalesce((q->>'offset')::integer,0)+coalesce((q->>'limit')::integer,20)),'[]'::jsonb));
$function$;
CREATE OR REPLACE FUNCTION private.withdraw_reason_enqueue(q jsonb,c jsonb,v jsonb,d text,p_owner_warm boolean DEFAULT false)RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE k jsonb:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);j private.withdraw_prepared_jobs%rowtype;budget integer;sid uuid;recent boolean;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_admission_denied';END IF;
 IF v IS NULL OR d IS NULL OR private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k FOR UPDATE;
 IF FOUND THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=CASE WHEN p_owner_warm THEN last_requested_at ELSE clock_timestamp()END,
   dependency=d,scope=jsonb_build_object('context',c,'version',v)||(j.scope-ARRAY['context','version'])||CASE WHEN p_owner_warm THEN '{}'::jsonb ELSE jsonb_build_object('humanRequestedAt',clock_timestamp())END,
   revision=revision+CASE WHEN dependency IS DISTINCT FROM d OR scope->'version'IS DISTINCT FROM v THEN 1 ELSE 0 END,
   status=CASE WHEN status='running'THEN status WHEN dependency IS DISTINCT FROM d OR scope->'version'IS DISTINCT FROM v THEN'queued'ELSE status END,
   attempts=CASE WHEN status<>'running'AND(dependency IS DISTINCT FROM d OR scope->'version'IS DISTINCT FROM v)THEN 0 ELSE attempts END,
   not_before=CASE WHEN dependency IS DISTINCT FROM d OR scope->'version'IS DISTINCT FROM v THEN clock_timestamp()ELSE not_before END
  WHERE id=j.id;RETURN j.id;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN NULL;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_jobs)>=2000 OR(SELECT count(*)FROM private.withdraw_prepared_jobs WHERE request_key->>0='withdraw-reasons-blocking-v1')>=256 THEN RETURN NULL;END IF;
 recent:=private.withdraw_reason_recent(q,c,statement_timestamp());
 IF NOT recent AND(SELECT count(*)FROM private.withdraw_prepared_jobs z WHERE z.request_key->>0='withdraw-reasons-blocking-v1'AND NOT private.withdraw_reason_recent(z.request,z.scope->'context',statement_timestamp()))>=64 THEN RETURN NULL;END IF;
 IF p_owner_warm IS NOT TRUE THEN
  IF auth.uid()IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_actor_required';END IF;
  INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)
   ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
  IF budget IS NULL THEN RETURN NULL;END IF;
 END IF;
 INSERT INTO private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency)
 VALUES(k,q,jsonb_build_object('context',c,'version',v)||CASE WHEN p_owner_warm THEN '{}'::jsonb ELSE jsonb_build_object('humanRequestedAt',clock_timestamp())END,jsonb_build_array(c->'native'),d)
 ON CONFLICT(fingerprint)DO UPDATE SET last_requested_at=excluded.last_requested_at
 WHERE private.withdraw_prepared_jobs.request_key=excluded.request_key RETURNING id INTO sid;
 RETURN sid;
END;$function$;
CREATE OR REPLACE FUNCTION private.withdraw_reason_read(p_request jsonb,p_scope jsonb,p_native jsonb,p_aliases jsonb,p_raw_only boolean)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $function$
DECLARE q jsonb;c jsonb;v jsonb;d text;k jsonb;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;sid uuid;day date;at timestamptz:=clock_timestamp();
BEGIN
 -- The original parent performed request validation, live session/page/data-scope
 -- admission and fresh native resolution. Keep an independent native scope check.
 IF current_user<>'postgres'OR NOT private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 IF jsonb_typeof(p_native)IS DISTINCT FROM'object'OR coalesce(p_request->>'kind','blocking')<>'blocking'OR coalesce(p_native->>'source','')NOT IN('ar','newar')
 OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))
 OR nullif(p_request->>'category','')IS NOT NULL OR nullif(p_request->>'reasonKey','')IS NOT NULL
 OR nullif(p_request->>'operatorKey','')IS NOT NULL OR nullif(btrim(p_request->>'query'),'')IS NOT NULL THEN RETURN NULL;END IF;
 day:=(p_request->>'date')::date;
 IF nullif(p_native->>'timezone','')IS NULL OR(day+1)::timestamp AT TIME ZONE(p_native->>'timezone')>statement_timestamp()THEN RETURN NULL;END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',day,'kind','blocking','offset',0,'limit',500);
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 v:=private.withdraw_reason_versions_ensure(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)),day);
 IF v IS NULL THEN RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind','blocking','rows',null,'total',null,'summary',null,'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1','status','failed','reason','withdraw_reasons_source_unverifiable'));END IF;
 d:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);k:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 IF a.id IS NOT NULL AND a.revision=j.revision AND a.dependency=d AND j.dependency=d
 AND a.payload->>'contract'='withdraw-reasons-blocking-v1'AND a.payload->'request'=q AND a.payload->'context'=c AND a.payload->'version'=v
 AND jsonb_typeof(a.payload->'result'->'rows')='array'AND(a.payload->'result'->>'total')::bigint=jsonb_array_length(a.payload->'result'->'rows')
 AND private.withdraw_reason_context_current(c)AND private.withdraw_reason_versions_match(v)THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=at,scope=scope||jsonb_build_object('humanRequestedAt',at) WHERE id=j.id AND last_requested_at<at-interval'5minutes';
  RETURN private.withdraw_reason_page(a.payload->'result',p_request);
 END IF;
 sid:=private.withdraw_reason_enqueue(q,c,v,d,false);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=sid;
 RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind','blocking','rows',null,'total',null,'summary',null,
  'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1',
   'status',CASE WHEN j.id IS NULL OR j.status='failed'AND j.attempts>=3 THEN'failed'ELSE'building'END,
   'reason',CASE WHEN j.id IS NULL THEN'withdraw_reasons_admission_limited'WHEN j.status='failed'AND j.attempts>=3 THEN coalesce(j.last_error,'withdraw_reasons_compute_failed')ELSE'withdraw_reasons_preparing'END));
END;$function$;
CREATE OR REPLACE FUNCTION private.withdraw_reason_recent(q jsonb,c jsonb,at timestamptz)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''AS $function$
 SELECT coalesce((q->>'date')::date>=(at AT TIME ZONE(c->'native'->>'timezone'))::date-2
 AND(q->>'date')::date<(at AT TIME ZONE(c->'native'->>'timezone'))::date
 AND q->>'platform'=c->'native'->>'name'AND c->'aliases'=jsonb_build_array(c->'native'->>'name',c->'native'->>'name',c->'native'->>'source_name'),false);
$function$;
