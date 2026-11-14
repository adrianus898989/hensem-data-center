-- Only the fields needed for bounded lookup under the finance detail role.
create table public.ar_collected_orders (
  source_system text, country_code text, platform text, order_kind text, order_no text,
  status text, remark text, manual_remark text, amount numeric, raw_channel text, channel_type text, completed_at timestamp,
  money_format_version smallint, amount_local numeric, currency_local text, money_issue_code text,
  primary key (source_system,country_code,platform,order_kind,order_no)
);
-- Existing production amount reader, including its independent unit evidence.
create function private.dashboard_admin_ar_local_amount(p_country text,p_kind text,p_channel_type text,
  p_version smallint,p_local numeric,p_local_currency text,p_issue text,p_legacy_display numeric)
returns numeric language sql immutable parallel safe set search_path='' as $$
 select case
  when p_country is distinct from 'IN' then p_legacy_display
  when p_issue='LOCAL_AMOUNT_STALE_FOR_USDT' then null::numeric
  when p_version is not null then case when p_version=1 and p_local_currency='INR'
    and (p_issue is null or p_issue='LOCAL_AMOUNT_NOT_PROVIDED') and p_local is not null
    and p_local::text not in ('NaN','Infinity','-Infinity') then p_local else null::numeric end
  when p_kind='withdraw' and upper(btrim(coalesce(p_channel_type,'')))='USDT' then null::numeric
  else p_legacy_display end
$$;
