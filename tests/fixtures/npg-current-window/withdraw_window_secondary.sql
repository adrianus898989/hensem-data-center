CREATE OR REPLACE FUNCTION private.withdraw_window_secondary(q jsonb, s jsonb, c jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE t record;cap jsonb;rows jsonb:='[]';ops jsonb;v jsonb;a timestamptz;b timestamptz;n bigint;v_amount numeric;account_filter text:=nullif(btrim(q->>'account'),'');
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 PERFORM private.withdraw_window_validate(q);
 IF q?'includeSecondary'AND jsonb_typeof(q->'includeSecondary')IS DISTINCT FROM'boolean'THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_secondary_mode';END IF;
 -- Omission is explicit and request-key-bound. No source/target scan and no invented zero.
 IF q->'includeSecondary'='false'::jsonb THEN
  RETURN jsonb_build_object('basis',q->>'successBasis','startAt',q->>'successStartAt','endAt',q->>'successEndAt',
   'createdIntersection',false,'complete',false,'state','not_requested','rows','[]'::jsonb);
 END IF;
 FOR t IN SELECT *FROM private.withdraw_window_targets(q,s,c)ORDER BY country,name,id LOOP
  cap:=private.withdraw_window_capability(t.source,q->>'successBasis');n:=null;v_amount:=null;ops:='[]';
  IF (cap->>'available')::boolean THEN
   a:=left(q->>'successStartAt',19)::timestamp AT TIME ZONE t.timezone;b:=(left(q->>'successEndAt',19)::timestamp+interval'1second')AT TIME ZONE t.timezone;
   WITH facts AS MATERIALIZED(SELECT f.account,CASE WHEN f.amount::text NOT IN('NaN','Infinity','-Infinity')THEN f.amount END amount,f.operator_available FROM private.withdraw_window_success_rows(to_jsonb(t),q->>'successBasis',a,b)f),groups AS(
    SELECT account,count(*)count,CASE WHEN count(amount)=count(*)THEN sum(amount)END amount FROM facts WHERE operator_available AND(account_filter IS NULL OR position(lower(account_filter)IN lower(account))>0)GROUP BY account)
   SELECT (SELECT count(*)FROM facts),(SELECT CASE WHEN count(amount)=count(*)THEN sum(amount)END FROM facts),coalesce(jsonb_agg(jsonb_build_object('account',account,'count',count,'amount',amount)ORDER BY account),'[]')INTO n,v_amount,ops FROM groups;
  END IF;
  v:=jsonb_build_object('platform',t.name,'country',t.country,'source',t.source,'timezone',t.timezone,'currency',t.currency,'capability',cap,'count',CASE WHEN n>0 THEN n END,'amount',v_amount,'observedCount',n,'complete',false,'coverageVerified',false,'state',CASE WHEN NOT(cap->>'available')::boolean THEN'timestamp_unavailable'WHEN n=0 THEN'no_matching_observed_records'ELSE'observed_records'END,'operatorAttributionAvailable',t.source<>'lg','operatorRows',ops);
  rows:=rows||jsonb_build_array(v);
 END LOOP;
 RETURN jsonb_build_object('basis',q->>'successBasis','startAt',q->>'successStartAt','endAt',q->>'successEndAt','createdIntersection',false,'complete',false,'rows',rows);
END;$function$;
