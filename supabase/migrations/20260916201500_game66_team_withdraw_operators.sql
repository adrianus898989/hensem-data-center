-- Expose GAME66 withdrawal daily and operator aggregates under their real
-- Hong Kong / Red Crab data-scope groups.  The previous live function labeled
-- every GAME66 row as India, so correctly scoped team users received zero
-- rows even though the normalized orders were present.

create index if not exists game66_withdraw_orders_dashboard_cover_idx
  on public.game66_withdraw_orders (create_time, platform_id)
  include (
    status_code,
    auto_commit,
    audit_admin,
    lock_admin,
    lock_user_admin,
    update_time,
    submit_time,
    last_seen_at
  );

create or replace function public.dashboard_game66_withdraw_daily(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_operator_rows jsonb := '[]'::jsonb;
  v_latest timestamptz;
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  if public.dashboard_has_permission('auto_withdraw') is not true then
    raise exception using errcode = '42501', message = 'DASHBOARD_PERMISSION_DENIED';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 366 then
    raise exception using errcode = '22023', message = 'GAME66_INVALID_DATE_RANGE';
  end if;

  v_scope := private.dashboard_current_data_scope();
  v_start_at := p_start::timestamp at time zone 'Asia/Kolkata';
  v_end_at := (p_end + 1)::timestamp at time zone 'Asia/Kolkata';

  with scoped as (
    select
      w.*,
      case p.team_code
        when 'hong_kong' then 'HK_TEAM'
        when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code)
      end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform
    from public.game66_withdraw_orders w
    join public.game66_platforms p on p.id = w.platform_id
    where w.create_time >= v_start_at
      and w.create_time < v_end_at
      and private.dashboard_scope_allows(
        v_scope,
        case p.team_code
          when 'hong_kong' then 'HK_TEAM'
          when 'red_crab' then 'RED_CRAB'
          else upper(p.team_code)
        end,
        p.platform_name
      )
  ), daily_grouped as (
    select
      (create_time at time zone 'Asia/Kolkata')::date as data_date,
      country_code,
      country,
      platform,
      count(*)::bigint as total,
      count(*) filter (where status_code in ('1', '3'))::bigint as success,
      count(*) filter (where status_code = '-1')::bigint as rejected,
      count(*) filter (where auto_commit = '2')::bigint as auto_count,
      count(*) filter (where auto_commit is distinct from '2')::bigint as manual_count,
      count(*) filter (where status_code = '1')::bigint as submitted_count,
      count(*) filter (where status_code = '3')::bigint as paid_count,
      count(*) filter (where status_code = '2')::bigint as payout_failed_count,
      coalesce(avg(pg_catalog.greatest(0, extract(epoch from (
        coalesce(update_time, submit_time, last_seen_at, create_time) - create_time
      )))) filter (where create_time is not null), 0)::numeric as avg_seconds,
      max(coalesce(last_seen_at, update_time, submit_time, create_time)) as updated_at
    from scoped
    group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66', data_date::text, country_code, platform)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'total', total,
      'success', success,
      'rejected', rejected,
      'auto_count', auto_count,
      'manual_count', manual_count,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object(
        'submitted_count', submitted_count,
        'paid_count', paid_count,
        'payout_failed_count', payout_failed_count,
        'success_status_codes', jsonb_build_array('1', '3'),
        'reject_status_code', '-1'
      ),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform), '[]'::jsonb),
    max(updated_at)
  into v_rows, v_latest
  from daily_grouped;

  with scoped as (
    select
      w.*,
      case p.team_code
        when 'hong_kong' then 'HK_TEAM'
        when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code)
      end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform
    from public.game66_withdraw_orders w
    join public.game66_platforms p on p.id = w.platform_id
    where w.create_time >= v_start_at
      and w.create_time < v_end_at
      and private.dashboard_scope_allows(
        v_scope,
        case p.team_code
          when 'hong_kong' then 'HK_TEAM'
          when 'red_crab' then 'RED_CRAB'
          else upper(p.team_code)
        end,
        p.platform_name
      )
  ), operator_grouped as (
    select
      (create_time at time zone 'Asia/Kolkata')::date as data_date,
      country_code,
      country,
      platform,
      case
        when auto_commit = '2' then '自动审核'
        else coalesce(
          nullif(pg_catalog.btrim(audit_admin), ''),
          nullif(pg_catalog.btrim(lock_admin), ''),
          nullif(pg_catalog.btrim(lock_user_admin), ''),
          '人工审核（未标记账号）'
        )
      end as account,
      count(*)::bigint as processed,
      count(*) filter (where status_code = '-1')::bigint as rejected,
      coalesce(avg(pg_catalog.greatest(0, extract(epoch from (
        coalesce(update_time, submit_time, last_seen_at, create_time) - create_time
      )))) filter (where create_time is not null), 0)::numeric as avg_seconds,
      max(coalesce(last_seen_at, update_time, submit_time, create_time)) as updated_at
    from scoped
    group by 1, 2, 3, 4, 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66-operator', data_date::text, country_code, platform, account)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'account', account,
      'processed', processed,
      'rejected', rejected,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object('operator_source', case when account = '自动审核' then 'auto_commit' else 'audit_admin' end),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform, account), '[]'::jsonb),
    pg_catalog.greatest(v_latest, max(updated_at))
  into v_operator_rows, v_latest
  from operator_grouped;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'operatorRows', v_operator_rows,
    'latestWriteAt', v_latest
  );
end;
$$;

revoke all on function public.dashboard_game66_withdraw_daily(date,date) from public, anon;
grant execute on function public.dashboard_game66_withdraw_daily(date,date) to authenticated, service_role;
