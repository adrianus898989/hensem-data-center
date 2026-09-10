-- Server-owned, read-time grouping. Collector snapshots and receipt hashes stay immutable.
-- New uploads and historical rows use the same version without a Python replacement/backfill.
create function public.withdraw_reason_category(p_label text, p_classification text)
returns jsonb language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  label text := pg_catalog.btrim(p_label);
  compact text;
  parts text[];
  category text;
  stamp text := '(?:[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:AM|PM)|\{日期时间\}|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T?[0-9]{2}:[0-9]{2}:[0-9]{2})?)';
begin
  -- A truncated text must never become a confidently classified cause.
  if p_classification in ('empty', 'truncated') then
    return pg_catalog.jsonb_build_object('label', label, 'classification', p_classification);
  end if;
  if pg_catalog.length(label) > 400 then raise exception 'WR_CATEGORY_LABEL_TOO_LONG'; end if;
  compact := pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.replace(label, '：', ':'), '，', ','), '[[:space:]]', '', 'g');

  -- Observed per-customer values are measurements, not configured rule thresholds.
  if compact ~ '^会员在限制的游戏类型中总的投注数:[0-9]+(?:\.[0-9]+)?$' then
    category := '受限游戏类型投注';
  elsif compact ~ '^累计提款次数不能小于[0-9]+次,当前累计提现次数:[0-9]+次$' then
    parts := pg_catalog.regexp_match(compact, '^(累计提款次数不能小于[0-9]+次),当前累计提现次数:[0-9]+次$');
    category := parts[1];
  else
    parts := pg_catalog.regexp_match(compact,
      '^最后充值日限额超过当前配置的最后充值日限制:([0-9]+)天,最后充值时间:' || stamp || ',当前时间:' || stamp || ',间隔:[0-9]+天$');
    if parts is not null then category := '最后充值日超过限制（' || parts[1] || '天）'; end if;
  end if;

  -- Recognize fixed source rules as complete categories; all threshold/code/negation
  -- numbers remain part of their identities. Exact anchoring prevents swallowing a
  -- second cause or an appended error code. Unknown text remains its own full group.
  if category is null and (
    compact ~ '^同设备数大于[0-9]+$'
    or compact ~ '^当日出款笔数已达上限[0-9]+笔$'
    or compact ~ '^无充值连续提款大于[0-9]+次$'
    or compact ~ '^总提现/总充值大于[0-9]+(?:\.[0-9]+)?$'
    or compact in ('自动出款失败:未匹配到合适的出款通道', '提款金额大于自动出款金额', '会员备注不为空,请检查备注', '非法定货币不能自动出款')
  ) then category := compact; end if;

  return pg_catalog.jsonb_build_object('label', coalesce(category, label),
    'classification', case when category is not null then 'template' else p_classification end);
end;
$$;
revoke all on function public.withdraw_reason_category(text, text) from public, anon, authenticated;
grant execute on function public.withdraw_reason_category(text, text) to authenticated, service_role;

create function public.withdraw_reasons_group_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql immutable strict security invoker set search_path = '' as $$
declare result jsonb;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 2097152
    or pg_catalog.jsonb_typeof(p_snapshot->'groups') is distinct from 'array' then
    raise exception 'WR_INVALID_GROUPING_INPUT';
  end if;
  if pg_catalog.jsonb_array_length(p_snapshot->'groups') > 5000 then raise exception 'WR_INVALID_GROUPING_INPUT'; end if;
  with source as materialized (
    select g, public.withdraw_reason_category(g->>'reason_label', g->>'classification') as category
    from pg_catalog.jsonb_array_elements(p_snapshot->'groups') g
  ), grouped as (
    select g->>'operator_class' as operator_class, category->>'label' as label, category->>'classification' as classification,
      sum((g->>'count')::bigint) as count, sum((g->>'success')::bigint) as success,
      sum((g->>'reject')::bigint) as reject, sum((g->>'other')::bigint) as other,
      pg_catalog.jsonb_agg(g) as originals
    from source group by g->>'operator_class', category->>'label', category->>'classification'
  ), rendered as (
    select operator_class, label, count, pg_catalog.jsonb_build_object(
      'operator_class', operator_class, 'reason_label', label, 'classification', classification,
      'reason_key', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('reason-category-v1' || chr(31) || classification || chr(31) || label, 'UTF8')), 'hex'),
      'count', count, 'success', success, 'reject', reject, 'other', other,
      'variants', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reason_label', v.label, 'count', v.count) order by v.count desc, v.label)
        from (select raw->>'reason_label' as label, sum((raw->>'count')::bigint) as count
          from pg_catalog.jsonb_array_elements(originals) raw group by raw->>'reason_label') v),
      'samples', (select coalesce(pg_catalog.jsonb_agg(sample order by sample), '[]'::jsonb)
        from (select distinct sample from pg_catalog.jsonb_array_elements(originals) raw
          cross join lateral pg_catalog.jsonb_array_elements_text(raw->'samples') sample order by sample limit 3) s)
    ) as value from grouped
  )
  select pg_catalog.jsonb_set(p_snapshot, '{groups}', coalesce(pg_catalog.jsonb_agg(value order by operator_class, count desc, label), '[]'::jsonb)) into result
  from rendered;
  return result;
end;
$$;
revoke all on function public.withdraw_reasons_group_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.withdraw_reasons_group_snapshot(jsonb) to authenticated, service_role;

create view public.withdraw_reasons_daily_grouped with (security_invoker = true) as
select source_system, country_code, platform, stat_date, snapshot_id, snapshot_at, updated_at,
  'reason-category-v1'::text as grouping_version,
  public.withdraw_reasons_group_snapshot(snapshot) as snapshot
from public.withdraw_reasons_daily;
revoke all on public.withdraw_reasons_daily_grouped from public, anon, authenticated;
grant select on public.withdraw_reasons_daily_grouped to authenticated, service_role;
comment on view public.withdraw_reasons_daily_grouped is 'Read-only reason categories; base-table RLS applies. Original collector data and receipt digests are never rewritten.';

-- The existing Python report command also reads the same grouping layer. All
-- credential checks, exact scopes, date bounds and service-only grants are retained.
create or replace function public.report_withdraw_reasons_snapshots(p_token_hash text, p_start date, p_end date, p_platforms text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_credential public.withdraw_reasons_credentials%rowtype;
  v_snapshots jsonb;
begin
  select * into v_credential from public.withdraw_reasons_credentials where token_hash = p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'WR_AUTH_INVALID';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 30
    or p_platforms is null or pg_catalog.cardinality(p_platforms) > 1000
    or exists (select 1 from pg_catalog.unnest(p_platforms) name where name is null or pg_catalog.length(name) not between 1 and 80 or name <> pg_catalog.btrim(name))
    or pg_catalog.cardinality(p_platforms) <> (select count(distinct name) from pg_catalog.unnest(p_platforms) name) then
    raise exception using errcode = '22023', message = 'WR_INVALID_REPORT';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_platforms) name where not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_credential.allowed_scopes) scope where scope->>'platform' = name
  )) then
    raise exception using errcode = '42501', message = 'WR_SCOPE_DENIED';
  end if;
  select coalesce(pg_catalog.jsonb_agg(day.snapshot order by day.stat_date, day.country_code, day.platform), '[]'::jsonb) into v_snapshots
    from public.withdraw_reasons_daily_grouped day
    where day.source_system = v_credential.source_system and day.stat_date between p_start and p_end
      and (pg_catalog.cardinality(p_platforms) = 0 or day.platform = any(p_platforms))
      and v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('country_code', day.country_code, 'platform', day.platform));
  return pg_catalog.jsonb_build_object('ok', true, 'snapshots', v_snapshots, 'grouping_version', 'reason-category-v1');
end;
$$;
revoke all on function public.report_withdraw_reasons_snapshots(text, date, date, text[]) from public, anon, authenticated;
grant execute on function public.report_withdraw_reasons_snapshots(text, date, date, text[]) to service_role;
