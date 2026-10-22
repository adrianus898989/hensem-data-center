CREATE OR REPLACE FUNCTION private.prepared_aggregate_prewarm(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO '' AS $function$
begin
 -- Compatibility entry only; one reviewed planner owns all automatic defaults.
 return private.dashboard_serving_country_prewarm(p_now);
end;$function$
