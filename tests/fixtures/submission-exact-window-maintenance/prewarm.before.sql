CREATE OR REPLACE FUNCTION private.submission_cohort_prewarm(t jsonb, p_from date, p_through date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE dep text;v jsonb;children jsonb:='[]'::jsonb;day date;dv jsonb;id uuid;q jsonb;w uuid;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='submission_prewarm_denied';END IF;
 IF p_from IS NULL OR p_through IS NULL OR p_through-p_from NOT BETWEEN 0 AND 30
 OR(t->>'team',t->>'scope_group',t->>'currency')IS DISTINCT FROM('M8','IN','INR')
 OR t->>'source'NOT IN('ar','newar','kb')OR(p_through+1)::timestamp AT TIME ZONE(t->>'timezone')>statement_timestamp()
 OR NOT EXISTS(SELECT 1 FROM private.prepared_aggregate_schedule s CROSS JOIN LATERAL jsonb_array_elements(s.approved_targets)a WHERE a=t)
 OR private.withdraw_prepared_catalog_current(jsonb_build_array(t))IS NOT TRUE THEN RETURN NULL;END IF;
 IF NOT(SELECT enabled FROM private.submission_cohort_control WHERE singleton)THEN RETURN NULL;END IF;
 dep:=private.submission_cohort_semantic(t);IF dep IS NULL THEN RETURN NULL;END IF;
 FOR day IN SELECT generate_series(p_from,p_through,interval'1day')::date LOOP
  dv:=private.submission_cohort_version(t,day);IF dv IS NULL THEN RETURN NULL;END IF;
  id:=private.submission_cohort_admit(private.submission_cohort_day_request(t,day),t,dep,dv,NULL,false);IF id IS NULL THEN RETURN NULL;END IF;
  children:=children||jsonb_build_array(jsonb_build_object('date',day,'version',dv,'jobId',id));
 END LOOP;
 SELECT jsonb_agg(c-ARRAY['jobId']ORDER BY c->>'date')INTO v FROM jsonb_array_elements(children)c;
 q:=private.submission_cohort_day_request(t,p_from)||jsonb_build_object('endAt',(p_through+1)::timestamp AT TIME ZONE(t->>'timezone'));
 w:=private.submission_cohort_admit(q,t,dep,v,children,false);IF w IS NOT NULL THEN PERFORM private.submission_cohort_wake(w);END IF;RETURN w;
END;$function$

