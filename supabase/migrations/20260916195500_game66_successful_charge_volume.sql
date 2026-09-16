-- Dashboard collection amount/count represent successful settled deposits.
-- Keep submitted/failed metrics only as supporting raw values; never add them
-- to the displayed collection amount or collection count.
create or replace function public.dashboard_game66_charge_volume(
  p_start date,
  p_end date,
  p_country text default null
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_latest timestamptz;
  v_country text := nullif(pg_catalog.btrim(coalesce(p_country, '')), '');
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  if (select auth.uid()) is null and current_user not in ('service_role', 'postgres') then
    raise exception using errcode = '28000', message = 'GAME66_AUTH_REQUIRED';
  end if;
  if (select auth.uid()) is not null and not public.dashboard_has_permission('third_party') then
    raise exception using errcode = '42501', message = 'GAME66_PERMISSION_DENIED';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 731
    or (v_country is not null and (pg_catalog.length(v_country) > 80 or v_country ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'GAME66_INVALID_RANGE';
  end if;

  v_start_at := p_start::timestamp at time zone 'Asia/Kolkata';
  v_end_at := (p_end + 1)::timestamp at time zone 'Asia/Kolkata';

  with grouped as (
    select
      (c.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(c.pay_method_name), ''), nullif(pg_catalog.btrim(c.pay_method_code), ''), nullif(pg_catalog.btrim(c.channel), ''), '未标记三方') as channel,
      coalesce(nullif(pg_catalog.btrim(c.pay_mode), ''), '其他类型') as channel_type,
      '代收'::text as direction,
      coalesce(sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) filter (where c.status_code = '1'), 0) as amount,
      count(*) filter (where c.status_code = '1')::bigint as order_count,
      count(*) filter (where c.status_code = '1')::bigint as success_count,
      count(*) filter (where c.status_code is distinct from '1')::bigint as failed_count,
      count(*)::bigint as submitted_count,
      sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) as submitted_amount,
      max(c.last_seen_at) as updated_at,
      bool_or(coalesce(g.enabled, false)) as platform_enabled,
      coalesce(sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) filter (where c.status_code = '1'), 0) as success_amount
    from public.game66_charge_orders c
    join public.game66_platforms g on g.id = c.platform_id
    where c.create_time >= v_start_at
      and c.create_time < v_end_at
      and (v_country is null or v_country in (
        g.team_name, g.team_code,
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end
      ))
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
    group by 1, 2, 3, 4, 5, 6, 7
    having count(*) filter (where c.status_code = '1') > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', data_date::text, country, platform, channel, channel_type, direction)),
      'sheet_name', 'game66_charge_orders', 'source_row', 0, 'data_date', data_date,
      'country', country, 'country_code', country_code, 'platform', platform,
      'channel', channel, 'raw_channel', channel, 'channel_type', channel_type,
      'direction', direction, 'amount', amount, 'count', order_count,
      'success_count', success_count, 'failed_count', failed_count,
      'success_rate', case when submitted_count > 0 then success_count::numeric / submitted_count else 0 end,
      'status', case when platform_enabled then '66GAME 成功到账订单' else '66GAME 成功到账订单（同步未启用）' end,
      'raw', jsonb_build_object(
        'source_team', country,
        'paid_amount', success_amount,
        'submitted_amount', submitted_amount,
        'submitted_count', submitted_count,
        'platform_enabled', platform_enabled
      ),
      'updated_at', updated_at
    ) order by data_date, country, platform, channel, channel_type), '[]'::jsonb),
    count(*)::integer, max(updated_at)
  into v_rows, v_row_count, v_latest from grouped;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'rowCount', v_row_count,
    'latestWriteAt', v_latest, 'queryStart', p_start, 'queryEnd', p_end);
end;
$$;

revoke all on function public.dashboard_game66_charge_volume(date,date,text) from public, anon;
grant execute on function public.dashboard_game66_charge_volume(date,date,text) to authenticated, service_role;
