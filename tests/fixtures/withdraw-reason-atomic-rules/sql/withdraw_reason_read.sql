CREATE OR REPLACE FUNCTION private.withdraw_reason_read(p_request jsonb, p_scope jsonb, p_native jsonb, p_aliases jsonb, p_raw_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE q jsonb;c jsonb;v jsonb;d text;k jsonb;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;sid uuid;day date;at timestamptz:=clock_timestamp();detail_result jsonb;detail boolean:=coalesce(p_native->>'source'='newar'AND p_request->>'kind'IN('blockingVariants','blockingOrders'),false);
BEGIN
 -- The original parent performed request validation, live session/page/data-scope
 -- admission and fresh native resolution. Keep an independent native scope check.
 IF current_user<>'postgres'OR NOT private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 IF jsonb_typeof(p_native)IS DISTINCT FROM'object'OR (coalesce(p_request->>'kind','blocking')<>'blocking'AND NOT detail)OR coalesce(p_native->>'source','')NOT IN('ar','newar')
 OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))
 OR nullif(p_request->>'category','')IS NOT NULL
 OR(NOT detail AND nullif(p_request->>'reasonKey','')IS NOT NULL)
 OR(detail AND coalesce(p_request->>'reasonKey','')!~'^[a-f0-9]{32}$')
 OR nullif(p_request->>'operatorKey','')IS NOT NULL
 OR(p_request->>'kind'IS DISTINCT FROM'blockingOrders'AND nullif(btrim(p_request->>'query'),'')IS NOT NULL) THEN RETURN NULL;END IF;
 day:=(p_request->>'date')::date;
 IF nullif(p_native->>'timezone','')IS NULL OR(day+1)::timestamp AT TIME ZONE(p_native->>'timezone')>statement_timestamp()THEN RETURN NULL;END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',day,'kind','blocking','offset',0,'limit',500);
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 v:=private.withdraw_reason_versions_ensure(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)),day);
 IF v IS NULL THEN RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind',coalesce(p_request->>'kind','blocking'),'rows',null,'total',null,'summary',null,'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1','status','failed','reason','withdraw_reasons_source_unverifiable'));END IF;
 d:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);k:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 IF a.id IS NOT NULL AND a.revision=j.revision AND a.dependency=d AND j.dependency=d
 AND a.payload->'result'->>'reasonGrouping'='atomic_rules_v1'AND a.payload->>'contract'='withdraw-reasons-blocking-v1'AND a.payload->'request'=q AND a.payload->'context'=c AND a.payload->'version'=v
 AND jsonb_typeof(a.payload->'result'->'rows')='array'AND(a.payload->'result'->>'total')::bigint=jsonb_array_length(a.payload->'result'->'rows')
 AND(p_native->>'source'<>'newar'OR private.withdraw_reason_newar_index_valid(a.payload->'result'))
 AND private.withdraw_reason_context_current(c)AND private.withdraw_reason_versions_match(v)THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=at,scope=scope||jsonb_build_object('humanRequestedAt',at) WHERE id=j.id AND last_requested_at<at-interval'5minutes';
  IF NOT detail THEN RETURN private.withdraw_reason_page(a.payload->'result',p_request);END IF;
  detail_result:=private.withdraw_reason_newar_detail_page(a.payload->'result',p_request,p_scope,p_native);
  -- An order-page source read cannot outlive the sealed source/config generation.
  IF private.withdraw_reason_context_current(c)AND private.withdraw_reason_versions_match(v)
   AND d=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN detail_result;END IF;
 END IF;
 sid:=private.withdraw_reason_enqueue(q,c,v,d,false);
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=sid;
 RETURN jsonb_build_object('available',false,'country',q->'country','platform',q->'platform','date',day,'kind',coalesce(p_request->>'kind','blocking'),'rows',null,'total',null,'summary',null,
  'prepared',jsonb_build_object('contract','withdraw-reasons-blocking-v1',
   'status',CASE WHEN j.id IS NULL OR j.status='failed'AND j.attempts>=3 THEN'failed'ELSE'building'END,
   'reason',CASE WHEN j.id IS NULL THEN'withdraw_reasons_admission_limited'WHEN j.status='failed'AND j.attempts>=3 THEN coalesce(j.last_error,'withdraw_reasons_compute_failed')ELSE'withdraw_reasons_preparing'END));
END;$function$

