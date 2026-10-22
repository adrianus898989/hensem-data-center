CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_status(p_business text, p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when p_business='recharge' then case p_status
  when '2' then 'success' when '0' then 'pending' when '4' then 'failed' else 'unknown' end
 when p_business='withdraw' then case
  when p_status in('6','2') then 'success' when p_status in('0','1') then 'pending'
  when p_status in('4','7') then 'rejected' else 'unknown' end else 'unknown' end;
$function$
