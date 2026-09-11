-- PANDA read-time categorization. Original snapshots, totals and receipts stay intact.
-- The existing two-argument AR/NEWAR/BAIFU classifier is not changed.
create or replace function public.withdraw_reason_category(
  p_source_system text, p_label text, p_classification text
)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  original jsonb := public.withdraw_reason_category(p_label, p_classification);
  compact text;
  clean text;
  fragment text;
  kept text[] := array[]::text[];
  payout_tail boolean := false;
  notice text;
  category text;
  notices text[] := array[
    '(?:Olá|OlÃ¡),comoosdadosdoseuPIXestãoerrados,entreemcontatocomoatendimentoonlineparaverificaraalteração,obrigado[.。]?',
    '(?:Olá|OlÃ¡),foiverificadoquevocêviolouasregrasdojogo,entreemcontatocomoatendimentoaoclienteonlineparaconsulta,obrigado[.。]?',
    '(?:Olá|OlÃ¡),osistemadetectouquesuacontaacionoualgumaatividadeanormalepoderáaplicarautomaticamenteumaprorrogaçãocomomedida(?:preventiva|preventive)[.。]?',
    '(?:Olá|OlÃ¡),entreemcontatocomoatendimentoaoclienteonlineparaconsulta,obrigado[.。]?',
    'Vocênãorecarregahámuitotempo,entreemcontatocomoatendimentoaocliente\.Parasabermaissobreoprocessodesaque\.Obrigado[.。]?',
    'Withdrawalrejectedduesystemdetectedyouraccountdoingillegalbets,pleasecontactcustomerservicetogetassistant\.Thankyou[.。]?'
  ];
begin
  if p_source_system is distinct from 'PANDA' or p_label is null
    or p_classification is null or p_classification in ('empty', 'truncated') then
    return original;
  end if;
  compact := pg_catalog.regexp_replace(pg_catalog.translate(p_label, '：，；（）', ':,;()'), '[[:space:]]', '', 'g');
  clean := pg_catalog.rtrim(compact, '。.;,');
  if clean !~ '^免审(?:未通过|条件不过)[:,]' then return original; end if;

  -- Remove only observed complete customer-notification sentences, not arbitrary
  -- Portuguese/English, numbers, configured thresholds, or another rejection event.
  foreach notice in array notices loop
    clean := pg_catalog.regexp_replace(clean, notice, '', 'gi');
  end loop;
  clean := pg_catalog.rtrim(clean, '。.;,');

  -- Payout metadata is not the preceding exemption rule. Remove exact fields,
  -- not an arbitrary suffix; unknown fragments and extra conditions survive.
  clean := pg_catalog.regexp_replace(clean, '([^,;])(渠道名字:)', '\1,\2', 'g');
  foreach fragment in array pg_catalog.regexp_split_to_array(clean, '[,;]+') loop
    if fragment = '' then continue; end if;
    if pg_catalog.cardinality(kept) > 0 and (
      fragment ~ '^渠道名字:[A-Za-z0-9_.-]+(?:代付)?$'
      or fragment ~ '^渠道:[A-Za-z0-9_.-]+(?:代付)?\[代付(?:成功|失败)\]$'
      or fragment ~* '^失败信息:(?:代付提交失败:cnpjisdisabled|missingparameter:accountType|(?:\[(?:TX)?(?:[0-9]+|\{[^{}\[\]]{1,32}\}|MASKED)\][-—–]?){0,2}P[Il]Xerror)$'
    ) then
      payout_tail := true;
      continue;
    end if;
    if payout_tail and fragment in ('操作人不是系统', '自动代付中断') then continue; end if;
    kept := pg_catalog.array_append(kept, fragment);
  end loop;
  clean := pg_catalog.array_to_string(kept, ',');

  if clean in (
    '免审未通过:用户领取助力领现金或者代理宝箱活动奖励(多次)',
    '免审条件不过:用户领取助力领现金或者代理宝箱活动奖励(多次)',
    '免审条件不过,用户领取助力领现金或者代理宝箱活动奖励(多次)',
    '免审未通过:领取助力现金或代理宝箱奖励(多次)'
  ) then
    category := '免审未通过：领取助力现金或代理宝箱奖励（多次）';
  elsif clean = '免审未通过:首次提现流水未达要求' or clean ~
    '^(?:免审未通过:|免审条件不过[:,])用户不满足第一次提现流水要求:isFirstWithdrawal:true,userFlow:(?:0|[1-9][0-9]*)(?:\.[0-9]+)?,historicalValidBetting:(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$'
  then
    category := '免审未通过：首次提现流水未达要求';
  end if;

  -- Unknown fields, another rule, false/unknown first-withdrawal flags and
  -- explicit thresholds do not match. Their existing full grouping is preserved.
  if category is null then return original; end if;
  return pg_catalog.jsonb_build_object('label', category, 'classification', 'template');
end;
$$;
revoke all on function public.withdraw_reason_category(text, text, text) from public, anon, authenticated;
grant execute on function public.withdraw_reason_category(text, text, text) to authenticated, service_role;

create or replace function public.withdraw_reasons_group_snapshot(p_snapshot jsonb)
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
    select g, public.withdraw_reason_category(p_snapshot->>'source_system', g->>'reason_label', g->>'classification') as category
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
