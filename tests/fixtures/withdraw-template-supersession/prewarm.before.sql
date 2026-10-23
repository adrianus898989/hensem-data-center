CREATE OR REPLACE FUNCTION private.withdraw_prepared_prewarm()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t record;d date;offset_day integer;n integer:=0;r jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 dep:=private.withdraw_prepared_dependency();
 FOR t IN SELECT DISTINCT ON(request,scope,catalog,timezone)request,scope,catalog,timezone FROM(
   SELECT request,scope,private.dashboard_withdraw_country_catalog(request,catalog)catalog,timezone
   FROM private.withdraw_prepared_templates WHERE enabled)x
   ORDER BY request,scope,catalog,timezone LIMIT 100 LOOP
  IF NOT private.withdraw_prepared_catalog_current(t.catalog)THEN CONTINUE;END IF;
  FOR offset_day IN 0..1 LOOP
   d:=(clock_timestamp()AT TIME ZONE t.timezone)::date-offset_day;
   r:=private.withdraw_window_default_day(t.request,d);
   IF private.withdraw_prepared_enqueue(r,t.scope,t.catalog,dep)IS NOT NULL THEN n:=n+1;END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('expected',n);
END;$function$
