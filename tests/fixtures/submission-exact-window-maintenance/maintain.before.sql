CREATE OR REPLACE FUNCTION private.submission_cohort_maintain()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE started timestamptz:=statement_timestamp();r record;t jsonb;d date;w uuid;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='submission_prewarm_denied';END IF;
 IF NOT(SELECT enabled FROM private.submission_cohort_control WHERE singleton)THEN RETURN;END IF;
 -- Warm only the already-requested exact window plus the two latest closed
 -- daily defaults. At most two active natives per existing maintenance tick.
 IF clock_timestamp()-started>interval'2seconds'THEN RETURN;END IF;
 FOR r IN SELECT *FROM(SELECT DISTINCT ON(scope->'target')id,request,scope,last_requested_at FROM private.withdraw_prepared_jobs
 WHERE request_key->>0='submission-exact-window-v1'AND(scope->>'humanRequestedAt')::timestamptz>started-interval'1day'
 ORDER BY scope->'target',coalesce((scope->>'backgroundRequestedAt')::timestamptz,'-infinity'::timestamptz),last_requested_at DESC)x
 ORDER BY coalesce((scope->>'backgroundRequestedAt')::timestamptz,'-infinity'::timestamptz),last_requested_at DESC LIMIT 2 LOOP
  EXIT WHEN clock_timestamp()-started>interval'2seconds';t:=r.scope->'target';
  PERFORM private.submission_cohort_prewarm(t,((r.request->>'startAt')::timestamptz AT TIME ZONE(t->>'timezone'))::date,(((r.request->>'endAt')::timestamptz-interval'1microsecond')AT TIME ZONE(t->>'timezone'))::date);
  d:=(started AT TIME ZONE(t->>'timezone'))::date-1;
  PERFORM private.submission_cohort_prewarm(t,d,d);EXIT WHEN clock_timestamp()-started>interval'2seconds';
  PERFORM private.submission_cohort_prewarm(t,d-1,d-1);
  UPDATE private.withdraw_prepared_jobs SET scope=scope||jsonb_build_object('backgroundRequestedAt',started)WHERE id=r.id;
 END LOOP;
END;$function$

