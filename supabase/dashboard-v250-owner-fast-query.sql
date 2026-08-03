-- V250：Owner/Admin/Viewer + 三方量高速查询
-- 只执行一次；可重复执行（幂等）。

-- =========================================================
-- A. 账号分级：OWNER > ADMIN > VIEWER
-- =========================================================
alter table public.dashboard_profiles
  add column if not exists management_permissions jsonb not null default '{"manage_viewers":false,"refresh_data":false,"view_audit":false}'::jsonb;

alter table public.dashboard_profiles
  drop constraint if exists dashboard_profiles_role_check;

alter table public.dashboard_profiles
  add constraint dashboard_profiles_role_check
  check (role in ('owner','admin','viewer'));

update public.dashboard_profiles
set
  role = 'owner',
  active = true,
  permissions = jsonb_build_object(
    'home', true,
    'third_party', true,
    'auto_withdraw', true,
    'work_orders', true,
    'customer_service', true
  ),
  management_permissions = jsonb_build_object(
    'manage_viewers', true,
    'refresh_data', true,
    'view_audit', true
  ),
  updated_at = now()
where username = 'admin';

create unique index if not exists dashboard_profiles_single_owner_idx
  on public.dashboard_profiles ((role))
  where role = 'owner';

create or replace function public.dashboard_has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dashboard_profiles p
    where p.auth_user_id = auth.uid()
      and p.active = true
      and (
        p.role = 'owner'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  );
$$;

revoke all on function public.dashboard_has_permission(text) from public;
grant execute on function public.dashboard_has_permission(text) to authenticated;

-- =========================================================
-- B. 查询索引：日期 + 国家是新前台最常用的查询入口
-- =========================================================
create index if not exists third_party_volume_date_country_idx
  on public.third_party_volume (data_date, country);

create index if not exists third_party_volume_country_date_idx
  on public.third_party_volume (country, data_date);

create index if not exists third_party_volume_date_country_direction_idx
  on public.third_party_volume (data_date, country, direction);

-- =========================================================
-- C. 高速 RPC
-- 关键：一次 RPC 返回一个 JSON，不再由 Netlify 每 1000 行请求几十次。
-- 默认会额外保留开始日期前 1 天，继续兼容 v239 的“昨日对比”。
-- p_country 为空 = 全国家；传具体国家 = 只取该国家。
-- “所有国家USDT”会只取 USDT/TRC20/ERC20/TRON/TRX 相关行。
-- =========================================================
create or replace function public.dashboard_third_party_volume_fast(
  p_start date,
  p_end date,
  p_country text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with filtered as (
  select
    id,
    sheet_name,
    source_row,
    data_date,
    country,
    platform,
    channel,
    raw_channel,
    channel_type,
    direction,
    amount,
    count,
    success_count,
    failed_count,
    success_rate,
    status,
    coalesce((
      select jsonb_object_agg(e.key, e.value)
      from jsonb_each(coalesce(third_party_volume.raw, '{}'::jsonb)) e
      where e.key ~* '(映射|mapping|map)'
    ), '{}'::jsonb) as raw_small,
    updated_at
  from public.third_party_volume
  where data_date between (p_start - 1) and p_end
    and (
      coalesce(trim(p_country), '') = ''
      or country = p_country
      or (
        p_country = '所有国家USDT'
        and concat_ws(' ', country, platform, channel, raw_channel, channel_type, sheet_name)
          ~* '(usdt|trc20|erc20|tron|trx)'
      )
    )
), packed as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'sheet_name', coalesce(sheet_name, ''),
        'source_row', coalesce(source_row, 0),
        'data_date', data_date,
        'country', coalesce(country, ''),
        'platform', coalesce(platform, ''),
        'channel', coalesce(channel, ''),
        'raw_channel', coalesce(raw_channel, ''),
        'channel_type', coalesce(channel_type, ''),
        'direction', coalesce(direction, ''),
        'amount', coalesce(amount, 0),
        'count', coalesce(count, 0),
        'success_count', coalesce(success_count, 0),
        'failed_count', coalesce(failed_count, 0),
        'success_rate', coalesce(success_rate, 0),
        'status', coalesce(status, ''),
        'raw', raw_small,
        'updated_at', updated_at
      )
      order by data_date, country, platform, channel, channel_type, direction
    ),
    '[]'::jsonb
  ) as rows,
  count(*)::int as row_count,
  max(updated_at) as latest_write_at
  from filtered
)
select jsonb_build_object(
  'ok', true,
  'rows', rows,
  'rowCount', row_count,
  'latestWriteAt', latest_write_at,
  'queryCountry', coalesce(p_country, ''),
  'queryStart', p_start,
  'queryEnd', p_end
)
from packed;
$$;

revoke all on function public.dashboard_third_party_volume_fast(date,date,text) from public;
grant execute on function public.dashboard_third_party_volume_fast(date,date,text) to authenticated;

-- =========================================================
-- D. 最后只读检查
-- =========================================================
select
  username,
  role,
  active,
  permissions,
  management_permissions
from public.dashboard_profiles
order by case role when 'owner' then 1 when 'admin' then 2 else 3 end, username;
