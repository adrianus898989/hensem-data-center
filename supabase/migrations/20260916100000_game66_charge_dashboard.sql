-- Expose the already-ingested 66GAME charge orders in the dashboard.
-- The source has no country column; its withdrawal feed identifies code 3 as
-- India, and the 66GAME charge day is aligned to Asia/Kolkata. Keep the team
-- name in raw metadata so this does not silently masquerade as another source.
create or replace function public.dashboard_game66_charge_volume(
  p_start date,
  p_end date,
  p_country text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean := false;
  v_rows jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_latest timestamptz;
begin
  select public.dashboard_has_permission('third_party') into v_allowed;
  if coalesce(v_allowed, false) is not true then
    raise exception '没有三方量查看权限';
  end if;

  with grouped as (
    select
      (c.create_time at time zone 'Asia/Kolkata')::date as data_date,
      'IN'::text as country_code,
      '印度'::text as country,
      coalesce(nullif(btrim(g.platform_name), ''), '66GAME') as platform,
      coalesce(
        nullif(btrim(c.pay_method_name), ''),
        nullif(btrim(c.pay_method_code), ''),
        nullif(btrim(c.channel), ''),
        '未标记三方'
      )::text as channel,
      coalesce(nullif(btrim(c.pay_mode), ''), '其他类型')::text as channel_type,
      coalesce(
        nullif(btrim(c.pay_method_name), ''),
        nullif(btrim(c.pay_method_code), ''),
        nullif(btrim(c.channel), ''),
        '未标记三方'
      )::text as raw_channel,
      '代收'::text as direction,
      sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) as amount,
      count(*)::bigint as order_count,
      count(*) filter (where c.status_code = '1')::bigint as success_count,
      count(*) filter (where c.status_code is distinct from '1')::bigint as failed_count,
      max(c.last_seen_at) as updated_at,
      max(g.team_name) as team_name,
      bool_or(coalesce(g.enabled, false)) as platform_enabled,
      sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0))
        filter (where c.status_code = '1') as success_amount
    from public.game66_charge_orders c
    join public.game66_platforms g on g.id = c.platform_id
    where (c.create_time at time zone 'Asia/Kolkata')::date between p_start and p_end
      and (coalesce(trim(p_country), '') = '' or p_country in ('IN', '印度'))
    group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', data_date::text, country, platform, channel, channel_type, direction)),
      'sheet_name', 'game66_charge_orders',
      'source_row', 0,
      'data_date', data_date,
      'country', country,
      'platform', platform,
      'channel', channel,
      'raw_channel', raw_channel,
      'channel_type', channel_type,
      'direction', direction,
      'amount', amount,
      'count', order_count,
      'success_count', success_count,
      'failed_count', failed_count,
      'success_rate', case when order_count > 0 then success_count::numeric / order_count::numeric else 0 end,
      'status', case when platform_enabled then '66GAME 原始订单' else '66GAME 原始订单（配置未启用）' end,
      'raw', jsonb_build_object(
        'source_team', team_name,
        'paid_amount', success_amount,
        'pay_mode', channel_type,
        'pay_method_name', channel,
        'platform_enabled', platform_enabled
      ),
      'updated_at', updated_at
      ) order by data_date, platform, channel, channel_type), '[]'::jsonb),
    count(*)::integer,
    max(updated_at)
  into v_rows, v_row_count, v_latest
  from grouped;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'rowCount', v_row_count,
    'latestWriteAt', v_latest,
    'queryStart', p_start,
    'queryEnd', p_end
  );
end;
$$;

revoke all on function public.dashboard_game66_charge_volume(date, date, text) from public, anon;
grant execute on function public.dashboard_game66_charge_volume(date, date, text) to authenticated, service_role;
