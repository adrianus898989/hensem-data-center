-- Temporary opt-in warmup uses the existing authenticated gateway. It records
-- only the server-derived scope/catalog and normalized aggregate request.
-- No JWT, login, role-context signature or source-order payload is copied.
CREATE TABLE private.withdraw_prepared_release(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),capture_hash text,capture_ends_at timestamptz,cutover_at timestamptz);
INSERT INTO private.withdraw_prepared_release(singleton)VALUES(true);
ALTER TABLE private.withdraw_prepared_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_prepared_release FROM public,anon,authenticated,service_role;
CREATE FUNCTION private.withdraw_prepared_capture(q jsonb)RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;budget integer;old_lock text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_release WHERE singleton AND capture_ends_at>clock_timestamp()AND cutover_at IS NULL)THEN RETURN;END IF;
 -- Real main already validated this exact request. These calls preserve the
 -- existing signed gateway context and recheck current authorized identities.
 PERFORM private.withdraw_prepared_validate(q);s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 r:=private.withdraw_prepared_canonical(q);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);
 old_lock:=current_setting('lock_timeout');
 BEGIN
  PERFORM set_config('lock_timeout','100ms',true);
  IF NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k)THEN
   INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
   IF budget IS NULL THEN PERFORM set_config('lock_timeout',old_lock,true);RETURN;END IF;
  END IF;
  PERFORM private.withdraw_prepared_enqueue(r,s,c,private.withdraw_prepared_dependency());
 EXCEPTION WHEN OTHERS THEN
  -- A derived-cache admission failure cannot replace or block the established
  -- main result. Query cancellation is deliberately not swallowed.
  NULL;
 END;
 PERFORM set_config('lock_timeout',old_lock,true);
END;$$;
CREATE FUNCTION private.withdraw_prepared_begin_capture()RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE p record;w record;d text;b text;anchor text:=' for v_target in select value from jsonb_array_elements(v_targets) loop';expected text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 SELECT capture_hash INTO expected FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL;
 IF expected IS NOT NULL AND md5(p.prosrc)=expected AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.provolatile='v'AND p.proconfig=ARRAY['search_path=""']AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'THEN
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
  RETURN;END IF;
 IF md5(p.prosrc)<>'12fe721956fb291f2c2b93a5d5187fbd'OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.provolatile<>'s'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_capture_baseline_drift';END IF;
 IF w.provolatile<>'s'THEN RAISE EXCEPTION 'withdraw_prepared_capture_public_baseline_drift';END IF;
 IF(length(p.prosrc)-length(replace(p.prosrc,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_capture_anchor';END IF;
 b:=replace(p.prosrc,anchor,E' perform private.withdraw_prepared_capture(p_request);\n'||anchor);
 d:=pg_get_functiondef(p.oid);d:=replace(d,p.prosrc,b);EXECUTE d;ALTER FUNCTION private.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET capture_hash=md5(b),capture_ends_at=clock_timestamp()+interval'15minutes'WHERE singleton;
END;$$;
-- Revert only this temporary insertion. Keep admitted jobs/templates for later
-- inspection; neither a retry nor rollback silently extends capture lifetime.
CREATE FUNCTION private.withdraw_prepared_abort_capture()RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE p record;w record;d text;b text;expected text;insertion text:=E' perform private.withdraw_prepared_capture(p_request);\n';
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 SELECT capture_hash INTO expected FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL;
 IF md5(p.prosrc)='12fe721956fb291f2c2b93a5d5187fbd'AND p.provolatile='s'AND pg_get_userbyid(p.proowner)='postgres'AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'THEN
 IF w.provolatile<>'s'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)STABLE;PERFORM pg_notify('pgrst','reload schema');END IF;
  RETURN;END IF;
 IF expected IS NULL OR md5(p.prosrc)IS DISTINCT FROM expected OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.provolatile<>'v'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_capture_rollback_drift';END IF;
 b:=replace(p.prosrc,insertion,'');
 IF md5(b)<>'12fe721956fb291f2c2b93a5d5187fbd'THEN RAISE EXCEPTION 'withdraw_prepared_capture_rollback_body';END IF;
 d:=pg_get_functiondef(p.oid);d:=replace(d,p.prosrc,b);EXECUTE d;ALTER FUNCTION private.dashboard_admin_live_auto_withdraw(jsonb)STABLE;
 IF w.provolatile<>'s'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)STABLE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET capture_ends_at=null WHERE singleton;
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_capture(jsonb),private.withdraw_prepared_begin_capture(),private.withdraw_prepared_abort_capture() FROM public,anon,authenticated,service_role;
