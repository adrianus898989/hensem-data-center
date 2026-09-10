-- Read-time classification only: raw snapshots, receipt hashes and collector writes stay unchanged.
create or replace function public.withdraw_reason_category(p_label text, p_classification text)
returns jsonb language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  label text := pg_catalog.btrim(p_label);
  compact text;
  parts text[];
  category text;
  stamp text := '(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)|\{日期时间\}|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
  -- A truncated text must never become a confidently classified cause.
  if p_classification in ('empty', 'truncated') then
    return pg_catalog.jsonb_build_object('label', label, 'classification', p_classification);
  end if;
  if pg_catalog.length(label) > 400 then raise exception 'WR_CATEGORY_LABEL_TOO_LONG'; end if;
  compact := pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.replace(label, '：', ':'), '，', ','), '[[:space:]]', '', 'g');

  -- Observed per-customer values are measurements, not configured rule thresholds.
  if compact ~ '^会员在限制的游戏类型中总的投注数:[0-9]+(?:\.[0-9]+)?$' then
    category := '受限游戏类型投注';
  elsif compact ~ '^累计提款次数不能小于[0-9]+次,当前累计提现次数:[0-9]+次$' then
    parts := pg_catalog.regexp_match(compact, '^(累计提款次数不能小于[0-9]+次),当前累计提现次数:[0-9]+次$');
    category := parts[1];
  elsif compact ~ '^当日盈利金额大于(?:\{金额\}|[0-9]+(?:\.[0-9]+)?),当日盈利:[0-9]+(?:\.[0-9]+)?$' then
    -- Ignore only actual daily profit; retain the condition and any numeric threshold.
    -- Full anchoring deliberately rejects additional causes, error codes and other comparisons.
    parts := pg_catalog.regexp_match(compact,
      '^(当日盈利金额大于(?:\{金额\}|[0-9]+(?:\.[0-9]+)?)),当日盈利:[0-9]+(?:\.[0-9]+)?$');
    category := parts[1];
  else
    parts := pg_catalog.regexp_match(compact,
      '^最后充值日限额超过当前配置的最后充值日限制:([0-9]+)天,最后充值时间:' || stamp || ',当前时间:' || stamp || ',间隔:[0-9]+天$');
    if parts is not null then category := '最后充值日超过限制（' || parts[1] || '天）'; end if;
  end if;

  -- Keep existing rule identities, including their thresholds, codes and negations.
  if category is null and (
    compact ~ '^同设备数大于[0-9]+$'
    or compact ~ '^当日出款笔数已达上限[0-9]+笔$'
    or compact ~ '^无充值连续提款大于[0-9]+次$'
    or compact ~ '^总提现/总充值大于[0-9]+(?:\.[0-9]+)?$'
    or compact in ('自动出款失败:未匹配到合适的出款通道', '提款金额大于自动出款金额', '会员备注不为空,请检查备注', '非法定货币不能自动出款')
  ) then category := compact; end if;

  return pg_catalog.jsonb_build_object('label', coalesce(category, label),
    'classification', case when category is not null then 'template' else p_classification end);
end;
$$;
revoke all on function public.withdraw_reason_category(text, text) from public, anon, authenticated;
grant execute on function public.withdraw_reason_category(text, text) to authenticated, service_role;
