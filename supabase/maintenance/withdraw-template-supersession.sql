-- Existing worker schedule only. No template/job/head/data mutation.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
set local jit=off;
do $guard$
declare p pg_proc%rowtype;d text;s jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prewarm_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('withdraw_template_supersession_install_v1',0))then raise exception'withdraw_prewarm_install_busy';end if;
 select *into p from pg_proc where oid=to_regprocedure('private.withdraw_prepared_prewarm()');
 if p.oid is null or md5(p.prosrc)is distinct from'50afba85620c97d79f0740be5ce89dcc'
  or pg_get_userbyid(p.proowner)is distinct from'postgres' or p.proacl::text is distinct from'{postgres=X/postgres}'
  or p.proconfig is distinct from ARRAY['search_path=""'] or p.prosecdef or p.provolatile<>'v'
  or p.proisstrict or p.proleakproof or p.proparallel<>'u' or p.procost<>100 or p.prorows<>0
  or p.proretset or p.prorettype<>'jsonb'::regtype or p.pronargs<>0
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')
 then raise exception'withdraw_prewarm_contract_drift';end if;
 if not exists(select 1 from pg_proc f where f.oid=to_regprocedure('private.withdraw_prepared_canonical(jsonb)')
  and md5(f.prosrc)='10d7041b097c97ef64012904d33cb627'and pg_get_userbyid(f.proowner)='postgres'
  and f.proacl::text='{postgres=X/postgres}'and f.proconfig=ARRAY['search_path=""']and not f.prosecdef and f.provolatile='i'
  and not f.proisstrict and not f.proleakproof and f.proparallel='u'and f.procost=100 and f.prorows=0
  and not f.proretset and f.prorettype='jsonb'::regtype and pg_get_function_arguments(f.oid)='q jsonb'
  and f.prolang=(select oid from pg_language where lanname='plpgsql'))
 then raise exception'withdraw_optional_secondary_contract_required';end if;
 perform set_config('withdraw_template.metadata',(to_jsonb(p)-'prosrc')::text,true);
 d:=private.withdraw_prepared_dependency();
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))into s from unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])scope;
 if d is null or s is null or exists(select 1 from jsonb_each(s)x where x.value='null'::jsonb)
  or private.withdraw_prepared_source_contract_current()is distinct from true then raise exception'withdraw_prewarm_dependency_unavailable';end if;
 perform set_config('withdraw_template.dep',d,true);perform set_config('withdraw_template.scopes',s::text,true);
end;$guard$;
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
END;$function$;
do $verify$
declare p pg_proc%rowtype;s jsonb;
begin
 select *into p from pg_proc where oid='private.withdraw_prepared_prewarm()'::regprocedure;
 if md5(p.prosrc)is distinct from'3679bff80dcd8045c0e0c70dac215e5e'or(to_jsonb(p)-'prosrc')is distinct from current_setting('withdraw_template.metadata')::jsonb
 then raise exception'withdraw_prewarm_install_metadata_mismatch';end if;
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))into s from unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])scope;
 if private.withdraw_prepared_dependency()is distinct from current_setting('withdraw_template.dep')
  or s is distinct from current_setting('withdraw_template.scopes')::jsonb
  or private.withdraw_prepared_source_contract_current()is distinct from true then raise exception'withdraw_prewarm_dependency_changed';end if;
end;$verify$;
commit;
