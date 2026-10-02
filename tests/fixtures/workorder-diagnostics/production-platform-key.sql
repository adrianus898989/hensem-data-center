CREATE OR REPLACE FUNCTION private.dashboard_admin_live_workorder_platform_key(p_country text, p_platform text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when upper(btrim(p_country)) in ('IN','INDIA','印度') then
    case upper(btrim(p_platform))
      when '82BET' then '82LOTTERY' when '82LOTTERY' then '82LOTTERY'
      when 'OK.WIN' then 'OKWIN' when 'OKWIN' then 'OKWIN'
      when 'VEER.GAME' then 'VEERGAME' when 'VEERGAME' then 'VEERGAME'
      when 'RAJA' then 'RAJA' when 'RAJALOTTERY' then 'RAJA'
      when 'RAJAGAME' then 'RAJA' when 'RAJAGAMES' then 'RAJA'
      else p_platform end
    else p_platform end;
$function$
;
