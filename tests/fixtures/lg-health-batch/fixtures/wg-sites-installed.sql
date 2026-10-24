CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_sites()
 RETURNS TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 values ('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),
 ('8311','BR','巴西','POPKKK','America/Sao_Paulo','BRL'),
 ('12588','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),
 ('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'),
 ('3605','VN','越南','XX98','Asia/Ho_Chi_Minh','VND');
$function$
