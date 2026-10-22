CREATE OR REPLACE FUNCTION private.dashboard_admin_yash_status(p_kind text, p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case
  when p_kind='deposit' and p_status in('充值成功','人工确认成功') then 'success'
  when p_kind='withdrawal' and p_status in('已提现','人工确认成功') then 'success'
  when p_kind='deposit' and p_status in('已创建','处理中') then 'pending'
  when p_kind='withdrawal' and p_status in('审核中','提现中','审核通过') then 'pending'
  when p_kind='deposit' and p_status in('充值失败','订单过期') then 'failed'
  when p_kind='deposit' and p_status='用户取消' then 'rejected'
  when p_kind='withdrawal' and p_status in('已驳回','已退币') then 'rejected'
  when p_kind='withdrawal' and p_status in('已罚没','提现失败') then 'failed'
  else 'unknown' end;
$function$
