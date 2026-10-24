CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_index_valid(payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE idx jsonb:=payload->'_newarLabelIndex';bad boolean;
BEGIN
 IF idx->>'format'IS DISTINCT FROM'newar-label-index-v1'OR jsonb_typeof(idx->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(payload->'rows')IS DISTINCT FROM'array'THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(idx->'rows')r(x)WHERE jsonb_typeof(x)<>'array'OR jsonb_array_length(x)<>9
  OR jsonb_typeof(x->0)<>'string'OR jsonb_typeof(x->1)NOT IN('string','null')OR coalesce(x->>2,'') NOT IN('present','unknown')
  OR coalesce(x->>3,'')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->4)<>'object'
  OR coalesce(x->>5,'')!~'^[0-9]+$'OR coalesce(x->>6,'')!~'^[0-9]+$'OR coalesce(x->>7,'')!~'^[0-9]+$'OR coalesce(x->>8,'')!~'^[0-9]+$')THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows')r(x)WHERE jsonb_typeof(x)IS DISTINCT FROM'object'
  OR coalesce(x->>'reasonKey','')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->'reason')IS DISTINCT FROM'string'
  OR coalesce(x->>'noteState','')NOT IN('present','unknown')
  OR coalesce(x->>'count','')!~'^[0-9]+$'OR coalesce(x->>'success','')!~'^[0-9]+$'
  OR coalesce(x->>'rejected','')!~'^[0-9]+$'OR coalesce(x->>'other','')!~'^[0-9]+$')THEN RETURN false;END IF;
 WITH i AS MATERIALIZED(SELECT x FROM jsonb_array_elements(idx->'rows')r(x)),
 grouped AS(SELECT x->>3 key,sum((x->>5)::bigint)n,sum((x->>6)::bigint)s,sum((x->>7)::bigint)r,sum((x->>8)::bigint)o FROM i GROUP BY x->>3),
 g AS(SELECT x FROM jsonb_array_elements(payload->'rows')r(x))
 SELECT coalesce((SELECT sum((x->>5)::bigint)FROM i),0)<>coalesce((payload->>'noteCount')::bigint,0)
 OR(SELECT count(*)FROM i)<>(SELECT count(DISTINCT x->>0)FROM i)
 OR(SELECT count(*)FROM g)<>(SELECT count(DISTINCT x->>'reasonKey')FROM g)
 OR EXISTS(SELECT 1 FROM i WHERE(x->>5)::bigint<>(x->>6)::bigint+(x->>7)::bigint+(x->>8)::bigint)
 OR EXISTS(SELECT 1 FROM grouped a FULL JOIN g ON g.x->>'reasonKey'=a.key
   WHERE a.key IS NULL OR g.x IS NULL OR a.n<>(g.x->>'count')::bigint OR a.s<>(g.x->>'success')::bigint
    OR a.r<>(g.x->>'rejected')::bigint OR a.o<>(g.x->>'other')::bigint) INTO bad;
 RETURN NOT bad;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$function$

