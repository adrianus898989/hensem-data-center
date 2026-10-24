CREATE OR REPLACE FUNCTION private.withdraw_reason_compute(q jsonb, c jsonb, v jsonb, d text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='withdraw_reason_compute_denied';END IF;
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'withdraw_reason_read_committed_required';END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR d IS DISTINCT FROM md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN NULL;END IF;
 IF c->'native'->>'source'='ar'THEN result:=private.withdraw_reason_ar_all(q,c);
 ELSIF c->'native'->>'source'='newar'THEN
  -- Owner-only worker uses a server-resolved single native; this is an argument
  -- to the pure original SQL, never a JWT/session or a public-RPC impersonation.
  result:=private.withdraw_reason_newar_all(q,'{"mode":"all","countries":[]}'::jsonb,c->'native');
 ELSE RETURN NULL;END IF;
 IF private.withdraw_reason_context_current(c)IS NOT TRUE OR private.withdraw_reason_versions_match(v)IS NOT TRUE
 OR d IS DISTINCT FROM md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text)THEN RETURN NULL;END IF;
 IF result IS NULL OR result->>'kind'IS DISTINCT FROM'blocking'OR jsonb_typeof(result->'rows')IS DISTINCT FROM'array'OR jsonb_typeof(result->'total')IS DISTINCT FROM'number'OR coalesce(result->>'total','')!~'^[0-9]+$'
 OR(result->>'total')::bigint<>jsonb_array_length(result->'rows')THEN RAISE EXCEPTION 'withdraw_reason_incomplete';END IF;
 IF c->'native'->>'source'='newar'AND private.withdraw_reason_newar_index_valid(result)IS NOT TRUE THEN RAISE EXCEPTION 'withdraw_reason_label_index_incomplete';END IF;
 IF octet_length(result::text)>4000000 THEN RAISE EXCEPTION 'withdraw_reason_payload_too_large';END IF;
 RETURN jsonb_build_object('contract','withdraw-reasons-blocking-v1','request',q,'context',c,'version',v,'result',result,'computedAt',clock_timestamp());
END;$function$

