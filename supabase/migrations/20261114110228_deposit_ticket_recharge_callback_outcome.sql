-- The existing order reader already authorizes, paginates and joins a unique
-- native payment order. Only disclose the outcome of a known AR notification;
-- free-form remarks never enter the response.
create or replace function private.dashboard_ticket_recharge_order(
  p_source text,p_country text,p_platform text,p_timezone text,p_order_no text)
returns jsonb language plpgsql stable security invoker set search_path='' as $charge$
declare
  result jsonb; matches jsonb;
begin
  if nullif(btrim(p_order_no),'') is null then return jsonb_build_object('match','no_reference');end if;
  if p_source='ar' then
    select jsonb_build_object(
      'match','matched','status',a.status,
      'callbackOutcome',case
        when a.status='已支付' and btrim(a.remark)='Third Party Notify Confirm' then 'confirmed'
        when a.status='已取消' and btrim(a.remark)='Third Party Notify Cancel' then 'cancelled'
      end,
      'amount',m.amount::text,
      'currency',case when p_country='IN' and a.money_format_version=1 and a.currency_local='INR'
                            and m.amount is not null then a.currency_local end,
      'provider',nullif(btrim(a.raw_channel),''),'channelType',nullif(btrim(a.channel_type),''),
      'utr',null,'completedAt',case when a.status='已支付' then a.completed_at at time zone p_timezone end)
    into result from public.ar_collected_orders a
    cross join lateral(select private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,
       a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) as amount) m
    where a.source_system='AR' and a.country_code=p_country and a.platform=p_platform
      and a.order_kind='recharge' and a.order_no=p_order_no;
  elsif p_source='newar' then
    select jsonb_agg(jsonb_build_object(
      'match','matched','status',coalesce(nullif(c.raw->>'rechargeState',''),c.status_code),
      'amount',c.amount::text,'currency',case when jsonb_typeof(c.raw->'currency')='string'
                  then nullif(btrim(c.raw->>'currency'),'') end,
      'provider',nullif(btrim(c.provider),''),'channelType',nullif(btrim(c.channel_type),''),
      'utr',case when p_country='IN' and jsonb_typeof(c.raw->'utr')='string' then nullif(btrim(c.raw->>'utr'),'') end,
      'completedAt',case when c.raw->>'rechargeState'='Payed' then c.raw->>'sourcePaidAt' end))
    into matches from (
      select d.amount,d.raw,d.status_code,d.provider,d.channel_type
      from public.newar_detail_platforms cfg join public.newar_detail_records d on d.platform=cfg.platform
      where cfg.platform=p_platform and cfg.country_code=p_country and cfg.enabled and cfg.timezone=p_timezone
        and (cfg.launch_at is null or (cfg.launch_at<=statement_timestamp() and d.created_at>=cfg.launch_at))
        and d.dataset='charge' and d.order_number=p_order_no limit 2
    ) c;
    if jsonb_array_length(matches)>1 then return jsonb_build_object('match','ambiguous');end if;
    result:=matches->0;
  end if;
  return coalesce(result,jsonb_build_object('match','not_found'));
end;
$charge$;
