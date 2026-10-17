-- Resume only the verified dormant 1–5 installation after the AR calendar hotfix.
-- No source records, jobs, published artifacts, original readers or cron change.
BEGIN;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
DO $resume_ar$
DECLARE src record;c record;guard record;contracts jsonb;e jsonb;expected jsonb;prefix text:='SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(';suffix text:='::jsonb)e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e->>''signature'') WHERE p.oid IS NULL OR(to_jsonb(p)-ARRAY[''oid'',''prosrc'']||jsonb_build_object(''bodyMd5'',md5(p.prosrc)))IS DISTINCT FROM e->''metadata'')';literal text;decoded text;body text;gbody text;before_meta jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION 'withdraw_resume_owner_only';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs)OR EXISTS(SELECT 1 FROM private.withdraw_prepared_artifacts)OR EXISTS(SELECT 1 FROM private.withdraw_prepared_scheduler WHERE enabled)THEN RAISE EXCEPTION 'withdraw_resume_not_dormant';END IF;
 SELECT *INTO src FROM pg_proc WHERE oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 IF md5(src.prosrc)IS DISTINCT FROM'173bf1a012f07d69942571724ff8f658'THEN RAISE EXCEPTION 'withdraw_resume_ar_source_drift';END IF;
 SELECT *INTO c FROM pg_proc WHERE oid='private.withdraw_prepared_native_ar(jsonb,jsonb,date,date,jsonb)'::regprocedure;
 IF md5(c.prosrc)IS DISTINCT FROM'b8b7e816123dd8003c90daa0439153d8'OR c.proowner<>'postgres'::regrole OR c.prosecdef OR c.provolatile<>'s'OR c.proparallel<>'u'OR c.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR c.proacl::text IS DISTINCT FROM'{postgres=X/postgres}'OR pg_get_function_arguments(c.oid)<>'p_request jsonb, p_scope jsonb, p_start date, p_end date, p_catalog jsonb'OR pg_get_function_result(c.oid)IS DISTINCT FROM pg_get_function_result(src.oid)THEN RAISE EXCEPTION 'withdraw_resume_clone_drift';END IF;
 SELECT *INTO guard FROM pg_proc WHERE oid='private.withdraw_prepared_source_contract_current()'::regprocedure;
 IF guard.proowner<>'postgres'::regrole OR guard.prosecdef OR guard.provolatile<>'s'OR guard.proparallel<>'u'OR guard.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR guard.proacl::text IS DISTINCT FROM'{postgres=X/postgres}'OR left(guard.prosrc,length(prefix))<>prefix OR right(guard.prosrc,length(suffix))<>suffix THEN RAISE EXCEPTION 'withdraw_resume_source_guard_drift';END IF;
 literal:=substring(guard.prosrc FROM length(prefix)+1 FOR length(guard.prosrc)-length(prefix)-length(suffix));
 IF right(literal,1)<>chr(39)THEN RAISE EXCEPTION 'withdraw_resume_source_guard_literal';END IF;
 IF left(literal,2)='E'||chr(39)THEN decoded:=replace(substring(literal FROM 3 FOR length(literal)-3),chr(92)||chr(92),chr(92));
 ELSIF left(literal,1)=chr(39)THEN decoded:=substring(literal FROM 2 FOR length(literal)-2);
 ELSE RAISE EXCEPTION 'withdraw_resume_source_guard_literal';END IF;
 contracts:=replace(decoded,chr(39)||chr(39),chr(39))::jsonb;
 IF prefix||quote_literal(contracts::text)||suffix IS DISTINCT FROM guard.prosrc OR jsonb_array_length(contracts)<>7 OR(SELECT count(DISTINCT x->>'signature')FROM jsonb_array_elements(contracts)x)<>7 THEN RAISE EXCEPTION 'withdraw_resume_source_guard_shape';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(contracts)LOOP
  SELECT to_jsonb(p)-ARRAY['oid','prosrc']||jsonb_build_object('bodyMd5',md5(p.prosrc))INTO expected FROM pg_proc p WHERE p.oid=to_regprocedure(e->>'signature');
  IF e->>'signature'='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'THEN expected:=jsonb_set(expected,'{bodyMd5}','"d372cd30224f4e1a6ff2e962d4df12b3"');END IF;
  IF expected IS NULL OR e->'metadata'IS DISTINCT FROM expected THEN RAISE EXCEPTION 'withdraw_resume_source_metadata_drift';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(contracts)x WHERE x->>'signature'='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)')THEN RAISE EXCEPTION 'withdraw_resume_ar_contract_missing';END IF;
 before_meta:=jsonb_build_array(to_jsonb(c)-'prosrc',to_jsonb(guard)-'prosrc');
 IF(length(c.prosrc)-length(replace(c.prosrc,$old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$old$,'')))/length($old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$old$)<>2 THEN RAISE EXCEPTION 'withdraw_resume_calendar_anchor';END IF;
 body:=replace(c.prosrc,$old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$old$,$new$(SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt$new$);
 EXECUTE replace(pg_get_functiondef(c.oid),c.prosrc,body);
 SELECT jsonb_agg(CASE WHEN x->>'signature'='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'THEN jsonb_set(x,'{metadata,bodyMd5}','"173bf1a012f07d69942571724ff8f658"')ELSE x END ORDER BY ord)INTO contracts FROM jsonb_array_elements(contracts)WITH ORDINALITY a(x,ord);
 gbody:=prefix||quote_literal(contracts::text)||suffix;
 EXECUTE replace(pg_get_functiondef(guard.oid),guard.prosrc,gbody);
 IF(SELECT jsonb_build_array((SELECT to_jsonb(p)-'prosrc'FROM pg_proc p WHERE oid=c.oid),(SELECT to_jsonb(p)-'prosrc'FROM pg_proc p WHERE oid=guard.oid)))IS DISTINCT FROM before_meta OR NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_resume_postcondition';END IF;
END;$resume_ar$;
COMMIT;
