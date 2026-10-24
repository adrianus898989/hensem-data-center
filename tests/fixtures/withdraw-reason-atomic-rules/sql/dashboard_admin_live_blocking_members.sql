CREATE OR REPLACE FUNCTION private.dashboard_admin_live_blocking_members(p_details jsonb,p_source text,p_state text)
 RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
 WITH parsed AS MATERIALIZED (
  SELECT p_details d
 ), atoms AS (
  SELECT jsonb_build_object('reason',a->'reason','actualValue',a->'actualValue','actualField',a->'actualField','threshold',a->'threshold')a FROM parsed CROSS JOIN LATERAL jsonb_array_elements(coalesce(d->'_members',jsonb_build_array(d))) e(a)
 ), grouped AS (
  SELECT a->>'reason' reason,CASE WHEN count(DISTINCT(a-'reason'))=1 THEN min((a-'reason')::text)::jsonb
   ELSE jsonb_build_object('actualValue',null,'actualField',null,'threshold',null) END details
  FROM atoms WHERE nullif(a->>'reason','')IS NOT NULL GROUP BY a->>'reason'
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,
  'reasonKey',md5(jsonb_build_array('atomic_rules_v1',p_source,p_state,reason)::text),'details',details)
  ORDER BY reason COLLATE pg_catalog."C"),'[]'::jsonb) FROM grouped;
$function$;
