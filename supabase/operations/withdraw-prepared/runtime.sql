CREATE FUNCTION private.withdraw_prepared_compute(q jsonb,s jsonb,c jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $$
DECLARE a date:=left(q->>'startAt',10)::date;b date:=left(q->>'endAt',10)::date;lo date;v jsonb:='{}';r record;t jsonb;parts jsonb:='{}';x jsonb;ps text[];
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_changed';END IF;
 lo:=a-(b-a+1);
 FOR r IN SELECT * FROM(VALUES('wg','wg'),('yash','yash'),('newar','newar'),('ar','ar'),('duoli','duoli'))z(k,fn) LOOP
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(d)),''[]''::jsonb)FROM private.withdraw_prepared_native_'||r.fn||'($1,$2,$3,$4,$5)d'INTO x USING q,s,lo,b,c;
  v:=v||jsonb_build_object(r.k,x);
 END LOOP;
 IF q->>'view'='auto'AND private.withdraw_window_whole_days(q)AND lo<date'2026-10-10'THEN
  SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]')INTO x FROM private.withdraw_prepared_native_arhistory(q,s,lo,least(b,date'2026-10-09'),c)d;
 ELSE x:='[]';END IF;v:=v||jsonb_build_object('arHistory',x);
 FOR t IN SELECT value FROM jsonb_array_elements(coalesce(q->'scopeTargets',jsonb_build_array(jsonb_build_object('country',q->>'country')))) LOOP
  IF EXISTS(SELECT 1 FROM public.game66_platforms WHERE team_name=t->>'country')THEN
   ps:=CASE WHEN q?'scopeTargets'THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(value)FROM jsonb_array_elements_text(t->'platforms'))WHEN nullif(q->>'platform','')IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(q->>'platform')]WHEN q?'platforms'THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(value)FROM jsonb_array_elements_text(q->'platforms'))END;
   IF cardinality(ps)=0 THEN ps:=null;END IF;
   x:=private.withdraw_prepared_native_game66(lo,b,t->>'country',ps,s,q,c);parts:=parts||jsonb_build_object(t->>'country',x);
  END IF;
 END LOOP;
 RETURN v||jsonb_build_object('game66',parts,'contract','withdraw-independent-windows-v2','request',q,'catalog',c,'scope',s,'computedAt',clock_timestamp(),'secondary',private.withdraw_window_secondary(q,s,c));
END;$$;
CREATE FUNCTION private.withdraw_prepared_enqueue(q jsonb,s jsonb,c jsonb,dep text)RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE k jsonb:=jsonb_build_array('withdraw-independent-windows-v2',s,c,q);j private.withdraw_prepared_jobs%rowtype;
BEGIN
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k FOR UPDATE;
 IF FOUND THEN
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=clock_timestamp(),
   status=CASE WHEN dependency<>dep THEN'queued'ELSE status END,revision=revision+CASE WHEN dependency<>dep THEN 1 ELSE 0 END,
   attempts=CASE WHEN dependency<>dep THEN 0 ELSE attempts END,lease_until=CASE WHEN dependency<>dep THEN null ELSE lease_until END,
   not_before=CASE WHEN dependency<>dep THEN clock_timestamp()ELSE not_before END,dependency=dep WHERE id=j.id;
  RETURN j.id;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN null;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_jobs)>=2000 THEN RETURN null;END IF;
 INSERT INTO private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency)VALUES(k,q,s,c,dep)
 ON CONFLICT(fingerprint)DO UPDATE SET last_requested_at=excluded.last_requested_at WHERE private.withdraw_prepared_jobs.request_key=excluded.request_key RETURNING id INTO j.id;
 RETURN j.id;
END;$$;
CREATE FUNCTION private.withdraw_prepared_read(q jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;dep text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;budget integer;v_status text;v_refresh text;v_at timestamptz:=clock_timestamp();
BEGIN
 -- The original native auth/session/IP/scope checks remain live on every read.
 PERFORM private.withdraw_prepared_validate(private.withdraw_window_legacy(q));s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RETURN jsonb_build_object('prepared',jsonb_build_object('status','failed','reason','source_contract_changed','contract','withdraw-independent-windows-v2'),'rows',null,'totals',null,'total',null);END IF;
 r:=private.withdraw_prepared_canonical(q);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);dep:=private.withdraw_prepared_dependency();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 -- Expiry is a refresh deadline, not a loss of a complete, same-semantics
 -- publication. Permissions/catalog and notes still resolve live above/below.
 IF a.id IS NOT NULL AND a.job_id=j.id AND a.revision=j.revision AND a.dependency=dep AND j.dependency=dep
 AND a.payload->>'contract'='withdraw-independent-windows-v2' AND a.payload->'request'=r AND a.payload->'scope'=s AND a.payload->'catalog'=c
 AND jsonb_typeof(a.payload->'secondary')='object' AND jsonb_typeof(a.payload->'game66')='object'
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['wg','yash','newar','ar','duoli','arHistory'])part WHERE jsonb_typeof(a.payload->part)IS DISTINCT FROM'array')THEN
  -- Refresh only the same ready job. Never reset a running lease or the retry
  -- limit of a failed refresh, and never extend the artifact's expiry/time.
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=v_at
   WHERE id=j.id AND revision=a.revision AND dependency=dep AND status='ready'AND a.expires_at<=v_at;
  SELECT status INTO v_refresh FROM private.withdraw_prepared_jobs WHERE id=j.id;
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=v_at WHERE id=j.id AND last_requested_at<v_at-interval'5minutes';
  RETURN private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2','publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,'calculationComplete',true,'freshness',CASE WHEN a.expires_at>v_at THEN'fresh'ELSE'refresh_due'END,'refreshState',CASE WHEN v_refresh IN('queued','running','failed')THEN v_refresh ELSE'idle'END));
 END IF;
 v_status:=CASE WHEN a.id IS NOT NULL THEN'stale'WHEN j.status='failed'AND j.attempts>=3 THEN'failed'WHEN j.status IN('queued','running')THEN'building'ELSE'missing'END;
 IF j.id IS NULL THEN
  INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
  IF budget IS NOT NULL THEN PERFORM private.withdraw_prepared_enqueue(r,s,c,dep);END IF;
 ELSE
  PERFORM private.withdraw_prepared_enqueue(r,s,c,dep);
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()WHERE id=j.id AND status='ready'AND(a.id IS NULL OR a.expires_at<=clock_timestamp());
 END IF;
 RETURN jsonb_build_object('prepared',jsonb_build_object('status',v_status,'contract','withdraw-independent-windows-v2','computedAt',a.computed_at,'expiresAt',a.expires_at),'rows',null,'totals',null,'total',null);
END;$$;
CREATE FUNCTION private.withdraw_prepared_claim()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;started timestamptz;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.provider_snapshot_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.prepared_aggregate_jobs WHERE status='running'AND lease_until>clock_timestamp())OR EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error='lease_expired',not_before=clock_timestamp()+interval'1minute'WHERE status='running'AND lease_until<=clock_timestamp();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp()ORDER BY not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN null;END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='source_contract_changed'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,last_error='obsolete_catalog'WHERE id=j.id;RETURN null;END IF;
 IF NOT private.prepared_aggregate_take_turn('prepared')THEN RETURN null;END IF;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 UPDATE private.withdraw_prepared_jobs SET status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started WHERE id=j.id RETURNING *INTO j;
 RETURN jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
END;$$;
CREATE FUNCTION private.withdraw_prepared_complete(claim jsonb,payload jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;dep text;aid uuid;at timestamptz:=clock_timestamp();expires timestamptz;bytes integer;k text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN RETURN jsonb_build_object('published',false,'reason','busy');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid FOR UPDATE;
 IF NOT FOUND OR j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=at THEN RETURN jsonb_build_object('published',false,'reason','obsolete_claim');END IF;
 dep:=private.withdraw_prepared_dependency();
 IF NOT private.withdraw_prepared_source_contract_current()THEN UPDATE private.withdraw_prepared_jobs SET status='failed',attempts=3,lease_until=null,last_error='source_contract_changed'WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','source_contract_changed');END IF;
 IF dep<>j.dependency OR NOT private.withdraw_prepared_catalog_current(j.catalog)THEN UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=0,lease_until=null,revision=revision+1,dependency=dep,not_before=at WHERE id=j.id;RETURN jsonb_build_object('published',false,'reason','dependency_changed');END IF;
 bytes:=octet_length(payload::text);
 IF payload->>'contract'IS DISTINCT FROM'withdraw-independent-windows-v2'OR payload->'request'IS DISTINCT FROM j.request OR payload->'catalog'IS DISTINCT FROM j.catalog OR payload->'scope'IS DISTINCT FROM j.scope OR bytes>4194304 OR jsonb_typeof(payload->'game66')IS DISTINCT FROM'object' OR jsonb_typeof(payload->'secondary')IS DISTINCT FROM'object'
 OR nullif(payload->>'computedAt','')IS NULL OR(payload->>'computedAt')::timestamptz>at OR(payload->>'computedAt')::timestamptz<at-interval'2minutes' THEN RAISE EXCEPTION 'withdraw_prepared_payload_mismatch';END IF;
 FOREACH k IN ARRAY ARRAY['wg','yash','newar','ar','duoli','arHistory']LOOP IF jsonb_typeof(payload->k)IS DISTINCT FROM'array'THEN RAISE EXCEPTION 'withdraw_prepared_payload_incomplete';END IF;END LOOP;
 IF(SELECT coalesce(sum(a.bytes),0)FROM private.withdraw_prepared_artifacts a)+bytes>134217728 THEN RAISE EXCEPTION 'withdraw_prepared_capacity';END IF;
 expires:=private.withdraw_prepared_expiry(at,greatest(left(j.request->>'endAt',10)::date,left(j.request->>'successEndAt',10)::date),j.catalog);
 INSERT INTO private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)VALUES(j.id,j.revision,j.fence,j.run_id,dep,payload,at,expires,bytes)RETURNING id INTO aid;
 INSERT INTO private.withdraw_prepared_heads VALUES(j.id,aid)ON CONFLICT(job_id)DO UPDATE SET artifact_id=excluded.artifact_id;
 UPDATE private.withdraw_prepared_jobs SET status='ready',attempts=0,lease_until=null,next_due_at=expires-interval'2minutes',last_error=null WHERE id=j.id;
 RETURN jsonb_build_object('published',true,'id',aid);
END;$$;
CREATE FUNCTION private.withdraw_prepared_run_claimed()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE claim jsonb:=nullif(current_setting('withdraw_prepared.claim',true),'')::jsonb;j private.withdraw_prepared_jobs%rowtype;started timestamptz;result jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'60seconds'THEN RAISE EXCEPTION 'withdraw_prepared_deadline_required';END IF;
 IF claim IS NULL THEN RETURN jsonb_build_object('status','idle');END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=(claim->>'jobId')::uuid;
 SELECT backend_start INTO started FROM pg_stat_activity WHERE pid=pg_backend_pid();
 IF j.claim_pid IS DISTINCT FROM pg_backend_pid()OR j.claim_backend_start IS DISTINCT FROM started OR j.status<>'running'OR j.run_id IS DISTINCT FROM(claim->>'runId')::uuid OR j.fence<>(claim->>'fence')::bigint OR j.lease_until<=clock_timestamp()THEN RETURN jsonb_build_object('status','obsolete');END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))THEN
  UPDATE private.withdraw_prepared_jobs SET status='queued',attempts=greatest(attempts-1,0),lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  PERFORM set_config('withdraw_prepared.claim','',false);RETURN jsonb_build_object('status','busy');END IF;
 BEGIN
  result:=private.withdraw_prepared_compute(j.request,j.scope,j.catalog);result:=private.withdraw_prepared_complete(claim,result);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  UPDATE private.withdraw_prepared_jobs SET status='failed',lease_until=null,last_error=CASE WHEN SQLSTATE='57014'THEN'compute_timeout'ELSE'compute_failed'END,not_before=clock_timestamp()+interval'1minute'WHERE id=j.id AND run_id=j.run_id AND fence=j.fence;
  result:=jsonb_build_object('published',false,'reason','compute_failed');
 END;
 PERFORM set_config('withdraw_prepared.claim','',false);RETURN result;
END;$$;
-- Use the existing payment-prepared cron connection, not a new parallel worker.
CREATE FUNCTION private.withdraw_prepared_prepare_claim(p_worker text)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE family text;c jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_claim_deadline_required';END IF;
 PERFORM set_config('withdraw_prepared.claim','',false);PERFORM set_config('withdraw_prepared.family','',false);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))THEN RETURN null;END IF;
 IF EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status='running'AND lease_until>clock_timestamp())THEN RETURN null;END IF;
 SELECT next_family INTO family FROM private.withdraw_prepared_scheduler WHERE singleton AND enabled FOR UPDATE;
 IF NOT FOUND THEN family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);IF c IS NOT NULL THEN PERFORM set_config('withdraw_prepared.family','payment',false);END IF;RETURN c;END IF;
 IF family='withdraw'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())THEN
  c:=private.withdraw_prepared_claim();
 ELSE family:='payment';c:=private.prepared_aggregate_prepare_claim(p_worker);END IF;
 IF c IS NULL AND family='payment'THEN family:='withdraw';c:=private.withdraw_prepared_claim();END IF;
 IF c IS NOT NULL THEN
  PERFORM set_config('withdraw_prepared.family',family,false);IF family='withdraw'THEN PERFORM set_config('withdraw_prepared.claim',c::text,false);END IF;
  UPDATE private.withdraw_prepared_scheduler SET next_family=CASE family WHEN'withdraw'THEN'payment'ELSE'withdraw'END WHERE singleton;
 END IF;RETURN c;
END;$$;
CREATE FUNCTION private.withdraw_prepared_run_dispatch(p_worker text)RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('withdraw_prepared.family',true)='withdraw'THEN RETURN private.withdraw_prepared_run_claimed();END IF;
 IF current_setting('withdraw_prepared.family',true)='payment'THEN RETURN private.prepared_aggregate_run_claimed(p_worker);END IF;
 RETURN jsonb_build_object('status','idle');
END;$$;
CREATE FUNCTION private.withdraw_prepared_maintenance()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE n integer;old_heads integer;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0))THEN RETURN jsonb_build_object('status','busy');END IF;
 UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()WHERE id IN(SELECT id FROM private.withdraw_prepared_jobs WHERE status='ready'AND next_due_at<=clock_timestamp()AND last_requested_at>clock_timestamp()-interval'1day'ORDER BY next_due_at LIMIT 100);
 GET DIAGNOSTICS n=ROW_COUNT;
 -- Delete only unused cache publications, never business/source data. Old
 -- scopes have no refresh lease and must be admitted again under fresh auth.
 DELETE FROM private.withdraw_prepared_heads WHERE job_id IN(SELECT id FROM private.withdraw_prepared_jobs WHERE status<>'running'AND last_requested_at<clock_timestamp()-interval'7days'ORDER BY last_requested_at LIMIT 100);
 GET DIAGNOSTICS old_heads=ROW_COUNT;
 DELETE FROM private.withdraw_prepared_artifacts WHERE id IN(SELECT a.id FROM private.withdraw_prepared_artifacts a WHERE NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h WHERE h.artifact_id=a.id)ORDER BY a.computed_at LIMIT 100);
 DELETE FROM private.withdraw_prepared_jobs WHERE id IN(SELECT j.id FROM private.withdraw_prepared_jobs j WHERE j.status<>'running'AND j.last_requested_at<clock_timestamp()-interval'7days'AND NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_heads h WHERE h.job_id=j.id)AND NOT EXISTS(SELECT 1 FROM private.withdraw_prepared_artifacts a WHERE a.job_id=j.id)ORDER BY j.last_requested_at LIMIT 100);
 DELETE FROM private.withdraw_prepared_admissions WHERE day<current_date-2;
 RETURN jsonb_build_object('queued',n,'retiredUnusedHeads',old_heads);
END;$$;
DO $acl$DECLARE p record;BEGIN
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname LIKE 'withdraw_prepared_%'LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||p.oid::regprocedure||' FROM public,anon,authenticated,service_role';
 END LOOP;
END;$acl$;
-- Cut over only after default scopes are warmed and independently verified.
-- Keep original RPC signature and real authorization context; caller roles do
-- not gain a new endpoint or permission. Original raw helpers remain private
-- worker dependencies; no click can invoke them through this reader.
CREATE FUNCTION private.withdraw_prepared_cutover(p_expected_templates text[])RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=''AS $cutover$
DECLARE p record;w record;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('withdraw_prepared_release_v1'));
 SELECT *INTO w FROM pg_proc WHERE oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF md5(w.prosrc)<>'c9de037699f382f66ea8de2c5ea6e25e'OR pg_get_userbyid(w.proowner)<>'postgres'OR w.prosecdef OR w.provolatile NOT IN('s','v')OR w.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR w.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'OR w.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')OR w.proparallel<>'u'OR w.proisstrict OR w.proleakproof OR w.procost<>100 OR w.prorows<>0 OR w.prokind<>'f'OR pg_get_function_arguments(w.oid)<>'p_request jsonb DEFAULT ''{}''::jsonb'OR pg_get_function_result(w.oid)<>'jsonb'THEN RAISE EXCEPTION 'withdraw_prepared_public_wrapper_drift';END IF;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RAISE EXCEPTION 'withdraw_prepared_source_contract_changed';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 IF(md5(p.prosrc)<>'12fe721956fb291f2c2b93a5d5187fbd'AND md5(p.prosrc)IS DISTINCT FROM(SELECT capture_hash FROM private.withdraw_prepared_release WHERE singleton AND cutover_at IS NULL))OR pg_get_userbyid(p.proowner)<>'postgres'OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres,authenticated=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_cutover_drift';END IF;
 IF p_expected_templates IS NULL OR cardinality(p_expected_templates)<2 OR(SELECT array_agg(fingerprint ORDER BY fingerprint)FROM private.withdraw_prepared_templates WHERE enabled)IS DISTINCT FROM(SELECT array_agg(DISTINCT x ORDER BY x)FROM unnest(p_expected_templates)x)THEN RAISE EXCEPTION 'withdraw_prepared_release_manifest_mismatch';END IF;
 IF (SELECT count(DISTINCT request->>'view')FROM private.withdraw_prepared_templates WHERE enabled)<2 THEN RAISE EXCEPTION 'withdraw_prepared_defaults_not_registered';END IF;
 IF EXISTS(WITH expected AS(
   SELECT jsonb_build_array('withdraw-independent-windows-v2',t.scope,t.catalog,private.withdraw_window_default_day(t.request,(clock_timestamp()AT TIME ZONE t.timezone)::date-n))k,t.catalog
   FROM private.withdraw_prepared_templates t CROSS JOIN generate_series(0,1)n WHERE t.enabled)
  SELECT 1 FROM expected e LEFT JOIN private.withdraw_prepared_jobs j ON j.fingerprint=md5(e.k::text)AND j.request_key=e.k
   LEFT JOIN private.withdraw_prepared_heads h ON h.job_id=j.id LEFT JOIN private.withdraw_prepared_artifacts a ON a.id=h.artifact_id
   WHERE j.id IS NULL OR j.status<>'ready'OR a.id IS NULL OR a.revision<>j.revision OR a.dependency<>private.withdraw_prepared_dependency()OR a.expires_at<=clock_timestamp()OR NOT private.withdraw_prepared_catalog_current(e.catalog))THEN RAISE EXCEPTION 'withdraw_prepared_not_warmed';END IF;
 EXECUTE $ddl$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''AS $body$BEGIN RETURN private.withdraw_prepared_read(p_request);END;$body$$ddl$;
 IF w.provolatile<>'v'THEN ALTER FUNCTION public.dashboard_admin_live_auto_withdraw(jsonb)VOLATILE;PERFORM pg_notify('pgrst','reload schema');END IF;
 UPDATE private.withdraw_prepared_release SET cutover_at=clock_timestamp(),capture_ends_at=null WHERE singleton;
 DROP FUNCTION private.withdraw_prepared_begin_capture();
 DROP FUNCTION private.withdraw_prepared_abort_capture();
 DROP FUNCTION private.withdraw_prepared_capture(jsonb);
END;$cutover$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_cutover(text[])FROM public,anon,authenticated,service_role;
