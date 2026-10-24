CREATE OR REPLACE FUNCTION private.withdraw_prepared_reason_last_complete(p_request jsonb, p_scope jsonb, p_native jsonb, p_aliases jsonb, p_raw_only boolean, p_preparing jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE q jsonb;c jsonb;v jsonb;old_v jsonb;token text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;
 compat private.withdraw_prepared_reason_compat%rowtype;publication jsonb;error_code text;key jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_last_complete_owner_only';END IF;
 SELECT *INTO compat FROM private.withdraw_prepared_reason_compat WHERE singleton;
 IF NOT FOUND OR NOT compat.enabled OR compat.new_token IS NULL THEN RETURN NULL;END IF;
 -- This is reached only after the unchanged ordinary read authorized the exact
 -- native and attempted admission. Do not reinterpret unknown/future states.
 IF p_preparing->'prepared'->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'
 OR coalesce(p_preparing->'prepared'->>'status','')NOT IN('building','failed')OR p_preparing->'available'IS DISTINCT FROM'false'::jsonb
 OR p_preparing->'rows'IS DISTINCT FROM'null'::jsonb OR p_preparing->'total'IS DISTINCT FROM'null'::jsonb OR p_preparing->'summary'IS DISTINCT FROM'null'::jsonb
 OR coalesce(p_request->>'kind','blocking')<>'blocking'OR nullif(p_request->>'category','')IS NOT NULL OR nullif(p_request->>'reasonKey','')IS NOT NULL
 OR nullif(p_request->>'operatorKey','')IS NOT NULL OR nullif(btrim(p_request->>'query'),'')IS NOT NULL
 OR coalesce(p_native->>'source','')NOT IN('ar','newar')OR(p_native->>'source'='ar'AND NOT coalesce(p_raw_only,false))THEN RETURN NULL;END IF;
 IF private.dashboard_scope_allows(p_scope,btrim(p_request->>'country'),btrim(p_request->>'platform'))IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied';END IF;
 q:=jsonb_build_object('country',btrim(p_request->>'country'),'platform',btrim(p_request->>'platform'),'date',(p_request->>'date')::date,'kind','blocking','offset',0,'limit',500);
 IF p_preparing->'country'IS DISTINCT FROM q->'country'OR p_preparing->'platform'IS DISTINCT FROM q->'platform'OR p_preparing->'date'IS DISTINCT FROM q->'date'OR p_preparing->>'kind'IS DISTINCT FROM'blocking'THEN RETURN NULL;END IF;
 c:=jsonb_build_object('native',p_native,'aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false));key:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 IF private.withdraw_reason_context_current(c)IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(key::text)AND request_key=key AND request=q;
 IF j.id IS NULL OR j.status NOT IN('queued','running','failed')OR j.scope->'context'IS DISTINCT FROM c OR j.catalog IS DISTINCT FROM jsonb_build_array(p_native)THEN RETURN NULL;END IF;
 -- Reuse the vector created by the ordinary read; match invokes the original
 -- ensure once and rejects poison, broken hooks, future gates or source races.
 v:=j.scope->'version';token:=private.withdraw_reason_dependency();
 IF v->'native'IS DISTINCT FROM(p_native||jsonb_build_object('aliases',p_aliases,'rawOnly',coalesce(p_raw_only,false)))
 OR v->'day'IS DISTINCT FROM q->'date'OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR j.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,v)::text)THEN RETURN NULL;END IF;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id AND x.job_id=j.id;
 IF a.id IS NULL OR a.revision>j.revision OR a.fence>j.fence OR a.bytes>4194304 OR a.computed_at>statement_timestamp()
 OR a.payload->'result'->>'reasonGrouping'IS DISTINCT FROM'atomic_rules_v1'OR(c->'native'->>'source'='newar'AND private.withdraw_reason_newar_index_valid(a.payload->'result')IS NOT TRUE)OR a.payload->>'contract'IS DISTINCT FROM'withdraw-reasons-blocking-v1'OR a.payload->'request'IS DISTINCT FROM q OR a.payload->'context'IS DISTINCT FROM c
 OR jsonb_typeof(a.payload->'version')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'version'->'keys')IS DISTINCT FROM'array'OR jsonb_typeof(a.payload->'result'->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(a.payload->'result'->'total')IS DISTINCT FROM'number'OR coalesce(a.payload->'result'->>'total','')!~'^[0-9]+$'
 OR(a.payload->'result'->>'total')::numeric<>jsonb_array_length(a.payload->'result'->'rows')
 OR jsonb_typeof(a.payload->'result'->'summary')IS DISTINCT FROM'object'OR jsonb_typeof(a.payload->'result'->'coverage')IS DISTINCT FROM'object'
 OR a.payload->'result'->'available'IS DISTINCT FROM'true'::jsonb THEN RETURN NULL;END IF;
 old_v:=a.payload->'version';
 -- Only source revisions/fingerprints may be older. Native, local date, schema,
 -- install identity, configuration and evidence semantics must still agree.
 IF old_v->'version'IS DISTINCT FROM v->'version'OR old_v->'native'IS DISTINCT FROM v->'native'OR old_v->'day'IS DISTINCT FROM v->'day'
 OR old_v->'installation'IS DISTINCT FROM v->'installation'OR old_v->'config'IS DISTINCT FROM v->'config'
 OR old_v->'evidence'->'generation'IS DISTINCT FROM v->'evidence'->'generation'
 OR(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(old_v->'keys')WITH ORDINALITY e(x,n))
 IS DISTINCT FROM(SELECT jsonb_agg(x-'revision'ORDER BY n)FROM jsonb_array_elements(v->'keys')WITH ORDINALITY e(x,n))THEN RETURN NULL;END IF;
 IF a.dependency IS DISTINCT FROM md5(jsonb_build_array(token,c,old_v)::text)THEN
  -- Exact sealed compatibility is for this audited guard-only routing release.
  -- ANY later module code/metadata change invalidates the legacy allowance.
  IF compat.new_token IS NULL OR token IS DISTINCT FROM compat.new_token
  OR a.dependency IS DISTINCT FROM md5(jsonb_build_array(compat.old_token,c,old_v)::text)THEN RETURN NULL;END IF;
 END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_dependency()IS DISTINCT FROM token THEN RETURN NULL;END IF;
 publication:=jsonb_build_object('contract','withdraw-reasons-last-complete-v1','status','ready','servedLastComplete',true,'freshness','refresh_due',
  'computedAt',a.computed_at,'updatedAt',a.payload->'result'->'updatedAt','refreshState',j.status);
 error_code:=j.last_error;IF error_code~'^[a-z][a-z0-9_]{0,79}$'THEN publication:=publication||jsonb_build_object('refreshError',error_code);END IF;
 RETURN private.withdraw_reason_page(a.payload->'result',p_request)||jsonb_build_object('publication',publication);
END;$function$

