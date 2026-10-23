CREATE OR REPLACE FUNCTION private.withdraw_prepared_canonical(q jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE r jsonb:=q-ARRAY['offset','limit','sort','ascending','daily'];k text;
BEGIN
 IF q?'includeSecondary'AND jsonb_typeof(q->'includeSecondary')IS DISTINCT FROM'boolean'THEN RAISE EXCEPTION USING errcode='22023',message='withdraw_secondary_mode';END IF;
 IF q->'includeSecondary'='true'::jsonb THEN r:=r-'includeSecondary';END IF;
 IF q?'windowVersion'OR q?'successStartAt'OR q?'successEndAt'OR q?'successBasis'THEN PERFORM private.withdraw_window_validate(q);END IF;
 r:=r||jsonb_build_object('startAt',left(q->>'startAt',19)||'.000Z','endAt',left(q->>'endAt',19)||'.000Z','successStartAt',left(coalesce(q->>'successStartAt',q->>'startAt'),19)||'.000Z','successEndAt',left(coalesce(q->>'successEndAt',q->>'endAt'),19)||'.000Z','successBasis',coalesce(q->>'successBasis','success'),'windowVersion',2,'view',coalesce(q->>'view','auto'));
 PERFORM private.withdraw_window_validate(r);
 IF q?'platforms'THEN r:=jsonb_set(r,'{platforms}',coalesce((SELECT jsonb_agg(x ORDER BY x)FROM(SELECT DISTINCT value x FROM jsonb_array_elements(q->'platforms'))a),'[]'));END IF;
 IF q?'scopeTargets'THEN r:=jsonb_set(r,'{scopeTargets}',(SELECT jsonb_agg(jsonb_build_object('country',t->>'country','platforms',(SELECT jsonb_agg(v ORDER BY v)FROM(SELECT DISTINCT value v FROM jsonb_array_elements(t->'platforms'))a)) ORDER BY t->>'country')FROM jsonb_array_elements(q->'scopeTargets')t));END IF;
 RETURN r;
END;$function$
