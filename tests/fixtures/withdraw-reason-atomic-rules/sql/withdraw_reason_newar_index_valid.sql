CREATE OR REPLACE FUNCTION private.withdraw_reason_newar_index_valid(payload jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE idx jsonb:=payload->'_newarLabelIndex';bad boolean;v_row jsonb;v_member jsonb;
BEGIN
 IF payload->>'reasonGrouping'IS DISTINCT FROM'atomic_rules_v1'
 OR idx->>'format'IS DISTINCT FROM'newar-label-index-v2'OR jsonb_typeof(idx->'rows')IS DISTINCT FROM'array'
 OR jsonb_typeof(payload->'rows')IS DISTINCT FROM'array'
 OR idx->>'integrity'IS DISTINCT FROM md5(jsonb_build_array('newar-label-index-v2',idx->'rows')::text)
 THEN RETURN false;END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(idx->'rows')LOOP
  IF jsonb_typeof(v_row)IS DISTINCT FROM'array'OR jsonb_array_length(v_row)<>9
  OR jsonb_typeof(v_row->0)IS DISTINCT FROM'string'OR jsonb_typeof(v_row->1)NOT IN('string','null')
  OR coalesce(v_row->>2,'')NOT IN('present','unknown')OR jsonb_typeof(v_row->3)IS DISTINCT FROM'array'
  OR jsonb_array_length(v_row->3)=0 OR jsonb_typeof(v_row->4)IS DISTINCT FROM'object'
  OR(v_row->4)-ARRAY['actualValue','actualField','threshold']<>'{}'::jsonb
  OR coalesce(v_row->>5,'')!~'^[0-9]+$'OR coalesce(v_row->>6,'')!~'^[0-9]+$'
  OR coalesce(v_row->>7,'')!~'^[0-9]+$'OR coalesce(v_row->>8,'')!~'^[0-9]+$'
  OR jsonb_typeof(v_row->5)<>'number'OR jsonb_typeof(v_row->6)<>'number'OR jsonb_typeof(v_row->7)<>'number'OR jsonb_typeof(v_row->8)<>'number'
  OR(v_row->>2='present')IS DISTINCT FROM coalesce((case when v_row->>2='present'then coalesce(v_row->>1,v_row->>0)else v_row->>1 end) ~ '[^[:space:]]',false)
  THEN RETURN false;END IF;
  FOR v_member IN SELECT value FROM jsonb_array_elements(v_row->3)LOOP
   IF jsonb_typeof(v_member)IS DISTINCT FROM'object'OR jsonb_typeof(v_member->'reason')IS DISTINCT FROM'string'
   OR nullif(v_member->>'reason','')IS NULL OR jsonb_typeof(v_member->'details')IS DISTINCT FROM'object'
   OR v_member->>'reasonKey'IS DISTINCT FROM md5(jsonb_build_array('atomic_rules_v1','newar',v_row->>2,v_member->>'reason')::text)
   OR (v_member->'details')-ARRAY['actualValue','actualField','threshold']<>'{}'::jsonb
   OR NOT(v_member->'details'?&ARRAY['actualValue','actualField','threshold'])
   OR EXISTS(SELECT 1 FROM jsonb_each(v_member->'details')d WHERE jsonb_typeof(d.value)NOT IN('string','null'))
   THEN RETURN false;END IF;
  END LOOP;
  IF(SELECT count(*)FROM jsonb_array_elements(v_row->3))<>(SELECT count(DISTINCT value->>'reasonKey')FROM jsonb_array_elements(v_row->3))THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows')r(x)WHERE jsonb_typeof(x)IS DISTINCT FROM'object'
  OR coalesce(x->>'reasonKey','')!~'^[a-f0-9]{32}$'OR jsonb_typeof(x->'reason')IS DISTINCT FROM'string'
  OR coalesce(x->>'noteState','')NOT IN('present','unknown')
  OR coalesce(x->>'count','')!~'^[0-9]+$'OR coalesce(x->>'success','')!~'^[0-9]+$'
  OR coalesce(x->>'rejected','')!~'^[0-9]+$'OR coalesce(x->>'other','')!~'^[0-9]+$')THEN RETURN false;END IF;
 WITH i AS MATERIALIZED(SELECT value x FROM jsonb_array_elements(idx->'rows')),
 grouped AS(SELECT m->>'reasonKey'key,m->>'reason'reason,x->>2 state,
  sum((x->>5)::bigint)n,sum((x->>6)::bigint)s,sum((x->>7)::bigint)r,sum((x->>8)::bigint)o
  FROM i CROSS JOIN LATERAL jsonb_array_elements(x->3)e(m)GROUP BY 1,2,3),
 g AS(SELECT value x FROM jsonb_array_elements(payload->'rows'))
 SELECT coalesce((SELECT sum((x->>5)::bigint)FROM i),0)<>coalesce((payload->>'noteCount')::bigint,0)
 OR(SELECT count(*)FROM i)<>(SELECT count(DISTINCT x->>0)FROM i)
 OR(SELECT count(*)FROM g)<>(SELECT count(DISTINCT x->>'reasonKey')FROM g)
 OR EXISTS(SELECT 1 FROM i WHERE(x->>5)::bigint<>(x->>6)::bigint+(x->>7)::bigint+(x->>8)::bigint)
 OR EXISTS(SELECT 1 FROM grouped a FULL JOIN g ON g.x->>'reasonKey'=a.key
   WHERE a.key IS NULL OR g.x IS NULL OR a.reason IS DISTINCT FROM g.x->>'reason'OR a.state IS DISTINCT FROM g.x->>'noteState'
    OR a.n<>(g.x->>'count')::bigint OR a.s<>(g.x->>'success')::bigint
    OR a.r<>(g.x->>'rejected')::bigint OR a.o<>(g.x->>'other')::bigint)
 OR ((payload->'available'='true'::jsonb OR coalesce((SELECT sum(n)FROM grouped),0)>0) AND (
  payload->'summary'->'ruleMembership'->>'unit'IS DISTINCT FROM'distinct_order_per_rule'
  OR payload->'summary'->'ruleMembership'->'overlapping'IS DISTINCT FROM'true'::jsonb
  OR(payload->'summary'->'ruleMembership'->>'hitCount')::bigint IS DISTINCT FROM coalesce((SELECT sum(n)FROM grouped),0))) INTO bad;
 RETURN NOT bad;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$function$;
