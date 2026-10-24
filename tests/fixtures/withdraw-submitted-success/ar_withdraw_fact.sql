CREATE OR REPLACE FUNCTION private.ar_withdraw_fact(p_source_system text, p_country_code text, p_platform text, p_order_kind text, p_order_no text, p_status text, p_operator text, p_applied_at timestamp without time zone, p_completed_at timestamp without time zone, p_observed_at timestamp with time zone, p_updated_at timestamp with time zone)
 RETURNS TABLE(source_system text, country_code text, platform text, order_kind text, order_no text, status text, applied_at timestamp without time zone, account text, seconds numeric, is_success boolean, is_rejected boolean, method text, observed_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select p_source_system,p_country_code,p_platform,p_order_kind,p_order_no,f.status,p_applied_at,f.account,f.seconds,
  (position('已通过' IN f.status)>0 OR position('已提交' IN f.status)>0
   OR (position('通过' IN f.status)>0 AND position('未通过' IN f.status)=0)
   OR position('success' IN lower(f.status))>0 OR position('submitted' IN lower(f.status))>0 OR position('成功' IN f.status)>0),
  (position('未通过' IN f.status)>0 OR position('驳回' IN f.status)>0 OR position('拒绝' IN f.status)>0
   OR position('reject' IN lower(f.status))>0 OR position('failed' IN lower(f.status))>0),
  CASE WHEN lower(f.account) IN('','----','---','--','-','null','none','n/a') THEN 'unknown'
   WHEN position('system' IN lower(f.account))>0 THEN 'auto' ELSE 'manual' END,
  p_observed_at,p_updated_at
 from (select coalesce(p_status,'') status,
  btrim(replace(replace(coalesce(p_operator,''),chr(8203),''),chr(65279),''),
   U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') account,
  CASE WHEN p_completed_at>p_applied_at THEN trunc(extract(epoch FROM p_completed_at-p_applied_at)) END seconds
  offset 0) f
 where p_source_system='AR' and p_country_code='IN' and p_order_kind='withdraw' and p_applied_at>=timestamp '2026-10-10';
$function$
