-- Complete the GAME66 team dashboard from its normalized order tables.
-- Collection volume is successful/settled only; the success snapshots retain
-- every submitted order as the denominator. Payout volume is successful only,
-- while exact status=1 orders are exposed separately as pending.

create index if not exists game66_withdraw_orders_volume_cover_idx
  on public.game66_withdraw_orders (platform_id, status_code, create_time)
  include (
    pay_channel,
    pay_method_name,
    pay_method_code,
    channel,
    payout_mode,
    amount_display,
    amount_minor,
    fee_display,
    fee_minor,
    real_amount_display,
    real_amount_minor,
    last_seen_at
  );

create or replace function public.dashboard_game66_charge_volume(
  p_start date,
  p_end date,
  p_country text default null
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_collection_snapshots jsonb := '[]'::jsonb;
  v_withdraw_pending_snapshots jsonb := '[]'::jsonb;
  v_withdraw_actual_rows jsonb := '[]'::jsonb;
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

  with charge_grouped as (
    select
      (c.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(c.pay_method_name), ''), nullif(pg_catalog.btrim(c.pay_method_code), ''), nullif(pg_catalog.btrim(c.channel), ''), '66GAME') as channel,
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
    where c.create_time >= v_start_at and c.create_time < v_end_at
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
  ), payout_grouped as (
    select
      (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(w.pay_channel), ''), nullif(pg_catalog.btrim(w.pay_method_name), ''), nullif(pg_catalog.btrim(w.pay_method_code), ''), nullif(pg_catalog.btrim(w.channel), ''), '66GAME') as channel,
      coalesce(nullif(pg_catalog.btrim(w.payout_mode), ''), '其他类型') as channel_type,
      '代付'::text as direction,
      sum(coalesce(nullif(w.amount_display, 0), w.amount_minor / 100.0, 0)) as amount,
      count(*)::bigint as order_count,
      count(*)::bigint as success_count,
      0::bigint as failed_count,
      count(*)::bigint as submitted_count,
      sum(coalesce(nullif(w.amount_display, 0), w.amount_minor / 100.0, 0)) as submitted_amount,
      max(w.last_seen_at) as updated_at,
      bool_or(coalesce(g.enabled, false)) as platform_enabled,
      sum(coalesce(nullif(w.real_amount_display, 0), w.real_amount_minor / 100.0, 0)) as success_amount
    from public.game66_withdraw_orders w
    join public.game66_platforms g on g.id = w.platform_id
    where w.status_code = '3'
      and w.create_time >= v_start_at and w.create_time < v_end_at
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
  ), grouped as (
    select * from charge_grouped
    union all
    select * from payout_grouped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', data_date::text, country, platform, channel, channel_type, direction)),
      'sheet_name', case when direction = '代收' then 'game66_charge_orders' else 'game66_withdraw_orders' end,
      'source_row', 0, 'data_date', data_date,
      'country', country, 'country_code', country_code, 'platform', platform,
      'channel', channel, 'raw_channel', channel, 'channel_type', channel_type,
      'direction', direction, 'amount', amount, 'count', order_count,
      'success_count', success_count, 'failed_count', failed_count,
      'success_rate', case when submitted_count > 0 then success_count::numeric / submitted_count else 0 end,
      'status', case
        when direction = '代收' and platform_enabled then '66GAME 成功到账订单'
        when direction = '代收' then '66GAME 成功到账订单（同步未启用）'
        when platform_enabled then '66GAME 付款成功订单'
        else '66GAME 付款成功订单（同步未启用）' end,
      'raw', jsonb_build_object(
        'source_team', country,
        'successful_amount', success_amount,
        'submitted_amount', submitted_amount,
        'submitted_count', submitted_count,
        'platform_enabled', platform_enabled
      ),
      'updated_at', updated_at
    ) order by data_date, country, platform, direction, channel, channel_type), '[]'::jsonb),
    count(*)::integer, max(updated_at)
  into v_rows, v_row_count, v_latest from grouped;

  -- Submission-date collection snapshots keep all submitted orders as the
  -- denominator, and successful settled orders as the numerator.
  with grouped as (
    select
      (c.create_time at time zone 'Asia/Kolkata')::date as stat_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(c.pay_method_name), ''), nullif(pg_catalog.btrim(c.pay_method_code), ''), nullif(pg_catalog.btrim(c.channel), ''), '66GAME') as raw_channel,
      coalesce(nullif(pg_catalog.btrim(c.pay_mode), ''), '其他类型') as channel_type,
      count(*)::bigint as submitted_count,
      count(*) filter (where c.status_code = '1')::bigint as success_count,
      max(c.last_seen_at) as snapshot_at
    from public.game66_charge_orders c
    join public.game66_platforms g on g.id = c.platform_id
    where c.create_time >= v_start_at and c.create_time < v_end_at
      and (v_country is null or v_country in (
        g.team_name, g.team_code,
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end
      ))
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
    group by 1, 2, 3, 4, 5
  ), platform_day as (
    select stat_date, country_code, platform,
      sum(submitted_count)::bigint as submitted_count,
      sum(success_count)::bigint as success_count,
      max(snapshot_at) as snapshot_at,
      jsonb_agg(jsonb_build_object(
        'raw_channel', raw_channel, 'channel_type', channel_type,
        'submitted_count', submitted_count, 'success_count', success_count
      ) order by raw_channel, channel_type) as groups
    from grouped group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema_version', 1,
    'source_system', 'RECHARGE_REVIEW',
    'country_code', country_code,
    'platform', platform,
    'stat_date', stat_date,
    'timezone', 'Asia/Kolkata',
    'snapshot_id', md5(concat_ws('|||', 'GAME66_CHARGE', country_code, platform, stat_date::text)),
    'snapshot_at', coalesce(snapshot_at, v_end_at - interval '1 microsecond'),
    'coverage', jsonb_build_object(
      'complete', true, 'expected_count', submitted_count,
      'fetched_count', submitted_count, 'unique_count', submitted_count
    ),
    'totals', jsonb_build_object('submitted_count', submitted_count, 'success_count', success_count),
    'groups', groups
  ) order by stat_date, country_code, platform), '[]'::jsonb)
  into v_collection_snapshots from platform_day;

  -- Successful payouts provide requested amount, actual arrival and fee from
  -- the platform's own fields (no derived approximation).
  with grouped as (
    select
      (w.create_time at time zone 'Asia/Kolkata')::date as stat_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(w.pay_channel), ''), nullif(pg_catalog.btrim(w.pay_method_name), ''), nullif(pg_catalog.btrim(w.pay_method_code), ''), nullif(pg_catalog.btrim(w.channel), ''), '66GAME') as third_party,
      coalesce(nullif(pg_catalog.btrim(w.payout_mode), ''), '其他类型') as channel_type,
      count(*)::bigint as order_count,
      sum(coalesce(nullif(w.amount_display, 0), w.amount_minor / 100.0, 0)) as requested_amount,
      sum(coalesce(nullif(w.real_amount_display, 0), w.real_amount_minor / 100.0, 0)) as actual_amount,
      sum(coalesce(nullif(w.fee_display, 0), w.fee_minor / 100.0, 0)) as fee_amount,
      max(w.last_seen_at) as source_updated_at
    from public.game66_withdraw_orders w
    join public.game66_platforms g on g.id = w.platform_id
    where w.status_code = '3'
      and w.create_time >= v_start_at and w.create_time < v_end_at
      and (v_country is null or v_country in (
        g.team_name, g.team_code,
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end
      ))
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
    group by 1, 2, 3, 4, 5, 6
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stat_date', stat_date, 'country_code', country_code, 'country', country,
    'platform', platform, 'third_party', third_party, 'channel_type', channel_type,
    'order_count', order_count, 'requested_amount', requested_amount,
    'actual_amount', actual_amount, 'fee_amount', fee_amount,
    'source_updated_at', source_updated_at
  ) order by stat_date, country_code, platform, third_party, channel_type), '[]'::jsonb)
  into v_withdraw_actual_rows from grouped;

  -- Exact status=1 orders are still submitted/unprocessed. Include an empty,
  -- complete snapshot for active platform-days so a real zero is not shown as
  -- missing data.
  with activity as (
    select c.platform_id, (c.create_time at time zone 'Asia/Kolkata')::date as stat_date, c.last_seen_at
    from public.game66_charge_orders c
    where c.create_time >= v_start_at and c.create_time < v_end_at
    union all
    select w.platform_id, (w.create_time at time zone 'Asia/Kolkata')::date as stat_date, w.last_seen_at
    from public.game66_withdraw_orders w
    where w.create_time >= v_start_at and w.create_time < v_end_at
  ), platform_days as (
    select a.platform_id, a.stat_date, max(a.last_seen_at) as source_updated_at
    from activity a group by 1, 2
  ), pending_grouped as (
    select
      w.platform_id,
      (w.create_time at time zone 'Asia/Kolkata')::date as stat_date,
      coalesce(nullif(pg_catalog.btrim(w.pay_channel), ''), nullif(pg_catalog.btrim(w.pay_method_name), ''), nullif(pg_catalog.btrim(w.pay_method_code), ''), nullif(pg_catalog.btrim(w.channel), ''), '66GAME') as raw_channel,
      coalesce(nullif(pg_catalog.btrim(w.payout_mode), ''), '其他类型') as channel_type,
      count(*)::bigint as pending_count,
      sum(coalesce(nullif(w.amount_display, 0), w.amount_minor / 100.0, 0)) as pending_amount,
      max(w.last_seen_at) as snapshot_at
    from public.game66_withdraw_orders w
    where w.status_code = '1'
      and w.create_time >= v_start_at and w.create_time < v_end_at
    group by 1, 2, 3, 4
  ), platform_day as (
    select
      pd.stat_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(sum(pg.pending_count), 0)::bigint as pending_count,
      coalesce(sum(pg.pending_amount), 0) as pending_amount,
      coalesce(max(pg.snapshot_at), pd.source_updated_at, v_end_at - interval '1 microsecond') as snapshot_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'raw_channel', pg.raw_channel, 'channel_type', pg.channel_type,
        'pending_count', pg.pending_count, 'pending_amount', pg.pending_amount
      ) order by pg.raw_channel, pg.channel_type) filter (where pg.pending_count > 0), '[]'::jsonb) as groups
    from platform_days pd
    join public.game66_platforms g on g.id = pd.platform_id
    left join pending_grouped pg on pg.platform_id = pd.platform_id and pg.stat_date = pd.stat_date
    where (v_country is null or v_country in (
        g.team_name, g.team_code,
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end
      ))
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
    group by pd.stat_date, g.team_code, g.platform_name, g.platform_code, pd.source_updated_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema_version', 1,
    'source_system', 'WITHDRAW_REVIEW',
    'country_code', country_code,
    'platform', platform,
    'stat_date', stat_date,
    'timezone', 'Asia/Kolkata',
    'snapshot_id', md5(concat_ws('|||', 'GAME66_WITHDRAW_PENDING', country_code, platform, stat_date::text)),
    'snapshot_at', snapshot_at,
    'coverage', jsonb_build_object(
      'complete', true, 'expected_count', pending_count,
      'fetched_count', pending_count, 'unique_count', pending_count
    ),
    'totals', jsonb_build_object('pending_count', pending_count, 'pending_amount', pending_amount),
    'groups', groups
  ) order by stat_date, country_code, platform), '[]'::jsonb)
  into v_withdraw_pending_snapshots from platform_day;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'rowCount', v_row_count,
    'collectionSuccessSnapshots', v_collection_snapshots,
    'withdrawPendingSnapshots', v_withdraw_pending_snapshots,
    'withdrawActualRows', v_withdraw_actual_rows,
    'latestWriteAt', v_latest,
    'queryStart', p_start,
    'queryEnd', p_end
  );
end;
$$;

revoke all on function public.dashboard_game66_charge_volume(date,date,text) from public, anon;
grant execute on function public.dashboard_game66_charge_volume(date,date,text) to authenticated, service_role;
