CREATE OR REPLACE FUNCTION private.dashboard_admin_yash_order_provider(p_order_type text, p_supplier text, p_channel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when btrim(p_supplier)='ArbPay' and
  ((p_order_type='deposit' and btrim(p_channel)='Phonepe_QR')
   or (p_order_type='withdrawal' and btrim(p_channel)='Arb-BANK'))
 then 'UPI-QR' else private.dashboard_admin_yash_provider(p_supplier) end;
$function$
