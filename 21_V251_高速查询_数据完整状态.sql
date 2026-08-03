-- V251：高速三方查询 + 数据完整状态
-- 前提：V250 的 Owner/Admin/Viewer SQL 已执行。
-- 本 SQL 可重复执行，不删除业务数据。

-- =========================================================
-- A. 高频查询索引
-- =========================================================
create index if not exists third_party_volume_date_country_platform_idx
  on public.third_party_volume (data_date, country, platform);

create index if not exists third_party_volume_date_country_channel_idx
  on public.third_party_volume (data_date, country, channel);

create index if not exists third_party_volume_date_country_direction_idx
  on public.third_party_volume (data_date, country, direction);

-- =========================================================
-- B. 高速查询 V2
-- 一次 RPC；优先按国家缩小范围；数据库内部先按 v239 dashboard key 聚合。
-- 不返回整列 raw，只保留映射字段，显著缩小 JSON。
-- p_country 为空 = 全国家；所有国家USDT = 只取 USDT/TRX 通道。
-- =========================================================
create or replace function public.dashboard_third_party_volume_fast_v2(
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
    data_date,
    country,
    platform,
    channel,
    channel_type,
    direction,
    amount,
    count,
    success_count,
    failed_count,
    success_rate,
    raw_channel,
    sheet_name,
    updated_at,
    coalesce((
      select jsonb_object_agg(e.key, e.value)
      from jsonb_each(coalesce(v.raw, '{}'::jsonb)) e
      where e.key ~* '(映射|mapping|map)'
    ), '{}'::jsonb) as raw_small
  from public.third_party_volume v
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
), grouped as (
  select
    data_date,
    country,
    platform,
    channel,
    channel_type,
    direction,
    sum(coalesce(amount,0)) as amount,
    sum(coalesce(count,0)) as count,
    sum(coalesce(success_count,0)) as success_count,
    sum(coalesce(failed_count,0)) as failed_count,
    case when sum(coalesce(count,0)) > 0
      then sum(coalesce(success_count,0))::numeric / sum(coalesce(count,0))::numeric
      else max(coalesce(success_rate,0)) end as success_rate,
    min(nullif(raw_channel,'')) as raw_channel,
    min(nullif(sheet_name,'')) as sheet_name,
    coalesce(min(raw_small::text)::jsonb, '{}'::jsonb) as raw_small,
    max(updated_at) as updated_at
  from filtered
  group by data_date, country, platform, channel, channel_type, direction
), packed as (
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', md5(concat_ws('|||', data_date::text,country,platform,channel,channel_type,direction)),
        'sheet_name', coalesce(sheet_name,''),
        'source_row', 0,
        'data_date', data_date,
        'country', coalesce(country,''),
        'platform', coalesce(platform,''),
        'channel', coalesce(channel,''),
        'raw_channel', coalesce(raw_channel,channel,''),
        'channel_type', coalesce(channel_type,''),
        'direction', coalesce(direction,''),
        'amount', coalesce(amount,0),
        'count', coalesce(count,0),
        'success_count', coalesce(success_count,0),
        'failed_count', coalesce(failed_count,0),
        'success_rate', coalesce(success_rate,0),
        'status', '',
        'raw', raw_small,
        'updated_at', updated_at
      )
      order by data_date, country, platform, channel, channel_type, direction
    ), '[]'::jsonb) as rows,
    count(*)::int as row_count,
    max(updated_at) as latest_write_at,
    count(distinct data_date)::int as data_days,
    count(distinct country)::int as country_count,
    count(distinct platform)::int as platform_count,
    count(distinct channel)::int as channel_count
  from grouped
)
select jsonb_build_object(
  'ok', true,
  'rows', rows,
  'rowCount', row_count,
  'latestWriteAt', latest_write_at,
  'dataDays', data_days,
  'countryCount', country_count,
  'platformCount', platform_count,
  'channelCount', channel_count,
  'queryCountry', coalesce(p_country,''),
  'queryStart', p_start,
  'queryEnd', p_end
)
from packed;
$$;

revoke all on function public.dashboard_third_party_volume_fast_v2(date,date,text) from public;
grant execute on function public.dashboard_third_party_volume_fast_v2(date,date,text) to authenticated;

-- =========================================================
-- C. 数据完整状态
-- 历史月份以 backfill 任务成功数为准；不是通过“某国家是否每天有行”猜完整度。
-- 当前/昨日同时返回实际 DB 最后写入时间与代收/代付存在情况。
-- =========================================================
create or replace function public.dashboard_third_party_sync_status(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean := false;
  v_total int := 0;
  v_success int := 0;
  v_remaining int := 0;
  v_failed int := 0;
  v_rows bigint := 0;
  v_hist_last timestamptz;
  v_db_last timestamptz;
  v_data_days int := 0;
  v_collect_days int := 0;
  v_payout_days int := 0;
  v_rate_last timestamptz;
begin
  select public.dashboard_has_permission('third_party') into v_allowed;
  if coalesce(v_allowed,false) is not true then
    raise exception '没有三方量 / 费率查看权限';
  end if;

  select
    count(*)::int,
    count(*) filter (where status='success')::int,
    count(*) filter (where status in ('pending','retry'))::int,
    count(*) filter (where status='failed')::int,
    coalesce(sum(rows_written),0)::bigint,
    max(last_sync_at)
  into v_total,v_success,v_remaining,v_failed,v_rows,v_hist_last
  from public.third_party_history_backfill
  where data_date between p_start and p_end;

  select
    max(updated_at),
    count(distinct data_date)::int,
    count(distinct data_date) filter (where direction='代收')::int,
    count(distinct data_date) filter (where direction='代付')::int
  into v_db_last,v_data_days,v_collect_days,v_payout_days
  from public.third_party_volume
  where data_date between p_start and p_end;

  select greatest(
    coalesce((select max(updated_at) from public.third_party_rates), '-infinity'::timestamptz),
    coalesce((select max(updated_at) from public.third_party_platform_status), '-infinity'::timestamptz)
  ) into v_rate_last;
  if v_rate_last = '-infinity'::timestamptz then v_rate_last := null; end if;

  return jsonb_build_object(
    'ok', true,
    'start', p_start,
    'end', p_end,
    'historyTasks', v_total,
    'historySuccess', v_success,
    'historyRemaining', v_remaining,
    'historyFailed', v_failed,
    'historyRowsWritten', v_rows,
    'historyLatestSyncAt', v_hist_last,
    'historyComplete', (v_total > 0 and v_success = v_total and v_failed = 0 and v_remaining = 0),
    'dataDays', v_data_days,
    'collectDays', v_collect_days,
    'payoutDays', v_payout_days,
    'latestWriteAt', v_db_last,
    'ratesLatestWriteAt', v_rate_last
  );
end;
$$;

revoke all on function public.dashboard_third_party_sync_status(date,date) from public;
grant execute on function public.dashboard_third_party_sync_status(date,date) to authenticated;

-- =========================================================
-- D. 只读确认
-- =========================================================
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('dashboard_third_party_volume_fast_v2','dashboard_third_party_sync_status')
order by p.proname;
