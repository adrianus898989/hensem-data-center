-- The two success-clock probes return the original EXISTS for every window.
-- Keep the existing dependency fingerprints for the reviewed function bodies.
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '60s';
DO $migration$
DECLARE
 sig regprocedure; definition text; before_meta jsonb; actual text;
 fingerprints jsonb; refreshed jsonb; country_tokens jsonb; countries text[];
BEGIN
 SELECT jsonb_object_agg(p.oid::text,private.dashboard_withdraw_status_dependency_md5(p))
 INTO fingerprints FROM pg_proc p
 WHERE p.pronamespace='private'::regnamespace
 AND p.proname IN ('prepared_aggregate_newar_withdraw_clock_guard','prepared_aggregate_dependency_common','provider_snapshot_dependency_token');
 SELECT array_agg(DISTINCT t->>'scope_group' ORDER BY t->>'scope_group') INTO countries
 FROM private.prepared_aggregate_schedule s, jsonb_array_elements(s.approved_targets) t
 WHERE s.singleton AND t->>'scope_group' IS NOT NULL;
 SELECT jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))
 INTO country_tokens FROM unnest(countries) scope;
 sig:='private.prepared_aggregate_newar_withdraw_clock_guard(jsonb,jsonb)'::regprocedure;
 SELECT pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc', md5(p.prosrc)
 INTO definition, before_meta, actual FROM pg_proc p WHERE p.oid=sig;
 IF actual IS DISTINCT FROM 'a81d8f161b73e2293fc4d880c0264d3d' THEN RAISE EXCEPTION 'unexpected body for %',sig; END IF;
 definition:=replace(definition,$before$ SELECT EXISTS(SELECT 1 FROM public.newar_detail_records n
  WHERE n.platform=platform_name AND n.dataset='withdraw' AND n.status_group='success'
   AND n.success_at IS NOT NULL AND n.created_at<end_at AND(basis<>'created'or n.created_at>=(q->>'startAt')::timestamptz)) INTO known_clock;$before$,$after$ -- First test whether any successful withdrawal for this platform has a
 -- recorded clock. The native success index resolves this without fetching
 -- the platform's order history when no known clock exists.
 SELECT EXISTS (
  SELECT FROM public.newar_detail_records n
  WHERE n.platform = platform_name AND n.dataset = 'withdraw'
   AND n.status_group = 'success' AND n.success_at IS NOT NULL
 ) INTO known_clock;
 IF known_clock THEN
  -- A custom plan retains both creation bounds for a created cohort and
  -- can use a platform-specific covering index. Bind all four values.
  EXECUTE $clock$
   SELECT EXISTS (
    SELECT FROM public.newar_detail_records n
    WHERE n.platform = $1 AND n.dataset = 'withdraw'
     AND n.status_group = 'success' AND n.success_at IS NOT NULL
     AND n.created_at < $2 AND ($3 <> 'created' OR n.created_at >= ($4->>'startAt')::timestamptz)
   )
  $clock$ INTO known_clock USING platform_name, end_at, basis, q;
 END IF;$after$);
 EXECUTE definition;
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=sig AND md5(p.prosrc)='b521a8ce3ef8d0bef2ba156a2eb7ed4d' AND to_jsonb(p)-'prosrc'=before_meta)
 THEN RAISE EXCEPTION 'clock guard replacement or function metadata mismatch on %',sig; END IF;
 sig:='private.dashboard_withdraw_status_dependency_md5(pg_proc)'::regprocedure;
 SELECT pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc', md5(p.prosrc)
 INTO definition, before_meta, actual FROM pg_proc p WHERE p.oid=sig;
 IF actual IS DISTINCT FROM 'b7bbc8b77c7e0ff2c6605ffe2be13277' THEN RAISE EXCEPTION 'unexpected body for %',sig; END IF;
 definition:=replace(definition,$before$ IF p.oid=to_regprocedure('private.prepared_aggregate_raw_kernel(jsonb,jsonb)') THEN$before$,$after$ -- Only this byte-exact clock lookup is equivalent to the previous EXISTS.
 IF p.oid=to_regprocedure('private.prepared_aggregate_newar_withdraw_clock_guard(jsonb,jsonb)') THEN
  IF md5(p.prosrc)='b521a8ce3ef8d0bef2ba156a2eb7ed4d' AND pg_get_userbyid(p.proowner)='postgres'
    AND p.proacl::text='{postgres=X/postgres}' AND p.proconfig=ARRAY['search_path=""']
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.prosecdef
    AND p.provolatile='s' AND NOT p.proisstrict AND p.proparallel='u' AND NOT p.proleakproof
    AND p.procost=100 AND p.prorows=0 AND NOT p.proretset AND p.pronargdefaults=0
    AND pg_get_function_arguments(p.oid)='p_result jsonb, p_request jsonb'
    AND pg_get_function_result(p.oid)='jsonb'
  THEN RETURN 'a81d8f161b73e2293fc4d880c0264d3d'; END IF;
  RETURN md5(p.prosrc);
 END IF;
 IF p.oid=to_regprocedure('private.prepared_aggregate_raw_kernel(jsonb,jsonb)') THEN$after$);
 EXECUTE definition;
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=sig AND md5(p.prosrc)='4fb5915669754ca50d6fe8a7e3660f6d' AND to_jsonb(p)-'prosrc'=before_meta)
 THEN RAISE EXCEPTION 'clock guard replacement or function metadata mismatch on %',sig; END IF;
 sig:='private.prepared_aggregate_dependency_common(text)'::regprocedure;
 SELECT pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc', md5(p.prosrc)
 INTO definition, before_meta, actual FROM pg_proc p WHERE p.oid=sig;
 IF actual IS DISTINCT FROM '8a2085947b17fa25f8654cfa231e8506' THEN RAISE EXCEPTION 'unexpected body for %',sig; END IF;
 definition:=replace(definition,$before$b7bbc8b77c7e0ff2c6605ffe2be13277$before$,$after$4fb5915669754ca50d6fe8a7e3660f6d$after$);
 EXECUTE definition;
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=sig AND md5(p.prosrc)='83d1eb11fb3c22e72859e51ed04f4473' AND to_jsonb(p)-'prosrc'=before_meta)
 THEN RAISE EXCEPTION 'clock guard replacement or function metadata mismatch on %',sig; END IF;
 sig:='private.provider_snapshot_dependency_token(jsonb)'::regprocedure;
 SELECT pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc', md5(p.prosrc)
 INTO definition, before_meta, actual FROM pg_proc p WHERE p.oid=sig;
 IF actual IS DISTINCT FROM 'a01aad07f1db2873d5d82d641edd14ca' THEN RAISE EXCEPTION 'unexpected body for %',sig; END IF;
 definition:=replace(definition,$before$b7bbc8b77c7e0ff2c6605ffe2be13277$before$,$after$4fb5915669754ca50d6fe8a7e3660f6d$after$);
 EXECUTE definition;
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=sig AND md5(p.prosrc)='674044461463d0aeadd58c86349396e8' AND to_jsonb(p)-'prosrc'=before_meta)
 THEN RAISE EXCEPTION 'clock guard replacement or function metadata mismatch on %',sig; END IF;
 SELECT jsonb_object_agg(p.oid::text,private.dashboard_withdraw_status_dependency_md5(p))
 INTO refreshed FROM pg_proc p
 WHERE p.pronamespace='private'::regnamespace
 AND p.proname IN ('prepared_aggregate_newar_withdraw_clock_guard','prepared_aggregate_dependency_common','provider_snapshot_dependency_token');
 IF refreshed IS DISTINCT FROM fingerprints THEN RAISE EXCEPTION 'clock change altered effective function hashes'; END IF;
 SELECT jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope)) INTO refreshed FROM unnest(countries) scope;
 IF country_tokens IS NULL OR refreshed IS DISTINCT FROM country_tokens THEN RAISE EXCEPTION 'clock change altered country dependencies'; END IF;
END;
$migration$;
