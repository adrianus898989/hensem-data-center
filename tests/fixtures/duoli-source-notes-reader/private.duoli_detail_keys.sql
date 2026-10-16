CREATE OR REPLACE FUNCTION private.duoli_detail_keys(p_obj jsonb, p_allowed text[], p_exact boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_typeof(p_obj) = 'object'
    and not exists (select 1 from pg_catalog.jsonb_object_keys(p_obj) as k(key)
                    where not (k.key = any (p_allowed)))
    and (not p_exact or p_obj ?& p_allowed)
$function$

