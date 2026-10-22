CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select private.prepared_aggregate_dependency(p_target,private.prepared_aggregate_dependency_common(case when p_target->>'source'='game66'then'IN'else p_target->>'scope_group'end));$function$

