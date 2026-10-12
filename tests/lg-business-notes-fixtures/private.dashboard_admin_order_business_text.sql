CREATE OR REPLACE FUNCTION private.dashboard_admin_order_business_text(v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(coalesce(v,''),'0x[a-f0-9]{40}|(bc1|tb1)[a-z0-9]{20,90}|\mT[1-9A-HJ-NP-Za-km-z]{33}\M','[已移除地址]','gi'),'https?://[^[:space:]]+','[已移除链接]','gi'),
  '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}','[已移除邮箱]','gi'),
  '[+]?[0-9][0-9 ().-]{5,}[0-9]','[已移除号码]','g'),
  '[[:cntrl:]]',' ','g')),256),'');
$function$
