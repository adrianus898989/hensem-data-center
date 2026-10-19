BEGIN;
SET LOCAL search_path='';
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='500ms';
-- Restores original consumer before dropping its owner-only transport helper.
-- No source/artifact/queue/permission data are reset or removed.
DO $rollback$
DECLARE reader pg_proc%rowtype;before_proc jsonb;after_proc jsonb;helper_oid oid;common_before text;withdraw_before text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='auto_team_installer_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid='private.withdraw_prepared_dependency()'::regprocedure AND to_jsonb(p)-'prosrc'='{"oid":"500502","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"withdraw_prepared_dependency","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"30796","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb AND md5(prosrc)='8a8093c8caa5f0fcb2ae86f19d0a91b4')THEN RAISE EXCEPTION 'auto_team_protected_definition_drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid='private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure AND to_jsonb(p)-'prosrc'='{"oid":"500519","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"withdraw_prepared_render","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_request","p_bundle"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"30796","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb AND md5(prosrc)='e00e877d3b41ff84de16603986a95e8b')THEN RAISE EXCEPTION 'auto_team_protected_definition_drift';END IF;
 SELECT *INTO reader FROM pg_proc WHERE oid='private.withdraw_prepared_read(jsonb)'::regprocedure;
 IF to_jsonb(reader)-'prosrc' IS DISTINCT FROM '{"oid":"504004","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"withdraw_prepared_read","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["q"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"30796","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb THEN RAISE EXCEPTION 'auto_team_reader_metadata_drift';END IF;
 IF md5(reader.prosrc)='c9a00efce9d85b3a4bfb694102970fd5' AND to_regprocedure('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)')IS NULL THEN RETURN;END IF;
 IF md5(reader.prosrc)<>'3ac2f696480420dbf4f848bd6a60041b' OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=to_regprocedure('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)')AND to_jsonb(p)-ARRAY['oid','prosrc']='{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"auto_team_previous_projection","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["q","b","v","authorized_request"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"30796","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb AND md5(prosrc)='13092e904fca6d7cef7ec75052e0abb7')THEN RAISE EXCEPTION 'auto_team_rollback_baseline_drift';END IF;
 helper_oid:=to_regprocedure('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)');
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p))INTO before_proc FROM pg_proc p;
 common_before:=private.prepared_aggregate_dependency_common('IN');withdraw_before:=private.withdraw_prepared_dependency();
 EXECUTE $reader$CREATE OR REPLACE FUNCTION private.withdraw_prepared_read(q jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;dep text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;budget integer;v_admitted uuid;v_status text;v_refresh text;v_at timestamptz:=clock_timestamp();
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
  PERFORM private.withdraw_prepared_admit_default_template(j.id,r,s,c);
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
  IF budget IS NOT NULL THEN v_admitted:=private.withdraw_prepared_enqueue(r,s,c,dep);PERFORM private.withdraw_prepared_admit_default_template(v_admitted,r,s,c);END IF;
 ELSE
  v_admitted:=private.withdraw_prepared_enqueue(r,s,c,dep);PERFORM private.withdraw_prepared_admit_default_template(v_admitted,r,s,c);
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()WHERE id=j.id AND status='ready'AND(a.id IS NULL OR a.expires_at<=clock_timestamp());
 END IF;
 RETURN jsonb_build_object('prepared',jsonb_build_object('status',v_status,'contract','withdraw-independent-windows-v2','computedAt',a.computed_at,'expiresAt',a.expires_at),'rows',null,'totals',null,'total',null);
END;$function$
$reader$;
 DROP FUNCTION private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb);
 IF to_regprocedure('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)')IS NOT NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=reader.oid AND to_jsonb(p)-'prosrc'='{"oid":"504004","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"withdraw_prepared_read","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["q"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"30796","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}'::jsonb AND md5(prosrc)='c9a00efce9d85b3a4bfb694102970fd5')THEN RAISE EXCEPTION 'auto_team_rollback_readback_failed';END IF;
 IF private.prepared_aggregate_dependency_common('IN')IS DISTINCT FROM common_before OR private.withdraw_prepared_dependency()IS DISTINCT FROM withdraw_before THEN RAISE EXCEPTION 'auto_team_financial_dependency_changed';END IF;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p))INTO after_proc FROM pg_proc p;
 IF(before_proc-ARRAY[reader.oid::text,helper_oid::text])IS DISTINCT FROM(after_proc-reader.oid::text)THEN RAISE EXCEPTION 'auto_team_unrelated_function_changed';END IF;
END;$rollback$;
COMMIT;
