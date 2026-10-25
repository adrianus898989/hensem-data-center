CREATE OR REPLACE FUNCTION private.prepared_aggregate_key(q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_array('exact-prepared-v1',t,private.prepared_aggregate_canonical_request(q,t));
$function$

