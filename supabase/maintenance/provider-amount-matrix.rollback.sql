-- Preserve the native platform, authorization, clock and monetary policies of the existing drilldown.
set local lock_timeout = '2s';
do $install$
declare
  target regprocedure := 'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  fingerprint text;
begin
  select md5(prosrc) into fingerprint from pg_proc where oid=target;
  if fingerprint='92c9cdc9cc04dd7ca9ba2d7fc2f6c156' then return; end if;
  if fingerprint<>'d5c6f989646068bc8ae44e8f9cf7e204' then raise exception 'provider_amount_matrix_baseline_changed'; end if;
  definition:=replace(definition,$old$where key in ('provider','bucket','hour','currency','direction','all_count','created_success_count','success_count')$old$,$new$where key in ('provider','hour','currency','direction','all_count','created_success_count','success_count')$new$);
  definition:=replace(definition,$old$if p_request ?| array['providerHourMatrix','providerAmountMatrix'] and v_platform.source in ('wg','panda','duoli') then
    foreach v_key in array (case when p_request ? 'providerAmountMatrix' then array['provider_amount_range','amount_range'] else array['provider_hour','hourly'] end) loop$old$,$new$if p_request ? 'providerHourMatrix' and v_platform.source in ('wg','panda','duoli') then
    foreach v_key in array array['provider_hour','hourly'] loop$new$);
  definition:=replace(definition,$old$  elsif p_request ? 'providerAmountMatrix' then
    -- The existing native projection supplies the same monetary basis and
    -- half-open boundaries as each ordinary amount_range drill. A payment and
    -- its creation belong to the same amount band even on independent clocks.
    v_sql := replace(v_prefix,'filtered as materialized (','filtered as (') || $q$,
    raw_bands as materialized (
      select direction,currency,provider,amount_range_bucket as bucket,
             count(*) filter (where created_in_range) as all_count,
             count(*) filter (where created_in_range and status_group='success') as created_success_count,
             count(*) filter (where success_in_range) as success_count
      from filtered
      where created_in_range or success_in_range
      group by direction,currency,provider,amount_range_bucket
    ), names as materialized (
      select raw_provider, private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from raw_bands) s
    ), metrics as (
      select b.direction,b.currency,n.provider,b.bucket,grouping(n.provider,b.bucket) as level,
             sum(b.all_count)::bigint as all_count,
             sum(b.created_success_count)::bigint as created_success_count,
             sum(b.success_count)::bigint as success_count
      from raw_bands b join names n on n.raw_provider is not distinct from b.provider
      group by b.direction,b.currency,grouping sets ((n.provider,b.bucket),(n.provider),(b.bucket),())
    ), output as (
      select direction,currency,provider,bucket,level,to_jsonb(m)-'level' as value from metrics m
    )
    select jsonb_build_object('providerAmountMatrix',true,
      'summary',coalesce(jsonb_agg(value-array['provider','bucket'] order by direction,currency) filter (where level=3),'[]'::jsonb),
      'groups',jsonb_build_object(
        'provider',coalesce(jsonb_agg(value-'bucket' order by provider,direction,currency) filter (where level=1),'[]'::jsonb),
        'amount_range',coalesce(jsonb_agg(value-'provider' order by bucket,direction,currency) filter (where level=2),'[]'::jsonb),
        'provider_amount_range',coalesce(jsonb_agg(value order by provider,bucket,direction,currency) filter (where level=0),'[]'::jsonb)
      ),'rows','[]'::jsonb) from output
    $q$;
  elsif p_request ? 'providerHourMatrix' then$old$,$new$  elsif p_request ? 'providerHourMatrix' then$new$);
  definition:=replace(definition,$old$and p_request ?| array['providerHourMatrix','providerAmountMatrix'] and v_min is null$old$,$new$and p_request ? 'providerHourMatrix' and v_min is null$new$);
  definition:=replace(definition,$old$  if p_request ? 'providerAmountMatrix' then
    if p_request->'providerAmountMatrix' is distinct from 'true'::jsonb or p_request ? 'providerHourMatrix'
       or v_amount_bands is null or v_kind <> 'custom'
       or v_hour_range is distinct from '{"minHour":0,"maxHour":24}'::jsonb then
      raise exception using errcode='22023', message='invalid_provider_amount_matrix';
    end if;
    if nullif(current_setting('hensem.dashboard_role_context',true),'') is not null
       and nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb#>>'{payload,page}' is distinct from 'amount' then
      raise exception using errcode='42501', message='page_action_denied';
    end if;
  end if;
  if p_request ? 'providerHourMatrix' then$old$,$new$  if p_request ? 'providerHourMatrix' then$new$);
  definition:=replace(definition,$old$'providerHourMatrix','providerAmountMatrix','amountBands'$old$,$new$'providerHourMatrix','amountBands'$new$);
  execute definition;
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from '92c9cdc9cc04dd7ca9ba2d7fc2f6c156' then
    raise exception 'provider_amount_matrix_installation_incomplete';
  end if;
end
$install$;
