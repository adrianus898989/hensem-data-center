CREATE OR REPLACE FUNCTION private.dashboard_serving_recent_refresh_at(q jsonb,t jsonb,p_computed timestamptz,p_now timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $function$
DECLARE a timestamptz;b timestamptz;la timestamp;lb timestamp;today date;seconds integer;
BEGIN
 -- Query-only policy. The scheduled 08:00/20:00 historical policy is unchanged.
 -- Caller has already authorized the exact native identity and validated q.
 IF q->>'successBasis' IS DISTINCT FROM 'created' OR q?|ARRAY['successStartAt','successEndAt']
  OR coalesce(q->>'view','full')NOT IN('providers','full') OR p_computed IS NULL OR p_now IS NULL
  OR NOT isfinite(p_computed)OR NOT isfinite(p_now)OR p_computed>p_now THEN RETURN NULL;END IF;
 a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;
 IF a IS NULL OR b IS NULL OR NOT isfinite(a)OR NOT isfinite(b)OR a>=b THEN RETURN NULL;END IF;
 la:=a AT TIME ZONE(t->>'timezone');lb:=b AT TIME ZONE(t->>'timezone');today:=(p_now AT TIME ZONE(t->>'timezone'))::date;
 IF la<>date_trunc('day',la)OR lb<>date_trunc('day',lb)OR lb::date<>la::date+1
  OR la::date NOT BETWEEN today-2 AND today THEN RETURN NULL;END IF;
 SELECT current_interval_seconds INTO seconds FROM private.prepared_aggregate_schedule WHERE singleton;
 IF seconds IS NULL OR seconds<=0 THEN RETURN NULL;END IF;
 RETURN p_computed+make_interval(secs=>seconds);
END;$function$;
REVOKE ALL ON FUNCTION private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
