-- 只读：确认 Supabase 当前保存的越南 LocalBank 费率
select
  'third_party_rates' as source,
  country,
  third_party,
  category,
  collect_fee,
  payout_fee,
  collect_single_fee,
  payout_single_fee,
  updated_at
from public.third_party_rates
where country like '%越南%'
  and lower(replace(third_party,' ','')) = 'localbank'

union all

select
  'platform_status' as source,
  country,
  third_party,
  category,
  collect_fee,
  payout_fee,
  collect_single_fee,
  payout_single_fee,
  updated_at
from public.third_party_platform_status
where country like '%越南%'
  and lower(replace(third_party,' ','')) = 'localbank'
order by updated_at desc nulls last, source;
