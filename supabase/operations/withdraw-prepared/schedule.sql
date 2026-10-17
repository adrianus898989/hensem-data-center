-- Scheduling shares the existing generic worker connection. Templates are
-- registered only from an already-authorized exact job, never from client JSON.
CREATE TABLE private.withdraw_prepared_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request jsonb NOT NULL,scope jsonb NOT NULL,catalog jsonb NOT NULL,
 timezone text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 fingerprint text NOT NULL UNIQUE
);
ALTER TABLE private.withdraw_prepared_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.withdraw_prepared_templates FROM public,anon,authenticated,service_role;
CREATE FUNCTION private.withdraw_prepared_register_template(p_job uuid,p_timezone text)RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE j private.withdraw_prepared_jobs%rowtype;r jsonb;tid uuid;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)THEN RAISE EXCEPTION 'withdraw_prepared_timezone_invalid';END IF;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=p_job;
 IF NOT FOUND OR left(j.request->>'startAt',10)<>left(j.request->>'endAt',10)OR NOT private.withdraw_window_whole_days(j.request)OR j.request->>'startAt'IS DISTINCT FROM j.request->>'successStartAt'OR j.request->>'endAt'IS DISTINCT FROM j.request->>'successEndAt'OR NOT private.withdraw_prepared_catalog_current(j.catalog)THEN RAISE EXCEPTION 'withdraw_prepared_template_invalid';END IF;
 -- Account searches are not recurring defaults. Country/platform/native scope
 -- and view are kept exactly; no wider scope is silently substituted.
 IF nullif(j.request->>'account','')IS NOT NULL THEN RAISE EXCEPTION 'withdraw_prepared_template_account';END IF;
 r:=j.request-ARRAY['startAt','endAt','successStartAt','successEndAt'];
 PERFORM pg_advisory_xact_lock(hashtextextended('withdraw_prepared_admission_v1',0));
 SELECT id INTO tid FROM private.withdraw_prepared_templates WHERE fingerprint=md5(jsonb_build_array(r,j.scope,j.catalog)::text)AND request=r AND scope=j.scope AND catalog=j.catalog;
 IF FOUND THEN RETURN tid;END IF;
 IF(SELECT count(*)FROM private.withdraw_prepared_templates)>=100 THEN RAISE EXCEPTION 'withdraw_prepared_template_capacity';END IF;
 INSERT INTO private.withdraw_prepared_templates(request,scope,catalog,timezone,fingerprint)VALUES(r,j.scope,j.catalog,p_timezone,md5(jsonb_build_array(r,j.scope,j.catalog)::text))RETURNING id INTO tid;RETURN tid;
END;$$;
CREATE FUNCTION private.withdraw_prepared_prewarm()RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE t private.withdraw_prepared_templates%rowtype;d date;offset_day integer;n integer:=0;r jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 dep:=private.withdraw_prepared_dependency();
 FOR t IN SELECT *FROM private.withdraw_prepared_templates WHERE enabled ORDER BY id LIMIT 100 LOOP
  IF NOT private.withdraw_prepared_catalog_current(t.catalog)THEN CONTINUE;END IF;
  FOR offset_day IN 0..1 LOOP
   d:=(clock_timestamp()AT TIME ZONE t.timezone)::date-offset_day;
   r:=private.withdraw_window_default_day(t.request,d);
   IF private.withdraw_prepared_enqueue(r,t.scope,t.catalog,dep)IS NOT NULL THEN n:=n+1;END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('expected',n);
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_register_template(uuid,text),private.withdraw_prepared_prewarm() FROM public,anon,authenticated,service_role;
