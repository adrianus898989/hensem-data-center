-- Applied to the existing reader; preserves its permission gate, ACL and result schema.
-- The live table was vacuumed/analyzed before validating the 8-second reader deadline.
CREATE OR REPLACE FUNCTION public.dashboard_game66_withdraw_daily(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_operator_rows jsonb := '[]'::jsonb;
  v_latest timestamptz;
  v_operator_latest timestamptz;
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

  -- Scan the time range once. Aggregate narrow platform IDs before joining
  -- display labels, so neither two full scans nor text-heavy sorts dominate.
  with source_stats as materialized (
    select w.platform_id,
      (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case when w.auto_commit = '2' then '自动审核'
        else coalesce(nullif(pg_catalog.btrim(w.audit_admin), ''),
          nullif(pg_catalog.btrim(w.lock_admin), ''),
          nullif(pg_catalog.btrim(w.lock_user_admin), ''), '人工审核（未标记账号）') end as account,
      count(*)::bigint as total,
      count(*) filter (where w.status_code in ('1','3'))::bigint as success,
      count(*) filter (where w.status_code = '-1')::bigint as rejected,
      count(*) filter (where w.auto_commit = '2')::bigint as auto_count,
      count(*) filter (where w.auto_commit is distinct from '2')::bigint as manual_count,
      count(*) filter (where w.status_code = '1')::bigint as submitted_count,
      count(*) filter (where w.status_code = '3')::bigint as paid_count,
      count(*) filter (where w.status_code = '2')::bigint as payout_failed_count,
      sum(greatest(0::numeric, extract(epoch from (
        coalesce(w.update_time,w.submit_time,w.last_seen_at,w.create_time) - w.create_time
      )))) as handle_seconds,
      count(*)::bigint as handle_count,
      max(coalesce(w.last_seen_at,w.update_time,w.submit_time,w.create_time)) as updated_at
    from public.game66_withdraw_orders w
    where w.create_time >= v_start_at and w.create_time < v_end_at
    group by 1,2,3
  ), allowed_platforms as materialized (
    select p.id,
      case p.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform
    from public.game66_platforms p
    where private.dashboard_scope_allows(v_scope,
      case p.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code) end, p.platform_name)
  ), operator_stats as materialized (
    -- Preserve merging when multiple platform IDs share the same display name.
    select s.data_date,p.country_code,p.country,p.platform,s.account,
      sum(s.total)::bigint as total, sum(s.success)::bigint as success,
      sum(s.rejected)::bigint as rejected, sum(s.auto_count)::bigint as auto_count,
      sum(s.manual_count)::bigint as manual_count,
      sum(s.submitted_count)::bigint as submitted_count,
      sum(s.paid_count)::bigint as paid_count,
      sum(s.payout_failed_count)::bigint as payout_failed_count,
      sum(s.handle_seconds) as handle_seconds, sum(s.handle_count) as handle_count,
      max(s.updated_at) as updated_at
    from source_stats s join allowed_platforms p on p.id=s.platform_id
    group by 1,2,3,4,5
  ), daily_grouped as (
    select data_date,country_code,country,platform,
      sum(total)::bigint as total, sum(success)::bigint as success,
      sum(rejected)::bigint as rejected, sum(auto_count)::bigint as auto_count,
      sum(manual_count)::bigint as manual_count,
      sum(submitted_count)::bigint as submitted_count, sum(paid_count)::bigint as paid_count,
      sum(payout_failed_count)::bigint as payout_failed_count,
      coalesce(sum(handle_seconds)/nullif(sum(handle_count),0),0)::numeric as avg_seconds,
      max(updated_at) as updated_at
    from operator_stats group by 1,2,3,4
  ), operator_grouped as (
    select data_date,country_code,country,platform,account,total as processed,rejected,
      coalesce(handle_seconds/nullif(handle_count,0),0)::numeric as avg_seconds,updated_at
    from operator_stats
  ), daily_result(rows,latest) as (
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
  from daily_grouped
  ), operator_result(rows,latest) as (
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
    max(updated_at)
  from operator_grouped
  )
  select d.rows,o.rows,greatest(d.latest,o.latest)
    into v_rows,v_operator_rows,v_latest
  from daily_result d cross join operator_result o;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'operatorRows', v_operator_rows,
    'latestWriteAt', v_latest
  );
end;
$function$;

ALTER TABLE public.game66_withdraw_orders SET (
 autovacuum_vacuum_scale_factor=0.01, autovacuum_vacuum_threshold=1000,
 autovacuum_analyze_scale_factor=0.02, autovacuum_analyze_threshold=1000
);

