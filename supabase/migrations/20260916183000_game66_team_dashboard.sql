-- Group the 66-game registry by its operational teams and expose only
-- permission-checked aggregate/status data to the dashboard. Source order
-- rows and connection secrets remain service-role only.
begin;

create or replace function private.dashboard_data_scope_valid(p_scope jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_scope is null or jsonb_typeof(p_scope) is distinct from 'object'
     or jsonb_typeof(p_scope->'countries') is distinct from 'array' then return false; end if;
  if p_scope->>'mode' = 'all' then return jsonb_array_length(p_scope->'countries') = 0; end if;
  if p_scope->>'mode' is distinct from 'selected'
     or jsonb_array_length(p_scope->'countries') = 0 then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(p_scope->'countries') as entry(value)
    where jsonb_typeof(value) is distinct from 'string'
       or (value #>> '{}') <> all (array[
         'BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT',
         'HK_TEAM','RED_CRAB'
       ]::text[])
  );
end;
$$;

create or replace function private.dashboard_data_group(p_country text, p_platform text default '')
returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_trim text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_country text := upper(btrim(regexp_replace(btrim(coalesce(p_country,''),v_trim), '盘口$', ''),v_trim));
  v_platform text := upper(btrim(coalesce(p_platform,''),v_trim));
  v_group text;
begin
  v_group := case
    when v_country = any(array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT','HK_TEAM','RED_CRAB']) then v_country
    when v_country = any(array['香港','HONG KONG','HONG_KONG']) then 'HK_TEAM'
    when v_country = any(array['红膏蟹','紅膏蟹','RED CRAB']) then 'RED_CRAB'
    when v_country = any(array['巴西','BRAZIL']) then 'BR'
    when v_country = any(array['胖虎巴西','PANGHU BRAZIL']) then 'BR_PANGHU'
    when v_country = any(array['印度','印度线下','INDIA']) then 'IN'
    when v_country = any(array['巴基斯坦','PAKISTAN']) then 'PK'
    when v_country = any(array['印尼','印度尼西亚','INDONESIA']) then 'ID'
    when v_country = any(array['越南','VIETNAM']) then 'VN'
    when v_country = any(array['菲律宾','PHILIPPINES']) then 'PH'
    when v_country = any(array['马来','马来西亚','MALAYSIA']) then 'MY'
    when v_country = any(array['缅甸','MYANMAR']) then 'MM'
    when v_country = any(array['尼日利亚','NIGERIA']) then 'NG'
    when v_country = any(array['哥伦比亚','COLOMBIA']) then 'CO'
    when v_country = any(array['墨西哥','MEXICO']) then 'MX'
    when v_country = any(array['智利','CHILE']) then 'CL'
    when v_country = any(array['南美','SOUTH AMERICA']) then 'SA'
    when v_country = '巴西原生' then 'BR_NATIVE'
    when v_country = any(array['USDT通道','USDT 通道']) then 'USDT'
    else '' end;
  if v_group = 'SA' then
    v_group := case v_platform when 'NPG-CHILE' then 'CL' when 'NPG-COLOMBIA' then 'CO'
      when 'NPG-MEXICO' then 'MX' else v_group end;
  end if;
  if v_group in ('BR','BR_PANGHU') then
    v_platform := case v_platform when 'FF55' then 'FF555' when '222VIP.COM' then '222VIP'
      when '222-VIP' then '222VIP' when '67-VIP' then '67VIP' else v_platform end;
    if v_platform = any(array[
      'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR','8599BET','9596BET','8566BET',
      '5V555','58EE','27FF','222O','32QQ','67VIP','222VIP','345F','234T','888HH','BET5697',
      '96F','45FF','76PP','56L','559K','2V222','776F','5C555'
    ]) then return 'BR_PANGHU'; end if;
    if v_platform = any(array['POPNOV','POPFEZ','POPCRA']) then return 'BR'; end if;
  end if;
  return v_group;
end;
$$;

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

  with grouped as (
    select
      (c.create_time at time zone 'Asia/Kolkata')::date as data_date,
      case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end as country_code,
      coalesce(nullif(pg_catalog.btrim(g.team_name), ''), nullif(pg_catalog.btrim(g.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(g.platform_name), ''), nullif(pg_catalog.btrim(g.platform_code), ''), '未标记平台') as platform,
      coalesce(nullif(pg_catalog.btrim(c.pay_method_name), ''), nullif(pg_catalog.btrim(c.pay_method_code), ''), nullif(pg_catalog.btrim(c.channel), ''), '未标记三方') as channel,
      coalesce(nullif(pg_catalog.btrim(c.pay_mode), ''), '其他类型') as channel_type,
      '代收'::text as direction,
      sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) as amount,
      count(*)::bigint as order_count,
      count(*) filter (where c.status_code = '1')::bigint as success_count,
      count(*) filter (where c.status_code is distinct from '1')::bigint as failed_count,
      max(c.last_seen_at) as updated_at,
      bool_or(coalesce(g.enabled, false)) as platform_enabled,
      sum(coalesce(nullif(c.amount_display, 0), c.amount_minor / 100.0, 0)) filter (where c.status_code = '1') as success_amount
    from public.game66_charge_orders c
    join public.game66_platforms g on g.id = c.platform_id
    where (c.create_time at time zone 'Asia/Kolkata')::date between p_start and p_end
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', data_date::text, country, platform, channel, channel_type, direction)),
      'sheet_name', 'game66_charge_orders', 'source_row', 0, 'data_date', data_date,
      'country', country, 'country_code', country_code, 'platform', platform,
      'channel', channel, 'raw_channel', channel, 'channel_type', channel_type,
      'direction', direction, 'amount', amount, 'count', order_count,
      'success_count', success_count, 'failed_count', failed_count,
      'success_rate', case when order_count > 0 then success_count::numeric / order_count else 0 end,
      'status', case when platform_enabled then '66GAME 原始订单' else '66GAME 原始订单（同步未启用）' end,
      'raw', jsonb_build_object('source_team', country, 'paid_amount', success_amount, 'platform_enabled', platform_enabled),
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
      coalesce(avg(pg_catalog.greatest(0, extract(epoch from (coalesce(w.update_time, w.submit_time, w.last_seen_at, w.create_time) - w.create_time)))) filter (where w.create_time is not null), 0)::numeric as avg_seconds,
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

create or replace function public.dashboard_game66_platform_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null and current_user not in ('service_role', 'postgres') then
    raise exception using errcode = '28000', message = 'GAME66_AUTH_REQUIRED';
  end if;
  if (select auth.uid()) is not null and not public.dashboard_has_permission('auto_withdraw') then
    raise exception using errcode = '42501', message = 'GAME66_PERMISSION_DENIED';
  end if;

  with charge as (
    select platform_id, count(*)::bigint as row_count, max(last_seen_at) as latest_at
    from public.game66_charge_orders group by platform_id
  ), withdrawal as (
    select platform_id, count(*)::bigint as row_count, max(last_seen_at) as latest_at
    from public.game66_withdraw_orders group by platform_id
  ), dictionaries as (
    select platform_id, max(fetched_at) as latest_at from public.game66_dictionary_snapshots group by platform_id
  ), syncs as (
    select distinct on (platform_id) platform_id, status, finished_at, error_count
    from public.game66_sync_runs order by platform_id, started_at desc
  ), safe_rows as (
    select
      g.team_code, g.team_name, g.platform_name, g.enabled,
      (coalesce(pg_catalog.length(pg_catalog.btrim(g.base_url)), 0) > 0) as has_base_url,
      (coalesce(pg_catalog.length(pg_catalog.btrim(g.auth_secret_name)), 0) > 0) as has_auth_secret,
      (jsonb_typeof(g.request_config) = 'object' and g.request_config <> '{}'::jsonb) as request_configured,
      coalesce(c.row_count, 0) as charge_rows, coalesce(w.row_count, 0) as withdraw_rows,
      c.latest_at as latest_charge_at, w.latest_at as latest_withdraw_at,
      d.latest_at as latest_dictionary_at, s.status as latest_sync_status,
      s.finished_at as latest_sync_at, coalesce(s.error_count, 0) as latest_sync_error_count
    from public.game66_platforms g
    left join charge c on c.platform_id = g.id
    left join withdrawal w on w.platform_id = g.id
    left join dictionaries d on d.platform_id = g.id
    left join syncs s on s.platform_id = g.id
    where g.team_code in ('hong_kong','red_crab')
      and private.dashboard_scope_allows(
        private.dashboard_current_data_scope(),
        case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
        g.platform_name
      )
  )
  select coalesce(jsonb_agg(to_jsonb(safe_rows) order by team_code, platform_name), '[]'::jsonb)
  into v_rows from safe_rows;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;
revoke all on function public.dashboard_game66_platform_status() from public, anon;
grant execute on function public.dashboard_game66_platform_status() to authenticated, service_role;

commit;
