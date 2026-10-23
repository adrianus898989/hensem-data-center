CREATE OR REPLACE FUNCTION private.dashboard_admin_live_collected_data(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare v_result jsonb;v_scope jsonb;
begin
 -- Fixed, lightweight team directory. Do not run the old global report scan.
 if p_request->>'operation'='catalog'and p_request->>'dataset'='team_sheet'then
  if jsonb_typeof(p_request)<>'object'or p_request-array['operation','dataset']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_team_sheet_catalog_request';end if;
  v_scope:=private.dashboard_admin_live_scope();
  return jsonb_build_object('rows',private.team_sheet_catalog(v_scope));
 end if;
 -- Non-catalog row details retain their existing, authorized native path.
 v_result:=private.dashboard_admin_live_native_collected_data(p_request);
 if coalesce(p_request->>'operation','catalog')<>'catalog'then return v_result;end if;
 v_scope:=private.dashboard_admin_live_scope();
 return v_result||jsonb_build_object('rows',(v_result->'rows')||private.team_sheet_catalog(v_scope));
end;$function$

