-- Add the two hourly matrices to the existing authorized per-platform drilldown.
-- Catalog, native date bounds, currency normalization and result policies stay in
-- the original function. This path does not read or republish prepared artifacts.
set local lock_timeout = '2s';

do $install$
declare
  target regprocedure := 'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
  previous constant text := 'bf64643fc384bd0679c29e6b69601599';
  expected constant text := '120a5932b5302ff9fab97d5440023672';
  definition text := pg_get_functiondef(target);
  fingerprint text;
  old text;
  addition text;
begin
  select md5(prosrc) into fingerprint from pg_proc where oid = target;
  if fingerprint = expected then return; end if;
  if fingerprint <> previous then raise exception 'provider_hour_drilldown_baseline_changed'; end if;

  old := '''amountMaxExclusive'',''hourRange'',''amountBands''';
  definition := replace(definition, old, '''amountMaxExclusive'',''hourRange'',''providerHourMatrix'',''amountBands''');

  old := '  if p_request?''amountMaxExclusive'' then';
  addition := $validation$  if p_request ? 'providerHourMatrix' then
    if p_request->'providerHourMatrix' is distinct from 'true'::jsonb or v_kind <> 'custom'
       or v_hour_range is distinct from '{"minHour":0,"maxHour":24}'::jsonb then
      raise exception using errcode='22023', message='invalid_provider_hour_matrix';
    end if;
    -- The catalog already validated the signed assigned-role context. Restrict
    -- this extra grouping to the same two analysis pages when that context exists.
    if nullif(current_setting('hensem.dashboard_role_context',true),'') is not null
       and coalesce(nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb#>>'{payload,page}','') not in ('time','amount') then
      raise exception using errcode='42501', message='page_action_denied';
    end if;
  end if;
$validation$;
  definition := replace(definition, old, addition || old);

  old := $anchor$  else
    v_sql:=v_prefix||$q$, segment as ($anchor$;
  addition := $matrix$  elsif p_request ? 'providerHourMatrix' then
    -- Reuse the authorized, filtered native source exactly once. Inlining the
    -- single-use filtered projection lets PostgreSQL discard unused buckets
    -- and latency fields. Keep the upstream native source materialization.
    v_sql := replace(v_prefix,'filtered as materialized (','filtered as (') || $q$,
    raw_hours as materialized (
      select f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid,
             count(*) as n
      from filtered f cross join lateral (
        select f.local_hour as hour,true as created,
               coalesce(f.success_in_range and f.success_local_hour = f.local_hour,false) as paid
        where f.created_in_range
        union all
        select f.success_local_hour,false,true
        where f.success_in_range and (f.created_in_range and f.success_local_hour = f.local_hour) is not true
      ) e
      group by f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid
    ), names as materialized (
      select raw_provider, private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from raw_hours) unique_names
    ), events as (
      select h.direction,h.currency,names.provider,h.hour,h.n,
             h.created,h.paid,h.created and h.status_group='success' as created_success
      from raw_hours h join names on names.raw_provider=h.provider
    ), metrics as (
      select direction,currency,provider,hour,grouping(provider,hour) as level,
             coalesce(sum(n) filter (where created),0)::bigint as all_count,
             coalesce(sum(n) filter (where created_success),0)::bigint as created_success_count,
             coalesce(sum(n) filter (where paid),0)::bigint as success_count
      from events
      group by direction,currency,grouping sets ((provider,hour),(provider),(hour),())
    ), output as (
      select direction,currency,provider,hour,level,to_jsonb(m)-'level' as value from metrics m
    )
    select jsonb_build_object('providerHourMatrix',true,
      'summary',coalesce(jsonb_agg(value-array['provider','hour'] order by direction,currency) filter (where level=3),'[]'::jsonb),
      'groups',jsonb_build_object(
        'provider',coalesce(jsonb_agg(value-'hour' order by provider,direction,currency) filter (where level=1),'[]'::jsonb),
        'hourly',coalesce(jsonb_agg(value-'provider' order by hour,direction,currency) filter (where level=2),'[]'::jsonb),
        'provider_hour',coalesce(jsonb_agg(value order by provider,hour,direction,currency) filter (where level=0),'[]'::jsonb)
      ),'rows','[]'::jsonb) from output
    $q$;
$matrix$;
  definition := replace(definition, old, addition || old);
  -- Run the native hooks before minimizing the two displayed grids: e.g. WG and
  -- PANDA can mask event-clock counts, even when a native row exists.
  old := '  return v_result||case when v_duration_version=2 then';
  addition := $compact$  if p_request ? 'providerHourMatrix' and v_platform.source in ('wg','panda','duoli') then
    foreach v_key in array array['provider_hour','hourly'] loop
      v_result := jsonb_set(v_result,array['groups',v_key],
        (select coalesce(jsonb_agg(fields order by pos),'[]'::jsonb)
         from jsonb_array_elements(v_result#>array['groups',v_key]) with ordinality rows(r,pos)
         cross join lateral (select jsonb_object_agg(key,value) as fields from jsonb_each(r)
                            where key in ('provider','hour','currency','direction','all_count','created_success_count','success_count')) projection));
    end loop;
  end if;
$compact$;
  definition := replace(definition, old, addition || old);

  execute definition;
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from expected then
    raise exception 'provider_hour_drilldown_installation_incomplete';
  end if;
end
$install$;
