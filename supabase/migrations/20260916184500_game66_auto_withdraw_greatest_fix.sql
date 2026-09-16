-- GREATEST is SQL conditional syntax, not a schema-qualified function.
create or replace function public.dashboard_game66_auto_withdraw(p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_latest timestamptz;
begin
  if (select auth.uid()) is null and current_user not in ('service_role', 'postgres') then
    raise exception using errcode = '28000', message = 'GAME66_AUTH_REQUIRED';
  end if;
  if (select auth.uid()) is not null and not public.dashboard_has_permission('auto_withdraw') then
    raise exception using errcode = '42501', message = 'GAME66_PERMISSION_DENIED';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 731 then
    raise exception using errcode = '22023', message = 'GAME66_INVALID_RANGE';
  end if;

  with grouped as (
    select
      (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      count(*)::bigint as total,
      count(*) filter (where w.status_code = '3')::bigint as success,
      count(*) filter (where w.status_code = '-1')::bigint as rejected,
      count(*) filter (where w.auto_commit = '2')::bigint as auto_count,
      count(*) filter (where w.auto_commit in ('0','-1'))::bigint as manual_count,
      coalesce(avg(greatest(0::numeric, extract(epoch from (coalesce(w.update_time, w.submit_time, w.last_seen_at, w.create_time) - w.create_time)))) filter (where w.create_time is not null), 0)::numeric as avg_seconds,
      max(coalesce(w.last_seen_at, w.update_time, w.create_time)) as updated_at
    from public.game66_withdraw_orders w
    join public.game66_platforms g on g.id = w.platform_id
    where w.create_time is not null
      and (w.create_time at time zone 'Asia/Kolkata')::date between p_start and p_end
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
    group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'data_date', data_date, 'country_code', country_code, 'country', country,
      'platform', platform, 'total', total, 'success', success, 'rejected', rejected,
      'auto_count', auto_count, 'manual_count', manual_count, 'avg_seconds', avg_seconds,
      'source_sheet', 'game66_withdraw_orders', 'updated_at', updated_at
    ) order by data_date, country, platform), '[]'::jsonb), max(updated_at)
  into v_rows, v_latest from grouped;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'latestWriteAt', v_latest);
end;
$$;
revoke all on function public.dashboard_game66_auto_withdraw(date,date) from public, anon;
grant execute on function public.dashboard_game66_auto_withdraw(date,date) to authenticated, service_role;
