CREATE OR REPLACE FUNCTION private.dashboard_admin_live_blocking_details_cleaned(p_note text)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
begin
 return private.dashboard_admin_live_blocking_core(p_note)-'_members';
end;
$function$;
