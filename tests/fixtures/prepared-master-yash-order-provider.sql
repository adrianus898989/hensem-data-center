-- Actual YASH classification helper from migration 20261015140304.
create or replace function private.dashboard_admin_yash_order_provider(p_order_type text,p_supplier text,p_channel text)
returns text language sql immutable security invoker set search_path='' as $helper$
 select case when btrim(p_supplier)='ArbPay' and
  ((p_order_type='deposit' and btrim(p_channel)='Phonepe_QR')
   or (p_order_type='withdrawal' and btrim(p_channel)='Arb-BANK'))
 then 'UPI-QR' else private.dashboard_admin_yash_provider(p_supplier) end;
$helper$;
revoke all on function private.dashboard_admin_yash_order_provider(text,text,text) from public,anon,authenticated,service_role;
