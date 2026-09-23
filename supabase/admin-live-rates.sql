-- New detailed-admin current-rate read API only.
-- Dependency: admin-live-query.sql (fresh independent permission/scope helper).
-- No source data, old RPC, collector or existing table policy is changed.
begin;

create function private.dashboard_admin_live_rates(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_type text; v_country text; v_platform text; v_provider text; v_query text;
  v_offset integer; v_limit integer; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
    'scopeType','country','platform','provider','query','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['scopeType','country','platform','provider','query'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200
       or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number'
      or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_type:=coalesce(p_request->>'scopeType','all');
  v_country:=nullif(p_request->>'country','');
  v_platform:=nullif(p_request->>'platform','');
  v_provider:=nullif(p_request->>'provider','');
  v_query:=nullif(btrim(p_request->>'query'),'');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_type not in ('all','country','platform') then
    raise exception using errcode='22023',message='invalid_scope_type';
  end if;
  if v_limit not in (20,30,50,100,500) or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_pagination';
  end if;
  -- These small configuration tables are intentionally separate rows. A generic
  -- country row is not a platform override and neither side is a fee history.
  with allowed_rows as materialized (
    select 'country:'||r.id as id,r.id as source_id,'country'::text as scope_type,
      r.country,private.dashboard_data_group(r.country,'') as scope_group,null::text as platform,
      r.third_party as provider,r.category,r.collect_fee,r.payout_fee,r.total_fee,
      r.collect_single_fee,r.payout_single_fee,r.collect_limit,r.payout_limit,
      r.status,null::text as raw_status,r.sheet_name,r.source_row,null::integer as source_column,r.updated_at
    from public.third_party_rates r
    where private.dashboard_scope_allows(v_scope,r.country,'')
    union all
    select 'platform:'||p.id,p.id,'platform'::text,
      p.country,private.dashboard_data_group(p.country,p.platform),p.platform,
      p.third_party,p.category,p.collect_fee,p.payout_fee,p.total_fee,
      p.collect_single_fee,p.payout_single_fee,p.collect_limit,p.payout_limit,
      p.status,p.raw_status,p.sheet_name,p.source_row,p.source_column,p.updated_at
    from public.third_party_platform_status p
    where private.dashboard_scope_allows(v_scope,p.country,p.platform)
  ), filtered as materialized (
    select * from allowed_rows a
    where (v_type='all' or a.scope_type=v_type)
      and (v_country is null or a.scope_group=v_country)
      and (v_platform is null or a.platform=v_platform)
      and (v_provider is null or a.provider=v_provider)
      -- Literal substring, not LIKE wildcard or fuzzy/canonical alias matching.
      and (v_query is null or strpos(lower(a.provider),lower(v_query))>0)
  ), page as (
    select * from filtered order by scope_group nulls last,platform nulls first,provider nulls last,category nulls last,id
    offset v_offset limit v_limit
  )
  select jsonb_build_object(
    'version',1,'asOf',statement_timestamp(),'basis','current_rate_table',
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'hasMore',(select count(*) from filtered)>v_offset::bigint+v_limit,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'sourceId',p.source_id,'scopeType',p.scope_type,
      'country',p.country,'scopeGroup',p.scope_group,'platform',p.platform,'provider',p.provider,
      'category',p.category,'collectFee',p.collect_fee,'payoutFee',p.payout_fee,'totalFee',p.total_fee,
      'collectSingleFee',p.collect_single_fee,'payoutSingleFee',p.payout_single_fee,
      'collectLimit',p.collect_limit,'payoutLimit',p.payout_limit,
      'status',p.status,'rawStatus',p.raw_status,'sheetName',p.sheet_name,
      'sourceRow',p.source_row,'sourceColumn',p.source_column,'updatedAt',p.updated_at
    ) order by p.scope_group nulls last,p.platform nulls first,p.provider nulls last,p.category nulls last,p.id) from page p),'[]'::jsonb),
    'options',jsonb_build_object(
      'countries',coalesce((select jsonb_agg(jsonb_build_object('value',o.scope_group,'label',o.country)
        order by o.scope_group,o.country) from (select scope_group,min(country) as country from allowed_rows
        where scope_group is not null and scope_group<>'' and country is not null group by scope_group) o),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(jsonb_build_object('value',o.platform,'country',o.country,'scopeGroup',o.scope_group)
        order by o.scope_group,o.platform) from (select distinct platform,country,scope_group from allowed_rows
        where platform is not null and platform<>'') o),'[]'::jsonb),
      'providers',coalesce((select jsonb_agg(o.provider order by o.provider) from
        (select distinct provider from allowed_rows where provider is not null and provider<>'') o),'[]'::jsonb)
    ),
    'capabilities',jsonb_build_object('historicalFeeVersions',false,'feeEstimate',false,
      'providerMatching','exact_raw_name','tierHandling','raw_not_averaged')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_rates(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_rates(jsonb) to authenticated;

create function public.dashboard_admin_live_rates(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_rates(p_request);
$$;
revoke all on function public.dashboard_admin_live_rates(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_rates(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
