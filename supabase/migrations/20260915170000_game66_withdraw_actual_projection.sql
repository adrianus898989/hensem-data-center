-- Read-only projection for game66 withdrawal orders.
-- The source table contains account/CPF/raw payload fields and remains service_role-only.
-- This projection exposes only grouped amounts to authenticated third-party users.
begin;

create or replace function private.game66_amount(p_display text, p_minor numeric)
returns numeric
language sql immutable security invoker set search_path = '' as $$
  select case
    when nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_display, '')), '[^0-9.-]', '', 'g'), '')
      ~ '^-?[0-9]+(\.[0-9]+)?$'
      then nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_display, '')), '[^0-9.-]', '', 'g'), '')::numeric
    else coalesce(p_minor, 0)
  end;
$$;
revoke all on function private.game66_amount(text, numeric) from public, anon, authenticated;
grant execute on function private.game66_amount(text, numeric) to authenticated, service_role;

create or replace function private.game66_amount(p_display numeric, p_minor numeric)
returns numeric
language sql immutable security invoker set search_path = '' as $$
  select private.game66_amount(p_display::text, p_minor);
$$;
revoke all on function private.game66_amount(numeric, numeric) from public, anon, authenticated;
grant execute on function private.game66_amount(numeric, numeric) to authenticated, service_role;

create or replace function private.dashboard_withdraw_actual(p_start date, p_end date, p_country text default null)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare
  v_rows jsonb;
  v_country text := nullif(pg_catalog.btrim(coalesce(p_country, '')), '');
begin
  if (select auth.uid()) is null and current_user not in ('service_role', 'postgres') then
    raise exception using errcode = '28000', message = 'WA_AUTH_REQUIRED';
  end if;
  if (select auth.uid()) is not null and not public.dashboard_has_permission('third_party') then
    raise exception using errcode = '42501', message = 'WA_PERMISSION_DENIED';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 731
    or (v_country is not null and (pg_catalog.length(v_country) > 80 or v_country ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'WA_INVALID_RANGE';
  end if;

  with source_rows as (
    select
      (coalesce(o.submit_time, o.create_time) at time zone
        case upper(pg_catalog.btrim(coalesce(nullif(o.country, ''), gp.metadata->>'dashboard_country', '')))
          when 'IN' then 'Asia/Kolkata' when 'INDIA' then 'Asia/Kolkata' when '3' then 'Asia/Kolkata' when '印度' then 'Asia/Kolkata'
          when 'PK' then 'Asia/Karachi' when '巴基斯坦' then 'Asia/Karachi'
          when 'BR' then 'America/Sao_Paulo' when '巴西' then 'America/Sao_Paulo'
          when 'ID' then 'Asia/Jakarta' when '印尼' then 'Asia/Jakarta'
          when 'VN' then 'Asia/Ho_Chi_Minh' when '越南' then 'Asia/Ho_Chi_Minh'
          when 'MY' then 'Asia/Kuala_Lumpur' when '马来' then 'Asia/Kuala_Lumpur'
          when 'MM' then 'Asia/Yangon' when '缅甸' then 'Asia/Yangon'
          when 'NG' then 'Africa/Lagos' when '尼日利亚' then 'Africa/Lagos'
          else 'UTC'
        end)::date as stat_date,
      case upper(pg_catalog.btrim(coalesce(nullif(o.country, ''), gp.metadata->>'dashboard_country', '')))
        when 'IN' then 'IN' when 'INDIA' then 'IN' when '3' then 'IN' when '印度' then 'IN'
        when 'PK' then 'PK' when '巴基斯坦' then 'PK'
        when 'BR' then 'BR' when '巴西' then 'BR'
        when 'ID' then 'ID' when '印尼' then 'ID'
        when 'VN' then 'VN' when '越南' then 'VN'
        when 'MY' then 'MY' when '马来' then 'MY'
        when 'MM' then 'MM' when '缅甸' then 'MM'
        when 'NG' then 'NG' when '尼日利亚' then 'NG'
        else upper(left(pg_catalog.btrim(coalesce(nullif(o.country, ''), gp.metadata->>'dashboard_country', '')), 2))
      end as country_code,
      case
        when upper(pg_catalog.btrim(coalesce(nullif(o.country, ''), gp.metadata->>'dashboard_country', ''))) = '3' then '印度'
        else coalesce(nullif(gp.metadata->>'dashboard_country', ''), nullif(o.country, ''), '未标记')
      end as source_country,
      coalesce(nullif(gp.metadata->>'dashboard_platform', ''), nullif(gp.platform_name, ''), nullif(gp.platform_code, ''), '未标记') as platform,
      coalesce(nullif(o.channel, ''), nullif(o.pay_channel, ''), nullif(o.pay_method_name, ''), '未标记') as third_party,
      coalesce(nullif(o.pay_channel, ''), nullif(o.pay_method_name, ''), nullif(o.channel, ''), '未标记') as channel_type,
      private.game66_amount(o.amount_display, o.amount_minor) as requested_amount,
      private.game66_amount(o.real_amount_display, o.real_amount_minor) as actual_amount,
      private.game66_amount(o.fee_display, o.fee_minor) as fee_amount,
      coalesce(o.last_seen_at, o.create_time) as updated_at
    from public.game66_withdraw_orders o
    left join public.game66_platforms gp on gp.id = o.platform_id
    where coalesce(o.submit_time, o.create_time) is not null
  ), grouped as (
    select
      stat_date, country_code, source_country as country, platform, third_party, channel_type,
      count(*)::bigint as order_count,
      coalesce(sum(requested_amount), 0)::numeric as requested_amount,
      coalesce(sum(actual_amount), 0)::numeric as actual_amount,
      coalesce(sum(fee_amount), 0)::numeric as fee_amount,
      max(updated_at) as source_updated_at
    from source_rows
    where stat_date between p_start and p_end
      and (v_country is null or v_country = country_code or v_country = source_country)
      and private.dashboard_scope_allows(private.dashboard_current_data_scope(), country_code, platform)
    group by stat_date, country_code, source_country, platform, third_party, channel_type
  )
  select coalesce(jsonb_agg(to_jsonb(grouped) order by stat_date, country_code, platform, third_party, channel_type), '[]'::jsonb)
    into v_rows
  from grouped;

  return jsonb_build_object('rows', v_rows);
end;
$$;
revoke all on function private.dashboard_withdraw_actual(date, date, text) from public, anon, authenticated;
grant execute on function private.dashboard_withdraw_actual(date, date, text) to authenticated, service_role;

create or replace function public.dashboard_withdraw_actual(p_start date, p_end date, p_country text default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.dashboard_withdraw_actual($1, $2, $3);
$$;
revoke all on function public.dashboard_withdraw_actual(date, date, text) from public, anon;
grant execute on function public.dashboard_withdraw_actual(date, date, text) to authenticated, service_role;

commit;
