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
 -- An exact enabled false default replaces only scheduled secondary work.
 -- Keep old templates/jobs/heads and every interactive true/legacy request.
 -- Filter before the existing 100-template limit and admission budget.
 FOR t IN WITH configured AS MATERIALIZED(
   SELECT request,scope,catalog original_catalog,
    private.dashboard_withdraw_country_catalog(request,catalog)catalog,timezone,fingerprint
   FROM private.withdraw_prepared_templates WHERE enabled),
 replacements AS MATERIALIZED(
   SELECT DISTINCT n.request-'includeSecondary'request,n.scope,n.catalog,n.timezone
   FROM configured n
   WHERE n.request->'includeSecondary'='false'::jsonb
    AND n.request->'windowVersion'='2'::jsonb AND n.request->>'view'IN('auto','operators')
    AND n.request->>'successBasis'IN('success','source_updated')
    AND nullif(n.request->>'account','')IS NULL
    AND NOT n.request ?| ARRAY['startAt','endAt','successStartAt','successEndAt']
    AND jsonb_typeof(n.scope)='object' AND jsonb_typeof(n.catalog)='array'
    AND n.fingerprint=md5(jsonb_build_array(n.request,n.scope,n.original_catalog)::text)
    AND EXISTS(SELECT 1 FROM pg_timezone_names z WHERE z.name=n.timezone)
    AND private.withdraw_prepared_catalog_current(n.catalog)
    AND private.withdraw_prepared_source_contract_current()
    AND(EXISTS(SELECT 1 FROM private.withdraw_window_targets(n.request,n.scope,n.catalog))
     OR private.dashboard_withdraw_npg_template_zone(n.request,n.scope,n.catalog)=n.timezone)
    -- An original exact admitted job proves this is a real default family;
    -- stale, forged or differently authorized templates cannot suppress work.
    AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs j
     WHERE j.request->'includeSecondary'='false'::jsonb
      AND j.request-ARRAY['startAt','endAt','successStartAt','successEndAt']=n.request
      AND j.scope=n.scope AND j.catalog=n.catalog AND j.dependency=dep
      AND j.request_key=jsonb_build_array('withdraw-independent-windows-v2',j.scope,j.catalog,j.request)
      AND j.fingerprint=md5(j.request_key::text)
      AND j.request=private.withdraw_prepared_canonical(j.request)
      AND private.withdraw_window_whole_days(j.request)
      AND left(j.request->>'startAt',10)=left(j.request->>'endAt',10)
      AND j.request->>'startAt'=j.request->>'successStartAt'
      AND j.request->>'endAt'=j.request->>'successEndAt'))
 SELECT DISTINCT ON(request,scope,catalog,timezone)request,scope,catalog,timezone
 FROM configured x
 WHERE x.request?'includeSecondary'OR NOT EXISTS(SELECT 1 FROM replacements n
   WHERE n.request=x.request AND n.scope=x.scope AND n.catalog=x.catalog AND n.timezone=x.timezone)
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
