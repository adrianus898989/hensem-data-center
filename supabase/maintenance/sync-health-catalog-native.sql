CREATE OR REPLACE FUNCTION private.dashboard_admin_live_native_collected_data(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
begin
 return private.dashboard_collected_data_core(p_request,true);
end;$function$
